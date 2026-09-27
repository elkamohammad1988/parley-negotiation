// The rehearsal lifecycle, as an explicit state machine.
//
// This used to be three loose strings — 'live', 'complete', 'abandoned' —
// compared ad hoc at a dozen call sites. That shape cannot express the two
// things the product actually needs to forbid: ending a rehearsal twice, and
// scoring one twice. Both were guarded only by an application-layer read
// followed by a write, which is a race, not a guarantee.
//
//     draft ──▶ live ──▶ ended ────▶ debriefed
//       │        │         ▲
//       │        └▶ expired┘
//       │        │
//       └────────┴▶ failed
//
//   draft      A row exists but the counterpart's opening turn has not landed.
//              Distinguishes a half-created rehearsal from a live one.
//   live       In progress. The only state that accepts turns, and the only
//              state — with draft — in which the mandate stays sealed.
//   ended      The user closed it, or walked away. Eligible for scoring.
//   expired    A live rehearsal that outran its window and was reaped rather
//              than closed by hand. Still worth scoring; the transcript is real.
//   debriefed  Scored and persisted. Terminal: the score must never move.
//   failed     Creation or generation broke irrecoverably. Terminal.
//
// This table is mirrored by transition_rehearsal() in supabase_migrations.sql,
// and tests/lifecycle.test.ts asserts the two agree. The database is the
// enforcement point; this module exists so the app can avoid making a call it
// knows will be refused, and so the UI can reason about what a state means.

export type RehearsalStatus = 'draft' | 'live' | 'ended' | 'debriefed' | 'expired' | 'failed'

/** Why a rehearsal left `live`. Kept separately so `ended` stays one state. */
export type EndReason = 'completed' | 'abandoned' | 'expired' | 'failed'

export const REHEARSAL_STATUSES: RehearsalStatus[] = [
  'draft',
  'live',
  'ended',
  'debriefed',
  'expired',
  'failed',
]

export const END_REASONS: EndReason[] = ['completed', 'abandoned', 'expired', 'failed']

/** Legal next states. An empty list is a terminal state. */
export const TRANSITIONS: Record<RehearsalStatus, RehearsalStatus[]> = {
  draft: ['live', 'failed'],
  live: ['ended', 'expired', 'failed'],
  ended: ['debriefed', 'failed'],
  expired: ['debriefed', 'failed'],
  debriefed: [],
  failed: [],
}

export function isRehearsalStatus(value: unknown): value is RehearsalStatus {
  return typeof value === 'string' && (REHEARSAL_STATUSES as string[]).includes(value)
}

export function isEndReason(value: unknown): value is EndReason {
  return typeof value === 'string' && (END_REASONS as string[]).includes(value)
}

/**
 * Normalises whatever came back from the database. Anything unrecognised
 * becomes 'failed' rather than being passed through — an unknown state must
 * not read as 'live' and start accepting turns.
 */
export function toRehearsalStatus(value: unknown): RehearsalStatus {
  return isRehearsalStatus(value) ? value : 'failed'
}

export function canTransition(from: RehearsalStatus, to: RehearsalStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(status: RehearsalStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** Only a live rehearsal accepts turns. */
export function acceptsTurns(status: RehearsalStatus): boolean {
  return status === 'live'
}

/**
 * THE mandate rule, in one place.
 *
 * The counterpart's mandate is the answer the user is trying to discover, so
 * it stays sealed for as long as the rehearsal could still be influenced by
 * knowing it — that is `draft` and `live`. Expressed as an allow-list of the
 * states that MAY reveal, not a deny-list of the two that may not: a new state
 * added to the union defaults to sealed, which is the safe direction.
 */
export function mandateMayBeRevealed(status: RehearsalStatus): boolean {
  return status === 'ended' || status === 'expired' || status === 'debriefed'
}

/** A transcript can be scored once it has stopped growing and is not yet scored. */
export function canGenerateDebrief(status: RehearsalStatus): boolean {
  return status === 'ended' || status === 'expired'
}

/** Where the UI should send someone who opens this rehearsal. */
export function destinationFor(status: RehearsalStatus, id: string): string {
  return status === 'live' || status === 'draft' ? `/room/${id}` : `/debrief/${id}`
}

export const STATUS_LABELS: Record<RehearsalStatus, string> = {
  draft: 'Opening',
  live: 'In progress',
  ended: 'Awaiting debrief',
  debriefed: 'Scored',
  expired: 'Timed out',
  failed: 'Did not start',
}
