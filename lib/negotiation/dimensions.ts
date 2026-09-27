import type { DimensionId } from './types'

// The five dimensions every rehearsal is scored on.
//
// These are the product's spine: they define what the debrief measures, what
// the progress page trends, and what a playbook entry can be filed under.
// Adding a sixth is a real product decision, not a config tweak — the debrief
// prompt, the radar chart and the progress history all assume exactly these.
//
// Chosen because each one is (a) observable in a transcript without knowing
// the real-world outcome, and (b) actually coachable. "Confidence" and
// "likeability" fail both tests and are deliberately absent.

export interface Dimension {
  id: DimensionId
  label: string
  /** Shown under the score in the debrief. */
  question: string
  /** Longer explanation, used in the empty state and help text. */
  detail: string
  /** What a low score usually looks like — used to phrase the coaching. */
  failureMode: string
}

export const DIMENSIONS: Dimension[] = [
  {
    id: 'anchoring',
    label: 'Anchoring',
    question: 'Did you set the frame, or accept theirs?',
    detail:
      'Whoever puts the first credible number or frame on the table moves the midpoint of everything that follows. This measures whether you anchored, how defensible your anchor was, and whether you held it long enough to matter.',
    failureMode: 'Opening with their number, or naming yours and immediately softening it.',
  },
  {
    id: 'concession',
    label: 'Concession pace',
    question: 'What did you give away, and what did you get for it?',
    detail:
      'Concessions are currency. This measures whether yours were traded or donated — every move you made toward them should have bought something back, and your increments should shrink as you approach your limit, not grow.',
    failureMode: 'Bidding against yourself: two concessions in a row with nothing in between.',
  },
  {
    id: 'discovery',
    label: 'Information gain',
    question: 'Did you learn their constraints before you moved?',
    detail:
      'Every counterpart is working from a mandate you cannot see. This measures how much of it you surfaced — their budget, their authority, their deadline, what they are actually rewarded for — and whether you did it before conceding rather than after.',
    failureMode: 'Making your case for ten minutes without asking a single real question.',
  },
  {
    id: 'composure',
    label: 'Composure',
    question: 'What happened to you under pressure?',
    detail:
      'Silence, a raised voice, a deadline, an insult, a flat no. This measures whether your position survived contact with those — or whether you filled the silence, apologised, over-explained, or matched their aggression.',
    failureMode: 'Filling a three-second pause by lowering your own ask.',
  },
  {
    id: 'close',
    label: 'Close',
    question: 'Did you leave with something concrete and dated?',
    detail:
      'Warm agreement that never names a number, an owner and a date is not agreement. This measures whether you converted the conversation into a specific commitment, and whether you confirmed it back before the room broke up.',
    failureMode: 'Ending on "let me think about it" without pinning who does what by when.',
  },
]

export const DIMENSION_BY_ID: Record<DimensionId, Dimension> = DIMENSIONS.reduce(
  (acc, d) => { acc[d.id] = d; return acc },
  {} as Record<DimensionId, Dimension>
)

export const DIMENSION_IDS: DimensionId[] = DIMENSIONS.map(d => d.id)

export function isDimensionId(value: unknown): value is DimensionId {
  return typeof value === 'string' && DIMENSION_IDS.includes(value as DimensionId)
}
