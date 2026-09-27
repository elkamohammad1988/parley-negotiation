import 'server-only' // every hiddenMandate lives here; a client import is a build error
import type { Category, Difficulty, Scenario, ScoredLever } from './types'

// The built-in scenario library.
//
// Every scenario here is a VENDOR negotiation seen from the BUYER's chair, and
// that choice is the product's whole commercial position. See
// docs/product-direction.md for why. The short version: the person across the
// table runs this deal a hundred and fifty times a year with a discount matrix,
// a deal desk, an approval ladder and a quarter-end clock behind them. You run
// it twice, with a spreadsheet. Every scenario below is built on a specific,
// documented piece of that asymmetry.
//
// Every scenario carries a hiddenMandate that the user is not shown until the
// debrief. That asymmetry is the design: without it the rehearsal is a writing
// exercise, because you already know what they will accept. With it, asking
// good questions is the only way to find the deal — which is exactly what the
// Information gain dimension measures.
//
// Ranges in a mandate are deliberate. A counterpart who can go to "twelve per
// cent alone, four with deal desk, zero against a reference call" produces a
// different conversation from one with a single hard number, and it stops the
// model from simply capitulating to any confident-sounding demand.
//
// Two rules for writing a mandate, both learned the hard way:
//
//   1. Everything in it must be reachable by a question a real buyer could
//      think to ask. A mandate that can only be discovered by luck scores the
//      user on luck.
//   2. At least one thing in it must be free — a lever that costs the vendor
//      nothing and that they will never volunteer. That is the lesson the
//      debrief exists to deliver.
//
// Every mandate is ALSO written out as `mandateLevers`: the same secret, one
// row per thing that was actually on the table. The prose is what the user
// reads; the levers are what the product can count. They exist because
// "Information gain: 48" is a number nobody can argue with or learn from,
// whereas "you found two of the five things they were holding, and the one you
// missed was free" is a specific, checkable claim about a specific
// conversation — and it is the difference between a score and a debrief.
//
// The two must not drift. `tests/levers.test.ts` holds the invariants: every
// scenario has levers, ids are unique, at least one is marked free, and every
// lever's substance is traceable to the prose mandate it was decomposed from.

export const CATEGORY_LABELS: Record<Category, string> = {
  renewal: 'Renewal & uplift',
  pricing: 'Price & discount',
  terms: 'Terms & contract',
  escalation: 'Escalation & pressure',
  exit: 'Exit & switching',
  'new-buy': 'New purchase',
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  measured: 'Measured',
  firm: 'Firm',
  hostile: 'Hostile',
}

