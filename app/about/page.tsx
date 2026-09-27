import type { Metadata } from 'next'
import { ContentPage, H2, P } from '@/app/components/ContentPage'

export const metadata: Metadata = {
  title: 'About — Parley',
  description:
    'Why Parley exists: the person on the other end of your renewal call has rehearsed it a couple of hundred times this year, and you have not rehearsed it at all.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <ContentPage
      title="Why this exists"
      lede="The renewal call is not a fair fight, and almost nothing sold to the buyer's side treats it as one."
    >
      <P>
        The account executive on your renewal runs that category of deal a
        couple of hundred times a year. Their employer puts them through weeks
        of negotiation training annually, a real share of it about people in
        your chair specifically. Behind them sits a discount matrix, a deal
        desk, an approval ladder and a quarter-end clock.
      </P>
      <P>
        You run forty to sixty deals a year across dozens of suppliers, and this
        particular one twice. You get a renewal notice, a spreadsheet and a
        stakeholder who has already decided. The gap is not intelligence or
        nerve. It is reps.
      </P>
      <P>
        Musicians rehearse. Pilots use simulators. Trial lawyers run moots. The
        person responsible for a seven-figure software portfolio prepares by
        reading a benchmark report on the train.
      </P>

      <H2>What Parley actually does</H2>
      <P>
        It puts you across the table from a vendor with a position, a mandate,
        and something they will not give you unless you ask for it correctly.
        They will not go easy on you, and they will not tell you what they are
        authorised to approve — finding that out before you move is the skill
        being practised, and it is the one that decides what the deal costs.
      </P>
      <P>
        When it ends, something reads the transcript and tells you what your
        version of the call cost: where you anchored, what you conceded without
        getting anything back, what you never asked, and what happened to your
        position the first time somebody let a silence run. Then it shows you
        the mandate they were holding the whole time.
      </P>

      <H2>What it is not</H2>
      <P>
        It is not a coach that tells you how you are doing while you are doing
        it. Feedback during the conversation would teach you to negotiate while
        watching a meter, which is not available to you in the actual meeting.
        The room is silent on purpose.
      </P>
      <P>
        It is also not trying to become a daily habit. The right amount of
        Parley is a few rehearsals in the fortnight before a renewal, and then
        nothing until the next one. Any product in this category that is
        measuring daily active use has stopped serving the person using it.
      </P>

      <H2>A note on your transcripts</H2>
      <P>
        What people write in a rehearsal is unusually candid — the number they
        are actually authorised to sign, what they really think of a supplier,
        which internal stakeholder has already gone around them. Those
        transcripts are private to your account, are not used to train models,
        and can be exported or deleted in full at any time.
      </P>
    </ContentPage>
  )
}
