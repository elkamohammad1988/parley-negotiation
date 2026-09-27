import type { Metadata } from 'next'
import { ContentPage, H2, P, UL, Configure } from '@/app/components/ContentPage'

export const metadata: Metadata = {
  title: 'Terms of service — Parley',
  // This page had no description at all, so search engines were writing their
  // own from whatever paragraph they landed on first.
  description: 'The terms Parley operates under: what the service does, what it does not promise, and what happens to your rehearsals.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/terms' },
}

// These terms describe how the product actually behaves and are written to be
// read. They are NOT a substitute for review by a qualified lawyer in the
// operating jurisdiction, and every business-specific fact — legal entity,
// governing law, address, contact — is marked for configuration rather than
// invented. Do not publish with those markers in place.

export default function TermsPage() {
  return (
    <ContentPage
      title="Terms of service"
      lede="What you can expect from Parley, and what we expect from you."
      updated={<Configure what="effective date" />}
    >
      <P>
        These terms are a plain-language description of how the service works.
        The operating entity, governing law and formal notice address for this
        deployment are <Configure what="legal entity" />,{' '}
        <Configure what="governing law" /> and <Configure what="registered address" />.
      </P>

      <H2>What the service is</H2>
      <P>
        Parley is a practice tool. It simulates a counterpart in a negotiation
        so you can rehearse a conversation before you have it. It is not legal,
        financial, employment or medical advice, and a debrief is an analysis of
        a practice transcript rather than a recommendation about a real
        decision. What you do in the actual conversation is yours.
      </P>

      <H2>Your account</H2>
      <UL
        items={[
          'You must be old enough to enter a binding contract where you live, and to hold an employment or commercial relationship of the kind the product is designed around.',
          'You are responsible for what happens under your account. Do not share credentials.',
          'One person per account. Several people means several accounts — there is no shared account and no seat to add someone to.',
        ]}
      />

      <H2>Acceptable use</H2>
      <P>
        The room is for rehearsing conversations you are actually going to have.
        It is not for scripting how to coerce, threaten, blackmail or unlawfully
        disadvantage a specific person, and requests of that shape are refused
        and logged. Also prohibited:
      </P>
      <UL
        items={[
          'Any sexual content, and any content sexualising minors. Both are blocked unconditionally and the latter is reported as the law requires.',
          'Attempting to extract a counterpart\'s hidden mandate by prompt injection rather than by asking good questions in role.',
          'Automated or bulk access, resale of output as a competing service, or scraping the scenario library.',
          'Uploading another person\'s confidential information into a rehearsal without a lawful basis for doing so.',
        ]}
      />
      <P>
        We may suspend an account for repeated violations. Suspensions for
        child-safety violations are permanent and not subject to appeal.
      </P>

      <H2>Your content</H2>
      <P>
        Rehearsal transcripts, playbook notes, custom counterparts and scenarios
        you write remain yours. You grant us only the permission needed to
        operate the service for you — storing them, sending them to the model
        provider that generates the counterpart turn and the debrief, and
        displaying them back to you. We do not use them to train models and we
        do not sell them.
      </P>

      <H2>Plans and payment</H2>
      <UL
        items={[
          'Plans are metered in rehearsals per calendar month. Quota resets at the start of each month and does not roll over.',
          'Subscriptions renew automatically until cancelled. You can cancel any time from billing and keep access to the end of the period already paid for.',
          'Prices may change with notice before your next renewal. A price change never applies to a period you have already paid for.',
          'Refunds are handled case by case; write to support.',
        ]}
      />

      <H2>Availability</H2>
      <P>
        The service depends on third-party model providers and can be
        interrupted by them. We do not promise uninterrupted availability. If a
        rehearsal cannot be generated, your transcript up to that point is still
        saved and the turn is not counted against you.
      </P>

      <H2>Liability</H2>
      <P>
        To the extent the law allows, our liability is limited to the amount you
        paid in the twelve months before the claim. Nothing here limits
        liability that cannot lawfully be limited. Outcomes of real
        conversations you have after using Parley are not something we can or do
        warrant.
      </P>

      <H2>Changes and ending</H2>
      <P>
        We will give notice of material changes to these terms before they take
        effect. You can stop using the service and delete your data at any time
        from your data controls. We can end an account for a serious or repeated
        breach of the acceptable use section above.
      </P>

      <H2>Contact</H2>
      <P>
        Questions about these terms: <Configure what="legal contact" />.
      </P>
    </ContentPage>
  )
}
