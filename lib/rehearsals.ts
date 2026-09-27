import { supabaseServer as supabase } from './supabase-server'
import { getScenario } from './negotiation/scenarios'
import { getCounterpart } from './negotiation/counterparts'
import { toRehearsalStatus, type EndReason, type RehearsalStatus } from './negotiation/lifecycle'
import type { Counterpart, Rehearsal, Scenario, Turn } from './negotiation/types'
import { toPlan, type Plan } from './plans'

// Server-side data access for rehearsals.
//
// Kept in one module so the room route, the debrief route and the history
// views all read a rehearsal the same way — in particular, all three need the
// scenario resolved and none of them may ever ship the hidden mandate to the
// client before the rehearsal has ended.

export interface LoadedRehearsal {
  rehearsal: Rehearsal
  scenario: Scenario
  counterpart: Counterpart
  turns: Turn[]
}

interface RehearsalRow {
  id: string
  user_id: string
  scenario_slug: string
  scenario_title: string
  counterpart_id: string
  status: string
  end_reason: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  overall_score: number | null
}

const ROW_FIELDS =
  'id, user_id, scenario_slug, scenario_title, counterpart_id, status, end_reason, started_at, ended_at, duration_seconds, overall_score'

interface TurnRow {
  id: string
  rehearsal_id: string
  side: string
  content: string
  position: number
  created_at: string
}

function toRehearsal(row: RehearsalRow, turnCount: number): Rehearsal {
  return {
    id: row.id,
    userId: row.user_id,
    scenarioSlug: row.scenario_slug,
    scenarioTitle: row.scenario_title,
    counterpartId: row.counterpart_id,
    // Anything unrecognised resolves to 'failed', never to 'live'. An unknown
    // state must not start accepting turns or unseal a mandate.
    status: toRehearsalStatus(row.status),
    endReason: (row.end_reason as Rehearsal['endReason']) ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds ?? 0,
    turnCount,
    overallScore: row.overall_score,
  }
}

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    rehearsalId: row.rehearsal_id,
    side: row.side === 'you' ? 'you' : 'counterpart',
    content: row.content,
    position: row.position,
    createdAt: row.created_at,
  }
}

/**
 * Loads a rehearsal with its scenario, counterpart and full transcript.
 * Returns null when the rehearsal does not exist or belongs to someone else —
 * the caller cannot distinguish the two, which is intentional.
 */
export async function loadRehearsal(rehearsalId: string, userId: string): Promise<LoadedRehearsal | null> {
  const { data, error } = await supabase
    .from('rehearsals')
    .select(ROW_FIELDS)
    .eq('id', rehearsalId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[Rehearsals] Load failed:', error.message)
    return null
  }
  if (!data) return null

  const row = data as RehearsalRow
  const scenario = getScenario(row.scenario_slug)
  if (!scenario) {
    console.error('[Rehearsals] Rehearsal references an unknown scenario:', row.scenario_slug)
    return null
  }

  // A counterpart that no longer resolves — a custom one the user deleted —
  // must not make the rehearsal unreadable: the transcript and the debrief are
  // the user's record, and the mandate they earned is in it. It is served
  // under a stand-in instead, and the turn route refuses to continue against
  // it, so the only thing lost is the ability to keep talking to someone who
  // is no longer on file.
  const counterpart =
    (await resolveCounterpart(row.counterpart_id, userId)) ?? retiredCounterpart(row.counterpart_id)

  const turns = await loadTurns(rehearsalId)
  return { rehearsal: toRehearsal(row, turns.length), scenario, counterpart, turns }
}

export async function loadTurns(rehearsalId: string): Promise<Turn[]> {
  const { data, error } = await supabase
    .from('rehearsal_turns')
    .select('id, rehearsal_id, side, content, position, created_at')
    .eq('rehearsal_id', rehearsalId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[Rehearsals] Turn load failed:', error.message)
    return []
  }
  return ((data ?? []) as TurnRow[]).map(toTurn)
}

