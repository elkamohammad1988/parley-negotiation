// Two independent ceilings, for two different reasons.
//
//  1. MONTHLY REHEARSAL QUOTA — the product-visible limit from lib/plans.ts.
//     Counted directly off the rehearsals table rather than a denormalised
//     counter, so it cannot drift out of sync with what the user can actually
//     see in their own history.
//
//     This check is no longer the thing that ENFORCES the quota — a BEFORE
//     INSERT trigger in the database does that (see 008a in
//     supabase_migrations.sql), because a read-then-write check lets two rooms
//     opened at once both pass. What this function is for is producing a civil
//     402 with a real number in it, and rendering "2 of 3 used" in the UI. The
//     two must agree on what counts, which is why 'failed' is excluded in both
//     places.
//
//  2. DAILY TOKEN BUDGET — a pure cost guard, invisible to the user. A
//     rehearsal against a long transcript costs far more than a short one, so
//     a rehearsal count alone does not bound spend.
//
//  3. GLOBAL DAILY TOKEN BUDGET — the same guard for the whole deployment.
//     (1) and (2) are keyed on a user id, and a guest's id is a uuid the
//     browser mints for itself: clearing storage buys a fresh quota and a
//     fresh budget, so per-user limits alone do not bound what a public demo
//     can spend in a day. This one does. See GLOBAL_DAILY_TOKEN_BUDGET.
//
// Both fail OPEN here in the application. That is safe for the rehearsal quota
// specifically because the database trigger does not fail open — if this count
// cannot be read, the insert is still refused by Postgres. Failing open at this
// layer means an outage produces a worse error message, not free rehearsals.
// Requires the usage_daily and rehearsals tables — see supabase_migrations.sql.
import { supabaseServer as supabase } from './supabase-server'
import { planFeatures, withinLimit, type Plan } from './plans'

// Per-plan daily token ceilings. Sized well above what the monthly rehearsal
// quota can consume in a day, so in normal use a user hits their plan's
// rehearsal limit and never sees this one at all — which is the intent. It
// only catches genuine runaway cost.
//
// ON usage_daily.bonus_tokens. The column exists, is carried forward across
// days, and is consumed below by usage above the plan's own allowance. Nothing
// writes to it. An `addBonusTokens` helper sat here documented as "called from
// the Stripe webhook on a top-up" — the webhook has never called it and Parley
// sells no top-up, so it was a function describing a product that does not
// exist. It is gone; the column stays at zero unless an operator sets it by
// hand, which is what raising someone's ceiling means today.
export const PLAN_DAILY_TOKEN_BUDGET: Record<Plan, number> = {
  free: 60_000,
  practitioner: 400_000,
  professional: 1_200_000,
  team: 1_200_000,
}

// Fallback when a provider returns no usage data on a response.
const CHARS_PER_TOKEN_ESTIMATE = 4
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * Deployment-wide ceiling on tokens per UTC day, across every user and guest.
 * Set by GLOBAL_DAILY_TOKEN_BUDGET; -1 disables it. The default is a demo-sized
 * cost guard, not a capacity plan: raise it for a real deployment.
 */
export const DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET = 2_000_000

export function globalDailyTokenBudget(): number {
  const raw = process.env.GLOBAL_DAILY_TOKEN_BUDGET
  if (raw === undefined || raw.trim() === '') return DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET
  const n = Number(raw)
  return Number.isInteger(n) && n >= -1 ? n : DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET
}

/**
 * The usage_daily row that accumulates the whole deployment's spend. The nil
 * uuid, because usage_daily.user_id is a uuid with no foreign key, and no id
 * crypto.randomUUID() produces (always v4) can collide with it.
 */
export const GLOBAL_USAGE_ID = '00000000-0000-0000-0000-000000000000'

export const GLOBAL_CAP_MESSAGE =
  'Parley has reached its usage limit for today. It resets at midnight UTC, so please come back then.'

export const DAILY_CAP_MESSAGE =
  'You have hit today\'s usage ceiling. It resets at midnight UTC — or reach out if you need it lifted.'

export const QUOTA_MESSAGE =
  'You have used every rehearsal on your plan this month.'

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC
}

function monthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

// ─── Monthly rehearsal quota ────────────────────────────────────────────────

export interface QuotaStatus {
  used: number
  limit: number
  remaining: number | null // null when unlimited
  allowed: boolean
}

