// Plan and entitlement configuration.
//
// Parley meters REHEARSALS, not messages. That is a deliberate departure from
// metering conversation volume: a rehearsal has a natural end, so a monthly
// rehearsal count is something a user can reason about before they buy, and it
// stops the pricing from rewarding people for talking longer rather than
// negotiating better.
//
// The daily token ceiling in lib/usageLimits.ts still sits underneath all of
// this as a pure cost guard. It is not a product-visible limit and should
// never be surfaced as one.
//
// PRICES BELOW ARE PLACEHOLDER CONFIGURATION, not committed pricing. They must
// be confirmed and reconciled with the live Stripe product configuration
// (app/api/stripe/setup-products) before any public launch, and no marketing
// surface should assert them until that has happened.

export type Plan = 'free' | 'practitioner' | 'professional' | 'team'

// EVERY ENTITLEMENT HERE IS ENFORCED SOMEWHERE. That is the rule for adding one:
// a field in this interface is a promise on the pricing page, so it must be
// backed by code that actually grants or withholds the thing. Five fields have
// been removed for breaking it — `customScenarios` (no editor, no storage),
// `teamWorkspace` (no shared library, no team view), `exportTranscripts` (the
// account export in app/api/account is available to every plan, so it was not
// a differentiator), and `historyDays` and `monthlyDebriefs` (see below). Each
// remains a roadmap item; when one is built it gets its entitlement back here,
// not before. See ROADMAP.md.
//
// The last two went on 2026-09-14.
//
// `historyDays` claimed 30 days on Free and three years on Professional, and
// was rendered on the pricing table, the billing page and the privacy policy —
// but no reader filtered by date and no reaper deleted anything, so every plan
// kept everything forever. It was false in both directions at once: it
// undersold what a free account actually keeps, and it sold paid retention that
// was not being withheld from anyone. Building a reaper is a destructive data
// feature and a legal decision, not a config tweak, so the claim was removed
// rather than enforced.
//
// `monthlyDebriefs` was never read by any route: a debrief is generated once
// per rehearsal and persisted, so the number of debriefs a plan allows is the
// number of rehearsals it allows, and nothing else. Printed in a comparison
// table beside "25 rehearsals a month" the word "Unlimited" was simply untrue.
// Every rehearsal includes its debrief; the FAQ says so in words instead.
export interface PlanFeatures {
  /** Rehearsals startable per calendar month. -1 = unlimited. Enforced by the database trigger and the session route. */
  monthlyRehearsals: number
  /** Custom counterparts the user may define. -1 = unlimited. Enforced in app/api/counterparts. */
  customCounterparts: number
  /** The trend view across rehearsals, rather than single debriefs. Enforced in app/api/progress. */
  progressTrends: boolean
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: {
    monthlyRehearsals: 3,
    customCounterparts: 0,
    progressTrends: false,
  },
  practitioner: {
    monthlyRehearsals: 25,
    customCounterparts: 2,
    progressTrends: true,
  },
  professional: {
    monthlyRehearsals: -1,
    customCounterparts: -1,
    progressTrends: true,
  },
  // Identical to professional in every entitlement above, because nothing in
  // this codebase implements a seat. Kept so an existing subscriptions row
  // reading 'team' still resolves to full access rather than silently falling
  // back to free — it is NOT offered for sale. See PUBLIC_PLANS.
  team: {
    monthlyRehearsals: -1,
    customCounterparts: -1,
    progressTrends: true,
  },
}

/** Every plan the database and Stripe may hand back. The entitlement ladder. */
export const PLAN_ORDER: Plan[] = ['free', 'practitioner', 'professional', 'team']

