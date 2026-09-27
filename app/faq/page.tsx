import type { Metadata } from 'next'
import { ContentPage } from '@/app/components/ContentPage'

export const metadata: Metadata = {
  title: 'FAQ — Parley',
  description: 'How rehearsals, counterparts, debriefs, scoring and privacy work in Parley.',
  alternates: { canonical: '/faq' },
}

const SECTIONS: { heading: string; items: { q: string; a: string }[] }[] = [
  {
    heading: 'The rehearsal',
    items: [
      {
        q: 'What actually happens when I open a room?',
        a: 'You get a brief: the quote, your objective, your real constraints. Then the vendor speaks first, as they do on the real call. From there it is a live conversation on a clock. You cannot edit or retract a turn once it is sent, because you cannot in the real one either.',
      },
      {
        q: 'Why will the counterpart not tell me what they can agree to?',
        a: 'Because that is the thing you are practising for. Every counterpart holds a mandate: a discount ceiling of their own, an approval ladder above them, a quarter-end they are measured against, and a line they will not cross. Good questions surface it. Conceding early gets you a worse deal than was on the table. You see the whole mandate in the debrief.',
      },
      {
        q: 'Can I make them go easy on me?',
        a: 'No, and the failure modes are worth naming: a confident tone will not move them, and asking them to break character will not either. A genuinely good argument will.',
      },
      {
        q: 'How long should a rehearsal be?',
        a: 'Each brief carries an estimate, usually twelve to fifteen minutes. Going past it is not penalised, but the counterpart starts pushing toward a conclusion, as a real one would when the call is nearly over.',
      },
    ],
  },
  {
    heading: 'The debrief',
    items: [
      {
        q: 'What are the five scores?',
        a: 'Anchoring, Concession pace, Information gain, Composure and Close. Each was chosen because it is visible in a transcript without knowing the real-world outcome, and because it is coachable. Confidence and likeability are neither, so they are not measured.',
      },
      {
        q: 'Is the score comparing me to other people?',
        a: 'No. It scores the transcript against what the counterpart\'s mandate says was actually available. Getting a result they were always going to agree to does not score well, and a hard-fought partial win against a genuinely constrained counterpart can score better than a full one.',
      },
      {
        q: 'Why does the same rehearsal only get scored once?',
        a: 'A score that changed every time you reloaded the page would be worthless, and the progress trend depends on it being stable. The debrief is generated once and kept. Run the deal again to get a new one.',
      },
    ],
  },
  {
    heading: 'Counterparts and deals',
    items: [
      {
        q: 'Can I rehearse against the actual rep I have to face?',
        a: 'Yes. That is what custom counterparts are for. Describe how they behave when you push back, their habits on a call, and the tell you have noticed. It is the highest-value thing in the product.',
      },
      {
        q: 'My deal is not in the library. Does that matter?',
        a: 'Less than you would expect. Pick the closest one and change the counterpart. An uplift, a bundled upsell and a lapsed notice window have more in common underneath than the surface details suggest — they all turn on finding out what the person opposite is actually allowed to approve.',
      },
      {
        q: 'Does this only work for software vendors?',
        a: 'The library is written around software and SaaS renewals because that is where the asymmetry is sharpest and the numbers are easiest to check. The mechanics carry to any supplier who sells the same contract to a hundred other buyers a year and sells it to you twice.',
      },
    ],
  },
  {
    heading: 'Privacy and account',
    items: [
      {
        q: 'Who can read my transcripts?',
        a: 'They are private to your account, are not used to train models, and are not shared with anyone. You can export or delete everything from your data controls.',
      },
      {
        q: 'Will Parley email me to come back?',
        a: 'No. It emails when a debrief you were waiting on is ready, when a conversation you told it about is approaching, and about billing. There is no re-engagement email, and the send endpoint does not have a type for one.',
      },
    ],
  },
]

export default function FaqPage() {
  return (
    <ContentPage
      title="Questions"
      lede="How the room, the scoring, and your data actually work."
    >
      {SECTIONS.map(section => (
        <section key={section.heading} className="pl-faq-group">
          <h2 className="pl-stamp">{section.heading}</h2>
          <div className="pl-faq">
            {section.items.map(item => (
              <details key={item.q} className="pl-faq__item">
                <summary className="pl-faq__q">{item.q}</summary>
                <p className="pl-faq__a">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </ContentPage>
  )
}
