import Link from 'next/link'
import type { Metadata } from 'next'
import { ContentPage, H2, P, UL, Configure } from '@/app/components/ContentPage'

export const metadata: Metadata = {
  title: 'Privacy — Parley',
  description: 'What Parley stores, what it never stores, and how to get all of it back or deleted.',
  alternates: { canonical: '/privacy' },
}

// Describes the behaviour actually implemented in this codebase — the
// analytics whitelist in lib/analytics.ts, the transcript model in
// supabase_migrations.sql, and the immutable safety log. Jurisdiction-specific
// facts are marked for configuration rather than asserted.

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy"
      lede="Rehearsal transcripts are unusually candid. This page is specific about what happens to them."
      updated={<Configure what="effective date" />}
    >
      <P>
        The data controller for this deployment is <Configure what="legal entity" />
        , contactable at <Configure what="privacy contact" />.
      </P>

      <H2>The short version</H2>
      <UL
        items={[
          'Your transcripts, debriefs, playbook notes and custom counterparts are private to your account.',
          'They are not used to train models, by us or by our providers.',
          'Analytics never receives anything you typed. Not one field.',
          'You can export or delete everything, yourself, at any time.',
        ]}
      />

      <H2>What we store</H2>
      <UL
        items={[
          'Account: your email, an optional display name, and a device token used as a weak ownership check.',
          'Rehearsals: the scenario and counterpart you chose, when it started and ended, and the full transcript of both sides.',
          'Debriefs: the five scores, the notes explaining them, the key moments, and the mandate that was revealed.',
          'Things you write: playbook notes, custom counterparts, and the upcoming conversations you add to your dashboard.',
          'Billing: a Stripe customer and subscription reference. Card details are handled by Stripe and never reach our servers.',
        ]}
      />

      <H2>What analytics receives</H2>
      <P>
        A fixed, short list of event names with metadata only — which plan, which
        scenario slug, a score, a count. The list is a closed whitelist in the
        code, and an event that is not on it is rejected rather than recorded.
        No transcript line, playbook note or counterpart description is ever
        included, and there is no code path that could include one.
      </P>

      <H2>Who else sees a rehearsal</H2>
      <P>
        Generating a counterpart&apos;s turn and a debrief requires sending the
        relevant transcript to a third-party model provider. That is the only
        onward transfer of rehearsal content, it happens only when you are
        actively rehearsing or generating a debrief, and it is under terms that
        prohibit training on it. Supabase hosts the database. Stripe processes
        payments. Nobody else.
      </P>

      <H2>Safety logging</H2>
      <P>
        A small number of content categories — the ones that are unlawful rather
        than merely unwanted — produce a permanent log entry containing a hash
        of the content and a short excerpt. Those entries are never deleted,
        including by an account deletion request, because retaining them is a
        legal obligation rather than a product choice. Everything else about the
        account is deleted.
      </P>

      <H2>How long it is kept</H2>
      <P>
        Until you delete it. Transcripts, debriefs and playbook notes are kept
        for as long as the account exists. Nothing is removed on a schedule, and
        nothing is removed when a plan changes or lapses.
      </P>
      <P>
        Deleting your account removes everything immediately except the safety
        log described above and records we are required to keep for tax and
        accounting purposes. Deletion is all-or-nothing today: there is no way
        to remove one rehearsal and keep the rest.
      </P>

      <H2>Your controls</H2>
      <P>
        Export everything as a file, or delete everything, from{' '}
        <Link href="/privacy-controls" className="pl-link">
          your data controls
        </Link>
        . No email required, no retention offer, no waiting period. Depending on
        where you live you may also have rights to correction, restriction and
        complaint to a supervisory authority — see{' '}
        <Configure what="jurisdiction-specific rights" />.
      </P>

      <H2>Cookies</H2>
      <P>
        A session cookie for signing in, and a device token cookie used as a
        weak ownership check on your own data. Preferences that only matter on
        one device — whether the brief stays open in the room, which counterpart
        is pre-selected — live in local storage and never leave the browser.
      </P>
    </ContentPage>
  )
}
