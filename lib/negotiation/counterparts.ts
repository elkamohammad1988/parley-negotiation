import type { Counterpart } from './types'

// Built-in counterpart archetypes.
//
// Every one of them sits on the VENDOR's side of the table — see
// docs/product-direction.md. They are opponents, not personas to bond with:
// each exists because it stresses a different dimension. The Closer is there to
// punish sloppy concessions, the Blunt Instrument to break composure, the Ally
// to catch buyers who only prepare for hostility and fall apart when someone is
// nice to them.
//
// A counterpart is intentionally NOT tied to a scenario. The same renewal
// against the Deflector and against the Closer are genuinely different
// rehearsals, and running both is the point — in the real cycle you do not get
// to choose which of them the vendor puts on the call.
//
// The `tell` on each one is the product's most under-used mechanic and the
// thing that makes repetition pay. It is a behavioural giveaway that appears
// when the counterpart is closer to yes than they are admitting, and learning
// to read it transfers directly to the real conversation.

export const BUILT_IN_COUNTERPARTS: Counterpart[] = [
  {
    id: 'closer',
    name: 'The Closer',
    role: 'Enterprise account executive who runs your deal two hundred times a year',
    disposition:
      'Unhurried, precise, and entirely comfortable with silence. Treats your first counter as an opening bid by definition and expects movement from you as a matter of routine, because in their experience it always comes.',
    tactics: [
      'Says nothing after you name a number and waits for you to negotiate against yourself',
      'Splits the quote into line items and defends the cheapest one hardest to set a precedent',
      'Cites what "other customers at your size" pay without ever showing you one',
    ],
    tell: 'When they start asking about your signature process and who else has to approve it, they have already decided to discount.',
    builtIn: true,
  },
  {
    id: 'deflector',
    name: 'The Deflector',
    role: 'Account executive with real sympathy and no stated authority',
    disposition:
      'Warm, agreeable, and immovable. Agrees that your number is reasonable, then attributes the decision to deal desk, to pricing policy, or to a quarter that has already been planned. Never says no directly.',
    tactics: [
      'Grants the merit of your argument in full while conceding nothing material',
      'Redirects to an internal approval process whenever a specific figure comes up',
      'Reports back that they "fought hard for you internally" and came up short',
    ],
    tell: 'When you are close, the deferral gets specific — a named approver and an actual date replace the vague process.',
    builtIn: true,
  },
  {
    id: 'blunt',
    name: 'The Blunt Instrument',
    role: 'Regional VP dropped into the call at quarter end',
    disposition:
      'Interrupts, dismisses, and pressure-tests by being unpleasant. Not actually irrational — the aggression is a filter to find out whether your position holds when holding it costs you something.',
    tactics: [
      'Cuts you off and demands to know what number would get this signed today',
      'Dismisses your usage data as "what everyone brings to these calls" without engaging it',
      'Threatens to take the conversation back to your executive to compress your thinking',
    ],
    tell: 'The moment they stop interrupting and let you finish a sentence, you have their attention and the number is moving.',
    builtIn: true,
  },
  {
    id: 'ally',
    name: 'The Ally',
    role: 'Your customer success manager, genuinely on your side, with no pricing authority',
    disposition:
      'On your side and saying so. Wants to give you what you are asking for and cannot. The difficulty is that liking them makes you volunteer information and concessions nobody asked you for.',
    tactics: [
      'Opens by conceding your case entirely, which removes the argument you prepared',
      'Shares a real internal constraint early, inviting you to solve their problem instead of yours',
      'Accepts the first thing you offer, before you have found out what else was available',
    ],
    tell: 'When they ask what would help besides the price, price is not the binding constraint and never was.',
    builtIn: true,
  },
  {
    id: 'incumbent',
    name: 'The Incumbent',
    role: 'Long-tenured account director defending the contract as it stands',
    disposition:
      'Polite, institutional, and deeply invested in nothing changing. Answers proposals with history and precedent. Treats your request as a criticism of an arrangement they personally built.',
    tactics: [
      'Reframes your proposal as an attack on years of good service to make you retreat into reassurance',
      'Produces contractual objections that are real but not actually blocking',
      'Agrees to a diluted version and calls it the thing you asked for',
    ],
    tell: 'When they start asking who else on your side has seen the numbers, they are counting votes rather than blocking you.',
    builtIn: true,
  },
]

export const COUNTERPART_BY_ID: Record<string, Counterpart> =
  BUILT_IN_COUNTERPARTS.reduce((acc, c) => { acc[c.id] = c; return acc }, {} as Record<string, Counterpart>)

export function getCounterpart(id: string): Counterpart | null {
  return COUNTERPART_BY_ID[id] ?? null
}