/**
 * Appends a turn. Returns false if it did not land.
 *
 * The result used to be discarded after a console.error, so a turn could
 * silently vanish from the transcript while the request carried on as if it
 * had been saved — and the debrief would later score a conversation that never
 * happened. The two realistic failures are a unique violation on
 * (rehearsal_id, position), which is two concurrent sends colliding, and the
 * database being unreachable. Both are now the caller's problem to handle.
 */
export async function appendTurn(
  rehearsalId: string,
  side: 'you' | 'counterpart',
  content: string,
  position: number
): Promise<boolean> {
  const { error } = await supabase.from('rehearsal_turns').insert({
    rehearsal_id: rehearsalId,
    side,
    content,
    position,
  })
  if (error) {
    console.error('[Rehearsals] Failed to append turn:', error.message)
    return false
  }
  return true
}

/** Fetches the user's plan. Defaults to free on any failure. */
export async function getUserPlan(userId: string): Promise<Plan> {
  if (!userId) return 'free'
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .maybeSingle()
    return toPlan(data?.plan)
  } catch (e) {
    console.error('[Rehearsals] Plan lookup failed, defaulting to free:', e)
    return 'free'
  }
}

export type TransitionOutcome =
  | { ok: true; status: RehearsalStatus; changed: boolean }
  | { ok: false; reason: 'not_found' | 'illegal' | 'error'; detail?: string }

/**
 * Moves a rehearsal to a new state through the database, which is where the
 * machine is actually enforced (transition_rehearsal in supabase_migrations.sql).
 *
 * This replaces a read-then-write that could not be correct: the room ends a
 * session on an explicit click AND on the timer, the debrief page ends it again
 * if that did not land, and two tabs can do any of it at once. All of those
 * raced through the old select/update pair. The function does the check and the
 * write under a row lock instead.
 *
 * `changed: false` means it was already in the target state — a retry, not an
 * error. `reason: 'illegal'` means the machine forbids the move, which is how a
 * scored rehearsal is stopped from being reopened and re-scored.
 */
export async function transitionRehearsal(
  rehearsalId: string,
  userId: string,
  to: RehearsalStatus,
  endReason?: EndReason
): Promise<TransitionOutcome> {
  const { data, error } = await supabase.rpc('transition_rehearsal', {
    p_rehearsal_id: rehearsalId,
    p_user_id: userId,
    p_to: to,
    p_end_reason: endReason ?? null,
  })

  if (error) {
    const message = error.message ?? ''
    if (message.includes('rehearsal_not_found')) return { ok: false, reason: 'not_found' }
    if (message.includes('illegal_transition')) {
      return { ok: false, reason: 'illegal', detail: message }
    }
    console.error('[Rehearsals] Transition failed:', message)
    return { ok: false, reason: 'error', detail: message }
  }

  // A Postgres `returns table` comes back as an array of rows.
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, reason: 'error', detail: 'no row returned' }

  return { ok: true, status: toRehearsalStatus(row.status), changed: row.changed === true }
}

/**
 * Claims the right to generate a debrief. False means someone else already
 * holds the claim, or one already exists — the caller should return the
 * existing debrief rather than paying for a second model call.
 */
export async function claimDebrief(rehearsalId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_debrief', {
    p_rehearsal_id: rehearsalId,
    p_user_id: userId,
  })
  if (error) {
    console.error('[Rehearsals] Debrief claim failed:', error.message)
    return false
  }
  return data === true
}

/**
 * Releases a claim after a generation that produced nothing to persist.
 *
 * claim_debrief() lapses on its own after three minutes, which is the right
 * behaviour for a process that died mid-generation. It is the wrong behaviour
 * for a provider that answered 503 in two seconds: the claim would still be
 * held, and the user's immediate retry would be told the debrief is "already
 * being written" when nothing is. Releasing it makes the retry honest.
 */
export async function releaseDebriefClaim(rehearsalId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('rehearsals')
    .update({ debrief_claimed_at: null })
    .eq('id', rehearsalId)
    .eq('user_id', userId)
  if (error) console.error('[Rehearsals] Could not release debrief claim:', error.message)
}

