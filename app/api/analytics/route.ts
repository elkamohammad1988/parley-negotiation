import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { trackEvent, type AnalyticsEvent } from '@/lib/analytics'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { isPlan } from '@/lib/plans'

// Client-facing insert endpoint — for browser call sites that cannot write to
// analytics_events directly.
//
// Everything about a rehearsal — started, turn, ended, debrief_generated — is
// deliberately absent. Those are fired server-side from the rehearsal and
// debrief routes, which know the plan and the scenario authoritatively, and a
// client-reported score would be worth nothing. subscription_started and
// subscription_canceled come from the Stripe webhook for the same reason.
//
// ── TWO THINGS THIS ROUTE NOW PROVES, AND WHY ───────────────────────────────
//
// 1. THE PROPERTIES, NOT JUST THE NAME.
//
//    lib/analytics.ts opens with the rule this product's privacy rests on:
//    "free text never reaches this table", because rehearsal transcripts are
//    what someone actually plans to say to their employer about their pay.
//    CLAUDE.md restates it as a closed whitelist. But the whitelist only ever
//    closed the event NAME — `properties` was taken as `body.properties || {}`
//    and written into a jsonb column verbatim.
//
//    So the invariant was a comment, not a control. Any unauthenticated caller
//    could POST a permitted name with an arbitrary payload and have it stored
//    forever, and any future client call site could put a playbook note in
//    there without anything objecting. The AnalyticsEvent union already
//    declares the exact shape of every event; PROPERTY_SPECS below is that
//    declaration made enforceable. Keys that are not declared are dropped,
//    values that are not one of the declared literals are dropped, and nothing
//    free-form survives — so the table cannot become a store of user text by
//    accident or on purpose.
//
// 2. THE ATTRIBUTION.
//
//    `userId` was taken from the body and written to analytics_events.user_id
//    after nothing more than a uuid format check. That let anyone attach
//    events to an account they do not own: a victim's funnel filled with
//    checkout_started rows they never triggered, and the admin conversion
//    figures in app/api/admin/analytics-funnel derived from them.
//
//    An unproven id is now dropped rather than refused. That is a deliberate
//    difference from app/api/safety, which returns 403 for the same offence:
//    there, attribution decides whether an account gets banned, so a caller
//    naming someone else must be stopped. Here the only consequence is a row,
//    and `signup_completed` legitimately fires in the seconds before
//    SessionSync has mirrored the new access token into a cookie — so refusing
//    would drop real funnel data to punish a race. Recording the event with no
//    user attached keeps the count honest and attaches nothing to anybody.
const ALLOWED_CLIENT_EVENTS = new Set<AnalyticsEvent['name']>([
  'signup_started',
  'signup_completed',
  'onboarding_completed',
  'paywall_viewed',
  'checkout_started',
  'playbook_entry_added',
  'counterpart_created',
])

/**
 * The declared shape of each client-reportable event, as a validator per key.
 *
 * Mirrors the AnalyticsEvent union in lib/analytics.ts. Every validator is an
 * enum membership test or a boolean test — deliberately, because the moment one
 * of them accepts an arbitrary string this route is a free-text sink again.
 * `counterpart_created` declares `Record<string, never>`, so it takes no keys
 * at all and its spec is empty.
 */
type PropertyValue = string | number | boolean
const enumOf = (...allowed: string[]) => (v: unknown): PropertyValue | undefined =>
  typeof v === 'string' && allowed.includes(v) ? v : undefined
const boolean = (v: unknown): PropertyValue | undefined =>
  typeof v === 'boolean' ? v : undefined
const plan = (v: unknown): PropertyValue | undefined => (isPlan(v) ? v : undefined)

const PROPERTY_SPECS: Record<string, Record<string, (v: unknown) => PropertyValue | undefined>> = {
  signup_started: { method: enumOf('email', 'guest') },
  signup_completed: { method: enumOf('email', 'guest') },
  onboarding_completed: { hasDatedConversation: boolean },
  paywall_viewed: { source: enumOf('pricing_page', 'quota_exhausted', 'progress_locked') },
  checkout_started: { plan, interval: enumOf('monthly', 'annual') },
  playbook_entry_added: { fromDebrief: boolean },
  counterpart_created: {},
}

/**
 * Rebuilds the properties object from the spec rather than filtering the input.
 *
 * Building forward is what makes this safe: an undeclared key cannot survive a
 * pass that never looks at it, so there is no blocklist to keep up to date and
 * no prototype-pollution shape to reason about.
 */
function sanitiseProperties(
  eventName: string,
  raw: unknown
): Record<string, PropertyValue> {
  const spec = PROPERTY_SPECS[eventName] ?? {}
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Record<string, PropertyValue> = {}
  for (const [key, validate] of Object.entries(spec)) {
    const value = validate(Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined)
    if (value !== undefined) out[key] = value
  }
  return out
}

export async function POST(req: NextRequest) {
  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  const rl = checkRateLimit(`analytics:${clientIp(req)}`, 60, 60_000)
  if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429 })

  const body = await req.json().catch(() => null)
  const eventName = body?.event
  if (!body || typeof eventName !== 'string' || !ALLOWED_CLIENT_EVENTS.has(eventName as AnalyticsEvent['name'])) {
    return NextResponse.json({ ok: false, error: 'Unknown or disallowed event' }, { status: 400 })
  }

  // Attribution requires proof. An id the caller cannot demonstrate they own is
  // dropped, not passed through — see the note above on why this drops where
  // app/api/safety refuses.
  let attributedTo: string | null = null
  if (body.userId !== undefined && body.userId !== null && body.userId !== '') {
    const ownership = await verifyOwnership(req, body.userId)
    if (ownership.ok) attributedTo = body.userId as string
  }

  await trackEvent(
    {
      name: eventName,
      properties: sanitiseProperties(eventName, body.properties),
    } as AnalyticsEvent,
    attributedTo
  )
  return NextResponse.json({ ok: true })
}