// The plans actually offered. Team is not one of them.
//
// Team's entitlements were byte-for-byte Professional's, at a lower price,
// with a tagline promising "per-seat plans for a team" — while the product has
// no seat, no shared library, no team view and no invite, and the terms say one
// person per account. It was a column on the pricing table that differed from
// the column beside it only in price, which is the definition of a claim the
// product cannot keep.
//
// Nothing was built to fix that, and nothing was taken from anyone: the plan
// still exists in the type, in PLAN_FEATURES, in the plan_limits table and in
// the Stripe product configuration, so a row already carrying it keeps working.
// It is simply no longer sold on a page that would have to describe it. Several
// people on one account is arranged by hand until seats exist — see ROADMAP.md.
export const PUBLIC_PLANS: Plan[] = ['free', 'practitioner', 'professional']

export const PLAN_NAMES: Record<Plan, string> = {
  free: 'Free',
  practitioner: 'Practitioner',
  professional: 'Professional',
  team: 'Team',
}

export const PLAN_TAGLINES: Record<Plan, string> = {
  free: 'Rehearse the one renewal that is coming.',
  practitioner: 'For anyone who owns a handful of vendor negotiations a quarter.',
  professional: 'For people whose job is the deal — procurement, vendor management, IT finance.',
  // Not sold — see PUBLIC_PLANS. This is what an existing Team row reads as on
  // the billing page, and it describes only what that row actually gets.
  team: 'Full access, arranged directly.',
}

// Single source of truth for displayed prices. Must be reconciled with the
// live Stripe product configuration before launch — see the header note.
//
// Team carries no price: it is not offered, and the $29 "per seat" that used to
// sit here was both unreconciled placeholder and lower than Professional for
// exactly the same entitlements. The billing page falls back to hiding the
// figure rather than asserting one.
/**
 * Whether the figures above are still placeholders. True unless the deployment
 * sets NEXT_PUBLIC_PRICING_LIVE=true, which it should only do once PLAN_PRICES
 * matches the live Stripe products. While true, /pricing says so in plain
 * words: the public demo shows how plans and checkout work, and a dollar
 * figure with no label reads as an offer the demo cannot stand behind.
 */
export const PRICING_IS_DEMO = process.env.NEXT_PUBLIC_PRICING_LIVE !== 'true'

export const PLAN_PRICES: Record<Plan, { monthly: string; annual: string }> = {
  free: { monthly: '$0', annual: '$0' },
  practitioner: { monthly: '$19', annual: '$15' },
  professional: { monthly: '$39', annual: '$31' },
  team: { monthly: '', annual: '' },
}

/** The displayed price, or an empty string for a plan that is not sold. */
export function planPrice(plan: Plan, interval: 'monthly' | 'annual'): string {
  return PLAN_PRICES[plan]?.[interval] ?? ''
}

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLAN_ORDER as string[]).includes(value)
}

/** Normalises whatever came back from the database into a known plan. */
export function toPlan(value: unknown): Plan {
  return isPlan(value) ? value : 'free'
}

export function planFeatures(plan: Plan): PlanFeatures {
  return PLAN_FEATURES[plan] ?? PLAN_FEATURES.free
}

export function hasFeature(plan: Plan, feature: keyof PlanFeatures): boolean {
  const value = planFeatures(plan)[feature]
  if (typeof value === 'boolean') return value
  return value !== 0
}

/** True when `limit` is unlimited (-1) or `used` is still under it. */
export function withinLimit(used: number, limit: number): boolean {
  return limit === -1 || used < limit
}

export function formatLimit(limit: number): string {
  return limit === -1 ? 'Unlimited' : String(limit)
}

/**
 * The next plan up, for upgrade prompts. Null at the top of the ladder.
 *
 * Walks PUBLIC_PLANS, not PLAN_ORDER: an upgrade prompt is an offer, and the
 * product must not offer a plan it does not sell. This is also what stops the
 * billing page inviting a Professional subscriber to "move up to Team" — a
 * move that would have cost them nothing new and bought them nothing at all.
 * A plan that is not sold has no next step, so Team returns null too.
 */
export function nextPlanUp(plan: Plan): Plan | null {
  const index = PUBLIC_PLANS.indexOf(plan)
  if (index === -1 || index >= PUBLIC_PLANS.length - 1) return null
  return PUBLIC_PLANS[index + 1]
}