// ─── Counterpart resolution ─────────────────────────────────────────────────
//
// A rehearsal's counterpart_id is either a built-in archetype id or the uuid
// of a row in custom_counterparts. Until this existed, every reader resolved
// only the built-ins — so the brief offered a user's own counterpart, the
// session route refused it as unknown, and a rehearsal that somehow carried
// one could not be loaded at all. The custom lookup is scoped to the caller's
// user id, which is the whole authorisation model for custom counterparts:
// you can only ever rehearse against someone you wrote.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CustomCounterpartRow {
  id: string
  name: string
  role: string
  disposition: string
  tactics: unknown
  tell: string | null
}

function toCustomCounterpart(row: CustomCounterpartRow): Counterpart {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    disposition: row.disposition,
    tactics: Array.isArray(row.tactics) ? row.tactics.filter((t): t is string => typeof t === 'string') : [],
    tell: row.tell ?? '',
    builtIn: false,
  }
}

/**
 * Resolves a counterpart id for one user: a built-in, or one of that user's
 * own custom counterparts. Null when it is neither — including when the row
 * exists but belongs to someone else, which the caller cannot distinguish
 * from "does not exist", deliberately.
 *
 * Built-ins never touch the database, so the common path costs nothing.
 */
export async function resolveCounterpart(id: string, userId: string): Promise<Counterpart | null> {
  const builtIn = getCounterpart(id)
  if (builtIn) return builtIn
  if (!userId || !UUID_RE.test(id)) return null

  const { data, error } = await supabase
    .from('custom_counterparts')
    .select('id, name, role, disposition, tactics, tell')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[Rehearsals] Custom counterpart lookup failed:', error.message)
    return null
  }
  return data ? toCustomCounterpart(data as CustomCounterpartRow) : null
}

/**
 * Stand-in for a counterpart id that no longer resolves. Carries no
 * disposition and is flagged, so the turn route can refuse to build a prompt
 * from it while the record itself stays readable.
 */
export function retiredCounterpart(id: string): Counterpart {
  return {
    id,
    name: 'Counterpart no longer on file',
    role: 'This counterpart has since been deleted',
    disposition: '',
    tactics: [],
    tell: '',
    builtIn: false,
    retired: true,
  }
}

export interface RehearsalSummary {
  id: string
  scenarioSlug: string
  scenarioTitle: string
  counterpartId: string
  counterpartName: string
  status: RehearsalStatus
  endReason: EndReason | null
  startedAt: string
  durationSeconds: number
  overallScore: number | null
}

export async function listRehearsals(userId: string, limit = 40): Promise<RehearsalSummary[]> {
  const { data, error } = await supabase
    .from('rehearsals')
    .select('id, scenario_slug, scenario_title, counterpart_id, status, end_reason, started_at, duration_seconds, overall_score')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[Rehearsals] List failed:', error.message)
    return []
  }

  const rows = (data ?? []) as RehearsalRow[]

  // One query for every custom counterpart the list refers to, so history rows
  // carry the name the user gave rather than a generic label. A deleted one
  // simply falls through to the label.
  const customIds = [...new Set(rows.map(r => r.counterpart_id).filter(id => !getCounterpart(id) && UUID_RE.test(id)))]
  const customNames = new Map<string, string>()
  if (customIds.length > 0) {
    const { data: custom, error: customError } = await supabase
      .from('custom_counterparts')
      .select('id, name')
      .eq('user_id', userId)
      .in('id', customIds)
    if (customError) console.error('[Rehearsals] Custom counterpart names failed:', customError.message)
    for (const c of (custom ?? []) as { id: string; name: string }[]) customNames.set(c.id, c.name)
  }

  return rows.map(row => ({
    id: row.id,
    scenarioSlug: row.scenario_slug,
    scenarioTitle: row.scenario_title,
    counterpartId: row.counterpart_id,
    counterpartName: getCounterpart(row.counterpart_id)?.name ?? customNames.get(row.counterpart_id) ?? 'Counterpart',
    status: toRehearsalStatus(row.status),
    endReason: (row.end_reason as EndReason | null) ?? null,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds ?? 0,
    overallScore: row.overall_score,
  }))
}