export async function getRehearsalQuota(userId: string, plan: Plan): Promise<QuotaStatus> {
  const limit = planFeatures(plan).monthlyRehearsals
  if (!userId) return { used: 0, limit, remaining: null, allowed: true }

  try {
    const { count, error } = await supabase
      .from('rehearsals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('started_at', monthStartIso())
      // A rehearsal whose opening turn never landed is not one the user got to
      // have. The database trigger excludes these from its count too.
      .neq('status', 'failed')

    if (error) {
      console.error('[UsageLimits] Rehearsal quota count failed, failing open:', error.message)
      return { used: 0, limit, remaining: null, allowed: true }
    }

    const used = count ?? 0
    return {
      used,
      limit,
      remaining: limit === -1 ? null : Math.max(0, limit - used),
      allowed: withinLimit(used, limit),
    }
  } catch (e) {
    console.error('[UsageLimits] Rehearsal quota check threw, failing open:', e)
    return { used: 0, limit, remaining: null, allowed: true }
  }
}

// ─── Daily token budget ─────────────────────────────────────────────────────

type UsageRow = { tokens_used: number; bonus_tokens: number }

// supabase-js does not throw on query errors — it returns them on the response
// object — so a bare try/catch never fires for "table does not exist". Logged
// explicitly here so a missing migration is visible rather than silently
// behaving as "nobody has ever used anything".
async function getOrCreateTodayRow(userId: string): Promise<UsageRow> {
  const today = todayDateKey()
  const { data: existing, error: selectError } = await supabase
    .from('usage_daily')
    .select('tokens_used, bonus_tokens')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle()
  if (selectError) {
    console.error('[UsageLimits] usage_daily select failed (has supabase_migrations.sql been applied?):', selectError.message)
  }
  if (existing) return existing

  // First request of a new day — carry forward any unspent bonus balance from
  // the most recent prior row. There is no DB-level mechanism for this, so it
  // happens here in the app.
  const { data: prior, error: priorError } = await supabase
    .from('usage_daily')
    .select('bonus_tokens')
    .eq('user_id', userId)
    .order('usage_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (priorError) console.error('[UsageLimits] usage_daily prior-row lookup failed:', priorError.message)
  const carriedBonus = prior?.bonus_tokens ?? 0

  const { data: inserted, error: insertError } = await supabase
    .from('usage_daily')
    .insert({ user_id: userId, usage_date: today, tokens_used: 0, bonus_tokens: carriedBonus })
    .select('tokens_used, bonus_tokens')
    .maybeSingle()
  if (insertError) console.error('[UsageLimits] usage_daily insert failed:', insertError.message)
  return inserted ?? { tokens_used: 0, bonus_tokens: carriedBonus }
}

/**
 * Checked BEFORE generation. Only sees usage already recorded from earlier
 * requests, so the request that crosses the line is still allowed through
 * once; the block applies from the next one.
 */
export async function isOverDailyBudget(userId: string, plan: Plan): Promise<boolean> {
  if (!userId) return false
  try {
    const row = await getOrCreateTodayRow(userId)
    const budget = PLAN_DAILY_TOKEN_BUDGET[plan] ?? PLAN_DAILY_TOKEN_BUDGET.free
    return row.tokens_used >= budget + row.bonus_tokens
  } catch (e) {
    console.error('[UsageLimits] Budget check failed, failing open:', e)
    return false
  }
}

/**
 * Checked BEFORE a rehearsal opens, before every counterpart turn, and before
 * a debrief is generated. Like the per-user check it only sees usage already
 * recorded, and it fails open: this is a cost guard, and a database blip
 * should not close the product.
 *
 * Debriefs used to be exempt, on the grounds that no new rehearsal can open
 * once the ceiling trips. But rehearsals opened earlier can be stockpiled and
 * ended afterwards, and a debrief is the largest single call the product
 * makes. A refused debrief keeps its transcript and succeeds after the reset.
 */
export async function isOverGlobalBudget(): Promise<boolean> {
  const budget = globalDailyTokenBudget()
  if (budget === -1) return false
  try {
    const row = await getOrCreateTodayRow(GLOBAL_USAGE_ID)
    return row.tokens_used >= budget
  } catch (e) {
    console.error('[UsageLimits] Global budget check failed, failing open:', e)
    return false
  }
}

/**
 * Adds to the deployment-wide row with one atomic upsert, add_token_usage()
 * in supabase_migrations.sql (009a). Every visitor's turns land on this one
 * row at once, so a read-then-write here loses most of a concurrent burst,
 * which is the traffic the ceiling exists to stop.
 *
 * Falls back to read-then-write only if the RPC is unavailable (a database
 * migrated before 009a), and says so in the log.
 */
async function recordGlobalUsage(tokens: number): Promise<void> {
  try {
    const { error } = await supabase.rpc('add_token_usage', {
      p_user_id: GLOBAL_USAGE_ID,
      p_usage_date: todayDateKey(),
      p_tokens: tokens,
    })
    if (!error) return
    console.error('[UsageLimits] add_token_usage failed, falling back to read-then-write (is 009a applied?):', error.message)
  } catch (e) {
    console.error('[UsageLimits] add_token_usage threw, falling back to read-then-write:', e)
  }
  try {
    const row = await getOrCreateTodayRow(GLOBAL_USAGE_ID)
    const { error } = await supabase
      .from('usage_daily')
      .update({ tokens_used: row.tokens_used + tokens, updated_at: new Date().toISOString() })
      .eq('user_id', GLOBAL_USAGE_ID)
      .eq('usage_date', todayDateKey())
    if (error) console.error('[UsageLimits] global usage_daily update failed:', error.message)
  } catch (e) {
    console.error('[UsageLimits] Failed to record global token usage:', e)
  }
}

/** Called AFTER generation with the real (or estimated) token count. */
export async function recordTokenUsage(userId: string, plan: Plan, tokens: number): Promise<void> {
  if (!userId || tokens <= 0) return
  await recordGlobalUsage(tokens)
  try {
    const today = todayDateKey()
    const row = await getOrCreateTodayRow(userId)
    const budget = PLAN_DAILY_TOKEN_BUDGET[plan] ?? PLAN_DAILY_TOKEN_BUDGET.free
    const newTokensUsed = row.tokens_used + tokens

    // Bonus tokens are only consumed by usage ABOVE the plan's own daily
    // allowance — a top-up depletes as it is actually needed, rather than
    // being spent first and wasted on a light day.
    const overageBefore = Math.max(0, row.tokens_used - budget)
    const overageAfter = Math.max(0, newTokensUsed - budget)
    const newBonusTokens = Math.max(0, row.bonus_tokens - (overageAfter - overageBefore))

    const { error } = await supabase
      .from('usage_daily')
      .update({
        tokens_used: newTokensUsed,
        bonus_tokens: newBonusTokens,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('usage_date', today)
    if (error) console.error('[UsageLimits] usage_daily update failed:', error.message)
  } catch (e) {
    console.error('[UsageLimits] Failed to record token usage:', e)
  }
}
