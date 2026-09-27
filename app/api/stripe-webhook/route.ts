import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { trackEvent } from '@/lib/analytics'
import { isPlan, toPlan, type Plan } from '@/lib/plans'
import { isValidUserId } from '@/lib/ownership'

// Stripe webhook — the only trustworthy source of subscription state.
//
// Three properties this handler has to hold, because Stripe guarantees none of
// them for us:
//
//   1. AUTHENTICITY. The signature check is mandatory and fails closed. This
//      endpoint grants entitlements, so a deployment missing the secret must
//      refuse rather than accept a hand-rolled checkout.session.completed with
//      an arbitrary metadata.user_id.
//
//   2. IDEMPOTENCY, WITHOUT LOSING FAILURES. Stripe retries until it gets a
//      2xx. A bare "insert the id, then work" ledger fixes the replay problem
//      and creates a worse one: an event whose handler throws after the insert
//      is recorded as seen while none of its work happened, the route still
//      answers 200, and the retry short-circuits on the duplicate — so the
//      entitlement change is lost silently and permanently.
//
//      So the ledger records PROGRESS, not arrival. An event is claimed as
//      'processing', marked 'done' only when the handler returns, and 'failed'
//      with a 503 when it throws. Only 'done' short-circuits a redelivery;
//      'processing' (a process that died mid-handler) and 'failed' both re-run
//      it. Re-running is safe because every write the handler performs is
//      either an upsert or guarded by last_event_at.
//
//   3. ORDERING. Delivery is not ordered. A delayed customer.subscription.updated
//      can land after the .deleted that supersedes it and quietly resurrect a
//      cancelled plan. Every subscription write is guarded on
//      subscriptions.last_event_at, so an older event is a no-op.

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

// How far out of date a signature may be. Stripe signs a timestamp alongside
// the payload precisely so a captured delivery cannot be replayed later, and
// nothing here was reading it — the signature stayed valid forever.
//
// The event ledger already makes a replay of a SEEN event a no-op, so this is
// the second lock rather than the first. It matters for the window the ledger
// cannot cover: an event captured in transit and delayed, or replayed before
// the original is delivered, is accepted today and would be rejected here.
// Five minutes is Stripe's own recommended tolerance.
const SIGNATURE_TOLERANCE_SECONDS = 300