export const SCENARIOS: Scenario[] = [
  {
    slug: 'renewal-uplift',
    title: 'A 22% uplift on your largest software renewal',
    category: 'renewal',
    difficulty: 'firm',
    premise: 'Your biggest vendor wants twenty-two per cent more for the same thing.',
    situation:
      'You own vendor management at a 900-person company. Your data platform contract — $340,000 a year, the second-largest line in your software budget — renews in five weeks. The quote came back at a 22% uplift, described in the email as a standard annual adjustment. The account executive on the call has run this exact conversation many times this year. You have run it twice.',
    objective:
      'Land the uplift at 8% or below, or leave with a written cap on next year. A number, an owner, and a date.',
    constraints: [
      'Your engineering team has already built on it, so switching this year is not credible and they may know it',
      'Anything above 10% needs your CFO, who is out until after the renewal date',
      'You have no benchmark data on what comparable customers actually pay',
    ],
    counterpartRole: 'The vendor’s enterprise account executive',
    hiddenMandate:
      'Their own approval ceiling is 12%, and they will present it as a hard-won exception when they reach it. Deal desk has already modelled and approved 4% against a two-year term, which they are instructed not to raise first. A flat renewal is genuinely available, but only in exchange for a named reference call and a published case study — a non-price lever they will mention only if the buyer asks what is available other than price. Their quarter closes in three weeks and this deal is on the forecast, so time pressure runs against them, not the buyer. They cannot move the renewal date itself; it is set by the contract. The "standard adjustment" is not standard: it is a list-price uplift applied to accounts that did not negotiate last year.',
    mandateLevers: [
      {
        id: 'ceiling-12',
        label: 'They can approve 12% alone, and will present it as an exception',
        kind: 'price',
        unlockedBy: 'Pushing past the first refusal instead of treating 22% as decided.',
      },
      {
        id: 'deal-desk-4',
        label: '4% is already approved against a two-year term',
        kind: 'trade',
        unlockedBy: 'Putting term length on the table — they are instructed never to raise it first.',
      },
      {
        id: 'flat-for-reference',
        label: 'A flat renewal for a named reference call and a case study',
        kind: 'trade',
        free: true,
        unlockedBy: 'Asking what is available other than price. They mention it on no other cue.',
      },
      {
        id: 'quarter-clock',
        label: 'Their quarter closes in three weeks and this deal is on the forecast',
        kind: 'intel',
        unlockedBy: 'Asking about their timing rather than only defending your own.',
      },
      {
        id: 'uplift-not-standard',
        label: 'The "standard adjustment" only goes to accounts that did not negotiate last year',
        kind: 'intel',
        unlockedBy: 'Asking who else is getting this number, and what happens to accounts that push back.',
      },
      {
        id: 'renewal-date-fixed',
        label: 'The renewal date itself is contractual and genuinely cannot move',
        kind: 'immovable',
        unlockedBy: 'Testing it once. Pushing after that spends time you needed for price.',
      },
    ],
    opening:
      "Good to get time with you. I'll be upfront — the twenty-two is our standard annual adjustment this year, it's going out across the base, so there isn't a great deal of room in it. What I'd rather spend the half hour on is what you need from us over the next twelve months.",
    tactics: [
      'Frames the increase as an already-decided, market-wide adjustment rather than a proposal',
      'Redirects from price to roadmap and "what you need next year" whenever a number is named',
      'Offers extra modules or seats in place of a lower rate',
    ],
    walkAway:
      'They stop making offers if you state a switching threat you plainly cannot carry out, because it tells them your alternatives are worse than they had assumed.',
    estimatedMinutes: 14,
  },
  {
    slug: 'best-and-final',
    title: 'Testing a "best and final" price',
    category: 'pricing',
    difficulty: 'measured',
    premise: 'They said it is their best price. It is their approval limit.',
    situation:
      'A security vendor has come back on a three-year deal at $118,000 a year, down from an opening $140,000. The rep has called it their best and final twice and has stopped moving. You have thirty minutes to work out whether that is the floor of the price or the ceiling of one person’s authority.',
    objective:
      'Find out who approves the next level and what it would take, then leave with either a better number or a named escalation and a date.',
    constraints: [
      'You genuinely want this vendor, there is no strong second option, and the rep may sense it',
      'Your approved budget is $105,000 a year and it will not move',
      'You cannot delay past quarter end; the incumbent tool’s contract ends then',
    ],
    counterpartRole: 'The vendor’s mid-market account executive',
    hiddenMandate:
      '$118,000 is exactly their personal discount authority, not a floor. Their regional director can approve down to $104,000 and routinely does in the last two weeks of a quarter. The rep has not asked, because asking twice in one quarter shows up on their record — so they need a reason to take back, not permission. They will escalate the moment the buyer hands them something to escalate with: a signed-by date, a third year, or a reference commitment. What they genuinely cannot move is payment terms, which finance fixes at net 30 for every account regardless of size.',
    mandateLevers: [
      {
        id: 'authority-not-floor',
        label: '$118k is their personal approval limit, not the price floor',
        kind: 'intel',
        unlockedBy: 'Asking who signs off at the next level, rather than arguing the number itself.',
      },
      {
        id: 'director-104',
        label: 'Their regional director can approve $104,000',
        kind: 'price',
        unlockedBy: 'Getting them to name the person above them and what that person can do.',
      },
      {
        id: 'needs-a-reason',
        label: 'They need a reason to escalate, not permission — asking twice marks their record',
        kind: 'intel',
        free: true,
        unlockedBy: 'Asking what would make the request worth making. They will never volunteer the cost to them.',
      },
      {
        id: 'escalation-currency',
        label: 'A signed-by date, a third year, or a reference will buy the escalation',
        kind: 'trade',
        unlockedBy: 'Offering something concrete to carry upstairs instead of only pressing for less.',
      },
      {
        id: 'net-30-fixed',
        label: 'Payment terms are fixed at net 30 by finance, for every account',
        kind: 'immovable',
        unlockedBy: 'Asking once. There is no version of this call where terms move.',
      },
    ],
    opening:
      "So — I went back and got you to one-eighteen, which is honestly further than I normally get on a deal this size. That's our best price. I'd love to get this wrapped up this week if we can.",
    tactics: [
      'Repeats "best price" as a settled fact rather than defending it as a position',
      'Presents their own internal approval difficulty as your constraint',
      'Offers speed — "wrapped up this week" — as though it were a concession to you',
    ],
    walkAway:
      'They disengage if you dismiss the work they did to reach the current number, because the only route below it runs through them asking a favour they do not have to ask for.',
    estimatedMinutes: 12,
  },
  {
    slug: 'auto-renewal-lapsed',
    title: 'Negotiating after the cancellation window closed',
    category: 'terms',
    difficulty: 'hostile',
    premise: 'The notice period lapsed eleven days ago. They know it.',
    situation:
      'Your CRM contract auto-renewed for another twelve months at a 15% uplift because nobody served notice inside the ninety-day window. Finance found it on the invoice. You are now on a call with the vendor’s account director to find out what, if anything, is still negotiable on a contract that is technically already signed.',
    objective:
      'Recover something real — a credit, a scope reduction, or a shorter next term — and leave with the next notice date owned by a named person.',
    constraints: [
      'You have no legal leverage; the clause is clean and your own team missed it',
      'Your CIO wants this closed quietly and will not escalate on your behalf',
      'You cannot stop using the product mid-year',
    ],
    counterpartRole: 'The vendor’s account director',
    hiddenMandate:
      'They have full authority to reopen the term and do it often, because a renewal enforced against a resentful customer becomes a churn number at the next cycle and their compensation is weighted to retention rather than this year’s uplift. What they will not do under any circumstances is reverse the uplift in cash, because that admits the clause was unfair. Without asking anyone they can convert the twelve months to a shorter term, strip modules the account does not use, or grant service credits worth up to eight per cent. They will offer none of it if the buyer opens by disputing the clause, because that turns the call into a legal matter they are required to route away from themselves.',
    mandateLevers: [
      {
        id: 'retention-comp',
        label: 'They are paid on retention, not on this year’s uplift',
        kind: 'intel',
        free: true,
        unlockedBy: 'Asking what happens to this account at the next renewal — their incentive is the whole lever.',
      },
      {
        id: 'shorter-term',
        label: 'They can convert the twelve months to a shorter term on their own authority',
        kind: 'trade',
        unlockedBy: 'Asking for a change to the term rather than a change to the invoice.',
      },
      {
        id: 'strip-modules',
        label: 'They can strip modules the account does not use',
        kind: 'trade',
        unlockedBy: 'Talking about what you actually use, which nobody on this call has raised.',
      },
      {
        id: 'service-credits-8',
        label: 'Service credits worth up to 8% are available without asking anyone',
        kind: 'price',
        unlockedBy: 'Asking for value back in a form that is not a refund.',
      },
      {
        id: 'no-cash-reversal',
        label: 'They will never reverse the uplift in cash — it concedes the clause was unfair',
        kind: 'immovable',
        unlockedBy: 'Asking once. Disputing the clause itself ends the call in legal.',
      },
    ],
    opening:
      "I've got the account open in front of me. So — the renewal processed on the fourteenth, notice window closed on the third. I do understand it's frustrating, but the term is in place. What can I help you with?",
    tactics: [
      'Establishes the contract as settled fact in the first sentence',
      'Offers sympathy that costs nothing and concedes nothing',
      'Proposes making "a note for next year" in place of anything at all this year',
    ],
    walkAway:
      'They route the call to legal and end it if you dispute the validity of the notice clause, which is the one move that takes the decision out of their hands.',
    estimatedMinutes: 13,
  },
  {
    slug: 'bundled-expansion',
    title: 'Untangling an upsell from a renewal',
    category: 'new-buy',
    difficulty: 'firm',
    premise: 'They quoted one number for two entirely different decisions.',
    situation:
      'Your observability vendor has sent a single quote that folds together next year’s licence, a new AI add-on your engineering director asked about once, and a seat expansion nobody has agreed to. One number: $210,000, up from $128,000. The rep wants to treat it as one conversation. Your engineering director is on the call and already wants the add-on.',
    objective:
      'Close the renewal on its own terms first, and leave with the expansion either priced separately and dated, or dropped.',
    constraints: [
      'Your engineering director genuinely wants the add-on and will say so out loud on this call',
      'You cannot make the renewal contingent on dropping it; you need the platform either way',
      'Anything above $150,000 goes to a procurement committee that meets once a month',
    ],
    counterpartRole: 'The vendor’s strategic account manager',
    hiddenMandate:
      'The bundle exists to hide the renewal uplift, which is 19% standing on its own. The add-on launched this quarter and has almost no paying customers; they are authorised to give twelve months of it free to any account that will take a reference call, and internally the logo is worth far more to them than the revenue. The seat expansion is padding they fully expect to lose and have not forecast. If the renewal is priced alone they have to show the 19% in writing, which is the outcome they are working to avoid. They will not separate the line items unless they are asked directly, and then asked again.',
    mandateLevers: [
      {
        id: 'renewal-is-19',
        label: 'The renewal alone is a 19% uplift — the bundle exists to hide it',
        kind: 'intel',
        unlockedBy: 'Asking for the line items separately, directly, and then asking a second time.',
      },
      {
        id: 'addon-free-for-reference',
        label: 'Twelve months of the add-on free, for any account that takes a reference call',
        kind: 'trade',
        free: true,
        unlockedBy: 'Asking what the add-on costs on its own, and what would make it cheaper.',
      },
      {
        id: 'seats-are-padding',
        label: 'The seat expansion is padding they expect to lose and have not forecast',
        kind: 'price',
        unlockedBy: 'Asking who asked for the seats. Nobody did, and they know it.',
      },
      {
        id: 'logo-over-revenue',
        label: 'The add-on has almost no customers — your logo is worth more to them than the revenue',
        kind: 'intel',
        unlockedBy: 'Asking how many accounts are live on it, before agreeing to want it.',
      },
      {
        id: 'written-19',
        label: 'Priced alone, they have to put the 19% in writing — the thing they are avoiding',
        kind: 'trade',
        unlockedBy: 'Insisting the renewal is settled on its own terms before anything else is discussed.',
      },
    ],
    opening:
      "I've put it all in one place for you — the renewal, the AI package your team asked about, and the seats to cover the new region. Two-ten all in, which nets out cheaper than doing them separately. Shall I walk you through it?",
    tactics: [
      'Presents the bundle as a discount rather than as a way of hiding the baseline',
      'Speaks to the engineering director whenever procurement pushes on price',
      'Answers any question about one line item by returning to the total',
    ],
    walkAway:
      'They stop engaging on the add-on if you dismiss it in front of your own engineering director, because their route into this account is your team and not you.',
    estimatedMinutes: 15,
  },
  {
    slug: 'escalated-over-your-head',
    title: 'The vendor went over your head',
    category: 'escalation',
    difficulty: 'hostile',
    premise: 'Their VP emailed your CIO. Your CIO forwarded it to you.',
    situation:
      'Three days after you told the rep the uplift was not approvable, their VP of Sales emailed your CIO directly about "the partnership". Your CIO forwarded it on with one line: "Can we just get this done?" You now have a call with that VP, who has never been on this account before.',
    objective:
      'Put the commercial conversation back in your hands and leave with a number, without making your CIO defend you to do it.',
    constraints: [
      'Your CIO has already signalled they will sign just to end the noise',
      'You are right about the pricing and have the usage data to prove it, but nobody has asked for it',
      'You cannot afford to look obstructive; this vendor is embedded in three teams',
    ],
    counterpartRole: 'The vendor’s VP of Sales',
    hiddenMandate:
      'The escalation is the play, not the relationship. They hold no commercial authority the account executive did not already have — they are on the call because the AE’s forecast is short and a VP call closes deals that stall in procurement. They have never looked at this account’s utilisation and are not prepared to. If the buyer puts real usage numbers on the table, the VP hands the deal straight back to the AE with instructions to fix it, because a VP who loses an hour to a data argument has already lost the hour. What they actually want is a signature inside the quarter, and they will trade almost any non-price term to get a date.',
    mandateLevers: [
      {
        id: 'no-extra-authority',
        label: 'The VP holds no commercial authority the account executive did not already have',
        kind: 'intel',
        unlockedBy: 'Asking directly what they can approve that the AE could not.',
      },
      {
        id: 'unprepared-on-usage',
        label: 'They have never looked at your utilisation and are not prepared to',
        kind: 'intel',
        free: true,
        unlockedBy: 'Putting one real usage number on the table and asking them to respond to it.',
      },
      {
        id: 'hands-back-to-ae',
        label: 'Faced with real data they hand the deal back to the AE to fix',
        kind: 'price',
        unlockedBy: 'Staying on the numbers. A VP who loses an hour to a data argument has lost the hour.',
      },
      {
        id: 'date-over-price',
        label: 'They will trade almost any non-price term for a signature inside the quarter',
        kind: 'trade',
        unlockedBy: 'Asking what they need by when, then pricing the date rather than the licence.',
      },
      {
        id: 'relationship-is-cover',
        label: 'The partnership framing is the play, not a position you can argue with',
        kind: 'immovable',
        unlockedBy: 'Declining to engage with it. Attacking the escalation sends them back to your CIO.',
      },
    ],
    opening:
      "Appreciate you making the time. Your CIO and I had a good conversation last week — sounds like we're aligned on where this is going. I wanted to come in directly because I don't think we should let a point or two get in the way of a five-year relationship.",
    tactics: [
      'Quotes your own executive back to you as though it were settled agreement',
      'Frames your objection as a rounding error set against the relationship',
      'Keeps the conversation in partnership language and away from any specific figure',
    ],
    walkAway:
      'They go back to your CIO and stop dealing with you if you attack the escalation itself rather than simply out-preparing it.',
    estimatedMinutes: 12,
  },
  {
    slug: 'alternative-you-cannot-take',
    title: 'Using an alternative you could not actually take',
    category: 'exit',
    difficulty: 'firm',
    premise: 'Migrating would cost two quarters you do not have.',
    situation:
      'You have told your payroll vendor you are evaluating alternatives. You are — but the migration would run two quarters across three countries, and your Head of People has already said she will not sign it off this year. The renewal call is today, and the vendor has put a retention specialist on it.',
    objective:
      'Convert an alternative you cannot take into a real concession, without being caught claiming something you cannot do.',
    constraints: [
      'The competing quote is real, but for a product that does not cover two of your countries',
      'Your Head of People will say no to migration if the vendor asks her directly, and they may',
      'You have eight weeks before the current term ends',
    ],
    counterpartRole: 'The vendor’s retention specialist',
    hiddenMandate:
      'Their churn model already scores this account as very unlikely to leave — multi-country payroll migrations rarely complete, and they track completion rates. They are nonetheless authorised to give a 14% reduction to any account that reaches a retention call at all, because reaching one is the expensive signal, not the threat itself. They will not give it to a buyer who overstates their alternative: their script treats one provably false claim as evidence the account is bluffing about everything else, and they drop to list. A buyer who describes the alternative accurately, gaps and all, reads as serious and gets the full reduction. They can also release the account from the auto-renewal clause entirely, which costs them nothing and which they will never offer.',
    mandateLevers: [
      {
        id: 'reduction-14',
        label: '14% is authorised for any account that reaches a retention call at all',
        kind: 'price',
        unlockedBy: 'Reaching this call. The threat was never the expensive signal — getting here was.',
      },
      {
        id: 'accuracy-is-the-lever',
        label: 'Describing the alternative accurately, gaps and all, is what unlocks the full reduction',
        kind: 'trade',
        unlockedBy: 'Naming what your alternative cannot do before they find it themselves.',
      },
      {
        id: 'one-false-claim',
        label: 'One provably false claim drops them to list price on everything',
        kind: 'intel',
        unlockedBy: 'Not being caught. Their script treats a single overstatement as proof of a bluff.',
      },
      {
        id: 'auto-renewal-release',
        label: 'They can release you from the auto-renewal clause entirely',
        kind: 'trade',
        free: true,
        unlockedBy: 'Asking for a term change rather than a price change. It costs them nothing and they never offer it.',
      },
      {
        id: 'churn-model',
        label: 'Their churn model already scores you as very unlikely to leave',
        kind: 'immovable',
        unlockedBy: 'Nothing you say changes it. The migration completion rate is the number they trust.',
      },
    ],
    opening:
      "Thanks for being straight with us about the evaluation — genuinely, most people aren't. Before we talk about numbers I'd like to understand it properly. Who are you looking at, and what have they quoted you?",
    tactics: [
      'Asks for specifics about the alternative in order to find the hole in it',
      'Offers to speak to your internal stakeholders "to help build the business case"',
      'Treats any vagueness about the competing quote as proof that there is not one',
    ],
    walkAway:
      'They close the conversation back at list price if you claim the alternative covers something it does not and they catch it.',
    estimatedMinutes: 14,
  },
]

