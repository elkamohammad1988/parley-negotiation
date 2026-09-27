'use client'
import { useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import {
  PLAN_FEATURES,
  PLAN_NAMES,
  PUBLIC_PLANS,
  PLAN_TAGLINES,
  planFeatures,
  planPrice,
  PRICING_IS_DEMO,
  formatLimit,
  type Plan,
} from '@/lib/plans'

// Pricing.
//
// Metered on REHEARSALS, not messages or minutes. A rehearsal has a natural
// end, so "25 a month" is something a person can hold in their head before
// they buy — unlike a message quota, which rewards being brief in exactly the
// situation where being brief is a mistake.

const FAQ = [
  {
    q: 'What counts as one rehearsal?',
    a: 'Opening a room. However long you stay in it, however many turns you take, it is one — and the debrief that follows is included. Ending early to save quota would be the wrong incentive, so we do not create it.',
  },
  {
    q: 'Can I rehearse the same deal more than once?',
    a: 'That is the intended use, and it is where scores actually move. Each run counts against your monthly quota, and the counterpart will not play it the same way twice.',
  },
  {
    q: 'Does the counterpart know I am practising?',
    a: 'No. They hold a mandate — a discount ceiling, an approval ladder, a quarter of their own — and play it straight. They will not go easy on you, break role to encourage you, or hint at what they are authorised to give. You find that out in the debrief.',
  },
  {
    q: 'Who can see my transcripts?',
    a: 'Rehearsal transcripts and debriefs are private to your account and are not used to train models. You can export or delete everything from your data controls at any time.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from billing. You keep access until the end of the period you have already paid for, and your transcripts and debriefs stay readable afterwards on the free plan — cancelling changes how many new rehearsals you can start, not what you can still read.',
  },
  {
    q: 'We are several people. Is there a team plan?',
    a: 'Not a self-serve one. Each person needs their own account today — there is no shared library and no team view, so a plan promising them would be promising something that does not exist. If you want several accounts on one invoice, write to us and we will set it up by hand.',
  },
]

/** What the free plan actually grants. Enforced by the database trigger. */
const FREE_REHEARSALS = PLAN_FEATURES.free.monthlyRehearsals

export default function PricingPage() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')

  return (
    <>
      {/* Acquisition surface, like the landing page: a visitor who clicked
          Pricing from the hero is still a stranger, and Playbook and Progress
          mean nothing to them yet. Nav restores the full set the moment they
          are signed in, so this costs a returning user nothing. */}
      <Nav activePath="/pricing" variant="marketing" />
      <main className="pl-container pl-page">
        <header className="pl-head pl-head--center">
          <h1 className="pl-head__title">Cheaper than one bad renewal</h1>
          <p className="pl-head__lede">
            {/* Read from the config the database actually enforces, not typed
                out. This is a number on a pricing page: if the free plan is
                ever retuned, the sentence selling it must not keep saying
                three. */}
            {FREE_REHEARSALS} rehearsals free, no card. If it does not change
            how the real call goes, do not pay for it.
          </p>

          {PRICING_IS_DEMO && (
            <p className="pl-demo-note" role="note">
              <strong>Demo pricing.</strong> Parley is running here as a working
              demo. The prices below are placeholders that show how plans and
              checkout work. They are not an offer.
            </p>
          )}

          {/* A segmented switch rather than a pill toggle: squared, ruled, and
              set in the same mono label face as every other control label in
              the product. */}
          <div className="pl-seg" role="group" aria-label="Billing interval">
            {(['monthly', 'annual'] as const).map(value => (
              <button
                key={value}
                type="button"
                className="pl-seg__opt"
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
              >
                {value === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        </header>

        <div className="pl-rate">
          {PUBLIC_PLANS.map(plan => (
            <PlanCard key={plan} plan={plan} interval={interval} />
          ))}
        </div>

        {/* Comparison */}
        <h2 className="pl-sec-title" id="pl-compare-h">What is in each</h2>
        {/* Focusable, because it scrolls. Below ~520px this container is the
            only way to reach the plan columns, and a container that scrolls
            without a tab stop is reachable with a mouse or a finger and by
            nothing else — a keyboard user simply cannot see the right-hand
            plans. `tabIndex` gives it the stop and the global :focus-visible
            rule draws it; the region role and the heading it points at are what
            stop that stop being an unnamed one. */}
        <div className="pl-compare-wrap" tabIndex={0} role="region" aria-labelledby="pl-compare-h">
          <table className="pl-compare">
            <thead>
              <tr>
                <th scope="col"><span className="pl-sr-only">Feature</span></th>
                {PUBLIC_PLANS.map(p => (
                  <th key={p} scope="col">
                    {PLAN_NAMES[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Rehearsals per month" render={p => formatLimit(planFeatures(p).monthlyRehearsals)} />
              <Row label="Custom counterparts" render={p => formatLimit(planFeatures(p).customCounterparts)} />
              <Row label="Progress trends" render={p => (planFeatures(p).progressTrends ? 'Yes' : '—')} />
              {/* Three rows, and each one is a thing the server actually
                  grants or withholds. Rows for custom scenarios, transcript
                  export, a shared team library, scored debriefs and transcript
                  history have all been deleted from here rather than restyled:
                  none of them was enforced anywhere, and a comparison table
                  must not list a thing that is not there to compare. The note
                  on PlanFeatures in lib/plans.ts records what each one claimed
                  and why it went. */}
            </tbody>
          </table>
        </div>
        <p className="pl-compare__note">
          Every rehearsal includes its scored debrief, on every plan. Nothing you
          have rehearsed is deleted on a schedule or hidden behind a plan — the
          transcripts, debriefs and playbook notes on your account stay readable
          for as long as the account exists.
        </p>

        {/* FAQ */}
        <h2 className="pl-sec-title">Questions</h2>
        <div className="pl-faq">
          {FAQ.map(item => (
            <details key={item.q} className="pl-faq__item">
              <summary className="pl-faq__q">{item.q}</summary>
              <p className="pl-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </main>
      <Footer />

    </>
  )
}

function Row({
  label,
  render,
}: {
  label: string
  render: (plan: Plan) => string
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {PUBLIC_PLANS.map(p => (
        <td key={p}>{render(p)}</td>
      ))}
    </tr>
  )
}

function PlanCard({ plan, interval }: { plan: Plan; interval: 'monthly' | 'annual' }) {
  // Practitioner is the plan most people should be on, so it is the one the
  // page argues for rather than the most expensive one.
  const featured = plan === 'practitioner'
  const features = planFeatures(plan)

  // Parley meters REHEARSALS, so the rehearsal count is the figure the row is
  // built around rather than the price. It is the number that actually differs
  // between plans in a way anyone can reason about before they buy.
  const rehearsals = features.monthlyRehearsals
  const count = rehearsals === -1 ? '\u221e' : String(rehearsals)

  const extras = [
    features.customCounterparts !== 0 &&
      (features.customCounterparts === -1
        ? 'Unlimited custom counterparts'
        : `${features.customCounterparts} custom counterparts`),
    features.progressTrends && 'Progress trends',
  ].filter(Boolean) as string[]

  return (
    <article className={`pl-rate__row${featured ? ' pl-rate__row--featured' : ''}`}>
      {featured && <span className="pl-tab pl-tab--clay">Most people</span>}

      {/* The unit. Oversized because it is the thing being sold. */}
      <div className="pl-rate__count">
        <span className="pl-figure pl-figure--lg">{count}</span>
        <span className="pl-rate__unit">
          {rehearsals === -1 ? 'rehearsals' : rehearsals === 1 ? 'rehearsal / mo' : 'rehearsals / mo'}
        </span>
      </div>

      <div className="pl-rate__body">
        {/* h2, not h3: these sit directly under the page's h1, at the same
            level as "What is in each" and "Questions". As h3 they made the
            outline jump 1→3, which is what a screen-reader user hears when
            they list the headings to find the plans. Styling is on the class,
            so the level is free to be correct. */}
        <h2 className="pl-rate__name">{PLAN_NAMES[plan]}</h2>
        <p className="pl-rate__tagline">{PLAN_TAGLINES[plan]}</p>
        {extras.length > 0 && (
          <ul className="pl-rate__extras">
            {extras.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>

      <div className="pl-rate__buy">
        <div className="pl-rate__price">
          <span className="pl-figure pl-figure--md">{planPrice(plan, interval)}</span>
          {plan !== 'free' && <span className="pl-rate__per">/mo</span>}
        </div>
        {/* Free opens the deal index rather than the sign-up form. Making
            someone hold an account before they have seen a debrief is asking
            them to keep something they have not been given yet; the debrief is
            where the product asks, and by then there is a reason to say yes.

            /library, not /onboarding: the landing hero, the nav and the close
            all point there, and onboarding's three questions are the longer
            way round to the same brief. Pricing was the last surface still
            sending people down the old path, which meant a visitor's first run
            differed depending on which page they entered from. */}
        <a
          href={plan === 'free' ? '/library' : `/upgrade?plan=${plan}&interval=${interval}`}
          className={`pl-btn ${featured ? 'pl-btn--primary' : 'pl-btn--secondary'}`}
        >
          {plan === 'free' ? 'Start free' : 'Choose'}
        </a>
      </div>
    </article>
  )
}