/** Stripe signature verification without the SDK. */
async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2)
  const sig = parts.find(p => p.startsWith('v1='))?.slice(3)
  if (!timestamp || !sig) return false

  // Checked before the HMAC, because a stale signature is not worth computing.
  // Bounded in both directions: a far-future timestamp is as much a sign of a
  // forged header as an old one is of a replay.
  const signedAt = Number(timestamp)
  if (!Number.isFinite(signedAt)) return false
  const skew = Math.abs(Math.floor(Date.now() / 1000) - signedAt)
  if (skew > SIGNATURE_TOLERANCE_SECONDS) {
    console.error('[Stripe webhook] Signature timestamp outside tolerance:', skew, 'seconds')
    return false
  }

  const signedPayload = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const computedHex = Array.from(new Uint8Array(computed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (computedHex.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

interface StripeEvent {
  id?: string
  type?: string
  created?: number
  data?: { object?: Record<string, unknown> }
}

/**
 * The plan a Stripe subscription object represents, read from the price's
 * lookup_key ("practitioner_monthly" -> "practitioner").
 *
 * Derived from the subscription itself rather than from checkout metadata
 * wherever possible: metadata is what WE sent at checkout creation, so it goes
 * stale the moment a customer changes plan in the billing portal. The price on
 * the subscription is what Stripe is actually charging.
 */
function planFromSubscription(obj: Record<string, unknown>): Plan | null {
  const items = obj.items as { data?: { price?: { lookup_key?: string; metadata?: { tier?: string } } }[] } | undefined
  const price = items?.data?.[0]?.price
  if (!price) return null

  const fromLookup = price.lookup_key?.split('_')[0]
  if (isPlan(fromLookup)) return fromLookup

  const fromMetadata = price.metadata?.tier
  if (isPlan(fromMetadata)) return fromMetadata

  return null
}

/** ISO timestamp of the event, used to drop out-of-order writes. */
function eventTime(event: StripeEvent): string {
  return new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
}

/**
 * Applies a subscription update only if this event is at least as recent as the
 * last one applied to the row. Returns the affected user id, if any.
 *
 * THROWS on a database failure, deliberately. This used to log and return null,
 * which made a write that never happened indistinguishable from a stale event
 * correctly dropped — so a transient Supabase error during a cancellation or a
 * plan change was answered with a 200, Stripe never redelivered, and the
 * account kept an entitlement it no longer had (or lost one it did). Throwing
 * puts the event back on Stripe's retry schedule, which is safe because every
 * write here is either an upsert or guarded by last_event_at.
 */
async function applySubscriptionUpdate(
  match: { column: 'stripe_subscription_id' | 'stripe_customer_id'; value: string },
  patch: Record<string, unknown>,
  at: string
): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from('subscriptions')
    .update({ ...patch, last_event_at: at, updated_at: new Date().toISOString() })
    .eq(match.column, match.value)
    // Null means the row predates the ledger; anything older than `at` is a
    // late delivery we must not apply on top of newer state.
    .or(`last_event_at.is.null,last_event_at.lte.${at}`)
    .select('user_id')
    .maybeSingle()

  if (error) {
    throw new Error(`subscriptions update failed: ${error.message}`)
  }
  if (!data) {
    // Either no such subscription, or the guard dropped a stale event. Both are
    // expected and neither is a delivery failure.
    return null
  }
  return (data as { user_id: string }).user_id ?? null
}

export async function POST(req: NextRequest) {
  const supabase = supabaseServer
  const payload = await req.text()
  const sigHeader = req.headers.get('stripe-signature') || ''

  // Signature verification is MANDATORY, not conditional.
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not configured — rejecting.')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  if (!(await verifyStripeSignature(payload, sigHeader, STRIPE_WEBHOOK_SECRET))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Shape-checked rather than destructured blindly: a signature-valid but
  // malformed body used to throw here and surface as a 500, which Stripe
  // treats as a delivery failure and retries forever.
  const obj = event?.data?.object
  if (!event?.type || !event?.id || !obj || typeof obj !== 'object') {
    return NextResponse.json({ error: 'Malformed event' }, { status: 400 })
  }

  const at = eventTime(event)

  // ── Idempotency gate ──────────────────────────────────────────────────────
  // Claim the event as 'processing' before doing any work.
  const { error: ledgerError } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type, event_created: at, status: 'processing' })

  if (ledgerError) {
    if (ledgerError.code !== '23505') {
      // The ledger is unavailable. Returning non-2xx makes Stripe retry, which
      // is the right call: better a late delivery than an entitlement change we
      // cannot prove we applied exactly once.
      console.error('[Stripe webhook] Event ledger write failed:', ledgerError.message)
      return NextResponse.json({ error: 'Could not record event' }, { status: 503 })
    }

    // Seen before — but only a COMPLETED handler makes a replay safe to skip.
    const { data: prior, error: readError } = await supabase
      .from('stripe_events')
      .select('status, attempts')
      .eq('id', event.id)
      .maybeSingle()

    if (readError) {
      console.error('[Stripe webhook] Could not read prior event state:', readError.message)
      return NextResponse.json({ error: 'Could not record event' }, { status: 503 })
    }

    if ((prior as { status?: string } | null)?.status === 'done') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // 'processing' means an earlier attempt died mid-handler; 'failed' means it
    // threw and we asked for this retry. Either way the work did not finish, so
    // run it again and count the attempt.
    const attempts = ((prior as { attempts?: number } | null)?.attempts ?? 1) + 1
    await supabase
      .from('stripe_events')
      .update({ status: 'processing', attempts, last_error: null })
      .eq('id', event.id)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const metadata = (obj.metadata as Record<string, string>) ?? {}
        const userId = metadata.user_id
        // At checkout there is no expanded subscription object to read a price
        // from, so metadata is the only signal available. It is Stripe echoing
        // back what we set when we created the session, and the signature
        // proves it came from Stripe — but every LATER event re-derives the
        // plan from the price, so a stale value here is self-correcting.
        const plan = toPlan(metadata.plan)
        const subscriptionId = String(obj.subscription || '')
        const customerId = String(obj.customer || '')

        // Checked rather than trusted. metadata.user_id is whatever the
        // checkout session was created with, and a malformed value would fail
        // the insert on every redelivery forever — so it is refused once, here,
        // as a 200 nothing can be done about rather than a retry loop.
        if (userId && !isValidUserId(userId)) {
          console.error('[Stripe webhook] checkout.session.completed carried a malformed user_id; ignoring.')
          break
        }

        if (userId) {
          const { error: grantError } = await supabase.from('subscriptions').upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              plan,
              status: 'active',
              last_event_at: at,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )

          // The one write in this whole file that someone has already paid for.
          // It used to be issued and never checked: a failure here meant the
          // customer was charged, the event was marked done, Stripe never
          // retried, and the plan simply never arrived. Throwing hands it back
          // to Stripe's retry schedule, and the upsert is idempotent.
          if (grantError) {
            throw new Error(`subscription grant failed: ${grantError.message}`)
          }

          // A "Your plan is active" notification was written here until
          // 2026-09-16. It was the only writer the notifications table ever
          // had, and the user could not read it: /notifications was linked
          // from no nav or footer, so the row was inserted and never seen.
          // The subsystem is gone — route, page, table — and the billing page
          // is where an active plan is actually confirmed.
          await trackEvent({ name: 'subscription_started', properties: { plan } }, userId)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subId = String(obj.id || '')
        if (!subId) break

        const patch: Record<string, unknown> = {
          status: String(obj.status || ''),
          current_period_end: obj.current_period_end
            ? new Date(Number(obj.current_period_end) * 1000).toISOString()
            : null,
          cancel_at_period_end: obj.cancel_at_period_end === true,
        }

        // Plan comes from the price Stripe is charging, not from our metadata,
        // so an upgrade or downgrade made in the billing portal is reflected.
        const plan = planFromSubscription(obj)
        if (plan) patch.plan = plan

        await applySubscriptionUpdate({ column: 'stripe_subscription_id', value: subId }, patch, at)
        break
      }

      case 'customer.subscription.deleted': {
        const subId = String(obj.id || '')
        if (!subId) break

        const userId = await applySubscriptionUpdate(
          { column: 'stripe_subscription_id', value: subId },
          { status: 'canceled', plan: 'free', cancel_at_period_end: false },
          at
        )
        if (userId) {
          await trackEvent({ name: 'subscription_canceled', properties: {} }, userId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const customerId = String(obj.customer || '')
        if (!customerId) break
        await applySubscriptionUpdate(
          { column: 'stripe_customer_id', value: customerId },
          { status: 'past_due' },
          at
        )
        break
      }
    }
  } catch (e) {
    // Record the failure and ASK FOR A RETRY. Swallowing this into a 200 was
    // the bug: Stripe would never redeliver, and the entitlement change would
    // be gone with only a log line to show for it.
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[Stripe webhook] handler threw, asking Stripe to retry:', event.type, event.id, detail)

    await supabase
      .from('stripe_events')
      .update({ status: 'failed', last_error: detail.slice(0, 500) })
      .eq('id', event.id)

    return NextResponse.json({ error: 'Handler failed' }, { status: 503 })
  }

  // Only now is the event safe to skip on redelivery.
  const { error: completeError } = await supabase
    .from('stripe_events')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', event.id)

  if (completeError) {
    // The work succeeded but the ledger did not record it. Answering 200 would
    // leave the row stuck in 'processing' forever; answering 503 gets a retry
    // that re-runs a handler whose writes are all upserts or ordering-guarded,
    // and which will then be able to mark it done.
    console.error('[Stripe webhook] Could not mark event done:', completeError.message)
    return NextResponse.json({ error: 'Could not finalise event' }, { status: 503 })
  }

  return NextResponse.json({ received: true })
}
