import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabase-server'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { isPlan, PUBLIC_PLANS, toPlan } from '@/lib/plans'
import { clientIp, verifyOwnership } from '@/lib/ownership'

// Stripe checkout session creation.
//
// Direct REST calls, no SDK, which keeps the dependency surface small. There
// is no scarcity mechanic (capped discounts, countdowns) on purpose; Stripe's
// own promotion codes cover any real discount need.

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

// Price IDs are configured in the Stripe dashboard and supplied via env. The
// fallbacks exist so local builds evaluate; they are not valid Stripe prices
// and a checkout against them fails loudly rather than silently charging.
const PRICE_IDS: Record<string, string> = {
  practitioner_monthly: process.env.STRIPE_PRICE_PRACTITIONER_MONTHLY || '',
  practitioner_annual: process.env.STRIPE_PRICE_PRACTITIONER_ANNUAL || '',
  professional_monthly: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY || '',
  professional_annual: process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL || '',
  // No team_* entries. Team is not sold (see PUBLIC_PLANS in lib/plans.ts), so
  // this table carries no key that could resolve one — the guard below is the
  // rule, and this is the same rule expressed as an absence.
}

async function createCheckoutSession(params: URLSearchParams) {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const session = await response.json()
  return { ok: response.ok, session }
}

export async function POST(req: NextRequest) {
  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  if (!STRIPE_SECRET) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 })
  }

  try {
    const { plan, interval, userId, email } = await req.json()

    // Keyed on the IP. It used to prefer the caller-supplied userId, which
    // meant the limit on an endpoint that makes an outbound Stripe API call
    // could be reset by changing one field in the request body.
    const rl = checkRateLimit(`stripe-checkout:${clientIp(req)}`, 10, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    // The id written into the session's metadata is the id the webhook later
    // grants a plan to, so it has to be the caller's own.
    //
    // Without this, a session could be created naming someone else's account.
    // Completing it would upsert their subscriptions row — which is keyed on
    // user_id — replacing their stripe_customer_id with the payer's. From then
    // on the victim's own billing portal opens the payer's customer record
    // (their invoices, their card), while the victim's real subscription is no
    // longer tracked against them at all.
    const ownership = await verifyOwnership(req, userId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }
    // And it has to be a signed-in account, not a device token. lib/ownership
    // is explicit that a device token is a soft check, not identity, and this
    // is the one route that takes money. A guest is sent to create an account
    // first (their rehearsals come with them) and returned here to finish.
    // The billing portal and account deletion already required this.
    if (!ownership.authenticated) {
      return NextResponse.json(
        {
          error: 'Create an account or sign in to subscribe. Your rehearsals come with you.',
          code: 'session_required',
        },
        { status: 403 }
      )
    }

    // Free is not a checkout target, and an unknown plan string must never
    // reach Stripe as a price key.
    //
    // WHAT A CALLER MAY BUY IS `PUBLIC_PLANS`, NOT `PLAN_ORDER`. `isPlan` tests
    // PLAN_ORDER, which is the ENTITLEMENT ladder: it deliberately still holds
    // 'team' so an existing Team subscription resolves to full access instead
    // of falling through toPlan to free (lib/plans.ts). That makes it the wrong
    // list to gate a purchase on. Team is Professional's entitlements
    // byte-for-byte at a LOWER price and was withdrawn from sale for exactly
    // that reason — so while this read PLAN_ORDER, a hand-written
    // {"plan":"team"} body bought full access at the withdrawn rate, on an
    // endpoint whose own test suite asserts in three other places that Team is
    // not sold. The two lists answer different questions and this is the one
    // that asks "may this be sold", not "may the database hold this".
    if (!isPlan(plan) || plan === 'free' || !PUBLIC_PLANS.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 })
    }

    const billingInterval = interval === 'annual' ? 'annual' : 'monthly'
    const priceId = PRICE_IDS[`${plan}_${billingInterval}`]
    if (!priceId) {
      console.error('[Stripe] No price ID configured for', `${plan}_${billingInterval}`)
      return NextResponse.json({ error: 'That plan is not available yet.' }, { status: 400 })
    }

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${SITE_URL}/billing?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${SITE_URL}/pricing`,
      'metadata[user_id]': userId,
      'metadata[plan]': plan,
      billing_address_collection: 'auto',
      allow_promotion_codes: 'true',
    })
    if (email) params.set('customer_email', email)

    const { ok, session } = await createCheckoutSession(params)
    if (!ok) {
      console.error('[Stripe] Checkout session failed:', session?.error?.message)
      return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 })
    }

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (e) {
    console.error('[Stripe] Checkout threw:', e)
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 })
  }
}

/** Current subscription state. Reads Supabase only — never calls Stripe. */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ plan: 'free', status: 'none' })
  }

  // Someone else's billing status is not public. This answered for any id.
  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  try {
    // Service-role client deliberately: RLS blocks the anon key from reading
    // subscriptions at all, which would silently report everyone as free.
    const { data } = await supabaseServer
      .from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data) return NextResponse.json({ plan: 'free', status: 'none' })

    return NextResponse.json({
      plan: toPlan(data.plan),
      status: data.status,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
    })
  } catch (e) {
    console.error('[Stripe] Subscription lookup failed:', e)
    return NextResponse.json({ plan: 'free', status: 'none' })
  }
}
