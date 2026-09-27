// What a user can tell us went wrong with a rehearsal.
//
// The reason codes are the failure modes this product actually has, not a
// generic "inappropriate" bucket. Four of the six are specific to a rehearsal
// against a counterpart holding a mandate, and each one names something a
// reader of the reports table can act on:
//
//   broke-role        the counterpart coached, praised, or acknowledged being a
//                     simulation. The single behaviour the concession ladder
//                     and the prompt in ./prompt.ts exist to prevent.
//   revealed-mandate  it disclosed what it was holding. lib/negotiation/
//                     leakGuard.ts is the server-side net for this; a report
//                     means one got through, or that the counterpart gave it
//                     away in a form the shingle window does not catch.
//   too-easy          it folded. "A counterpart that folds is broken" is the
//                     product rule in CLAUDE.md, and this is the only way a
//                     user can tell us one did.
//   nonsensical       the replies stopped being a conversation.
//   abusive           the counterpart produced something distressing. Pressure
//                     is the point; abuse is not.
//   other             everything else, with the detail field carrying it.
//
// WHY THIS MODULE EXISTS RATHER THAN A SET IN THE ROUTE. The ids were declared
// in app/api/report/route.ts and the labels a user picks from would have been
// declared again in the debrief screen. Two lists of the same closed set drift:
// a seventh reason added to one is silently rejected by the other, and the
// failure is a 400 on a form that looks fine. Declaring them once means the
// route validates exactly what the UI can send.

export const REPORT_REASONS = [
  {
    id: 'broke-role',
    label: 'They stopped being the counterpart',
    hint: 'Coached you, praised a good question, or acknowledged being an AI.',
  },
  {
    id: 'too-easy',
    label: 'They gave in too easily',
    hint: 'Conceded without being moved, or agreed to something for nothing.',
  },
  {
    id: 'revealed-mandate',
    label: 'They gave away what they were holding',
    hint: 'Told you their limit or their instructions instead of defending them.',
  },
  {
    id: 'nonsensical',
    label: 'Their replies did not make sense',
    hint: 'Contradicted themselves, or answered something you had not said.',
  },
  {
    id: 'abusive',
    label: 'Something abusive or distressing',
    hint: 'Pressure is the point. This is not.',
  },
  {
    id: 'other',
    label: 'Something else',
    hint: 'Tell us below.',
  },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['id']

const REASON_IDS: ReadonlySet<string> = new Set(REPORT_REASONS.map(r => r.id))

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && REASON_IDS.has(value)
}

/** Matches the `detail` column's bound in app/api/report. */
export const MAX_REPORT_DETAIL = 1000