export const SCENARIO_BY_SLUG: Record<string, Scenario> =
  SCENARIOS.reduce((acc, s) => { acc[s.slug] = s; return acc }, {} as Record<string, Scenario>)

export function getScenario(slug: string): Scenario | null {
  return SCENARIO_BY_SLUG[slug] ?? null
}

export function scenariosByCategory(category: Category): Scenario[] {
  return SCENARIOS.filter(s => s.category === category)
}

/**
 * Turns the ids the debrief model returned into the scenario's WHOLE lever set
 * with a verdict on each.
 *
 * Returns every lever, not the found ones: the number that matters to the user
 * is a fraction, and the missed rows are the half of the reveal that teaches
 * anything. Scenario order is preserved so a debrief reopened months later
 * reads in the same order it did on the day.
 *
 * Ids the scenario does not define are dropped rather than trusted. The model
 * is asked to return ids and nothing else, but its output is not trusted to
 * stay inside a closed set any more than it is trusted to stay in numeric
 * range — and a phantom id would render as a row the user cannot reconcile
 * against anything.
 */
export function scoreLevers(scenario: Scenario, foundIds: string[]): ScoredLever[] {
  const found = new Set(foundIds)
  return scenario.mandateLevers.map(lever => ({ ...lever, found: found.has(lever.id) }))
}
