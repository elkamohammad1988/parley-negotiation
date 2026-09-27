'use client'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { ContentPage, H2, P, Configure } from '@/app/components/ContentPage'
import { getUserId } from '@/lib/user-id'

// `?topic=team` is not decoration. /upgrade sends anyone who asks for a Team
// plan here, because Team is not sold (see PUBLIC_PLANS in lib/plans.ts) and a
// checkout for a plan the product cannot describe would be worse than a
// person. Until now they landed on a form headed "Something broken", with
// nothing on the page acknowledging what they had just clicked — which reads
// as the link having gone wrong.
//
// Read through useSyncExternalStore, the same way app/signup reads its tab:
// the query string is external state that never changes without a navigation,
// so it needs a server snapshot and no subscription. useSearchParams would
// force this statically rendered page behind a Suspense boundary for one
// optional parameter, and setting state in an effect is both a hydration
// flicker and a lint error under React 19.
const TOPICS: Record<string, { lede: string; prefill: string }> = {
  team: {
    lede:
      'You asked about Parley for a team. There is no self-serve team plan yet — seats, a shared library and per-team progress are not built, and selling them before they exist is not something this product does. Tell us what you need and how many people, and you will get a straight answer about whether it exists, when it might, and what it would cost.',
    prefill: 'We are looking at Parley for a team of ',
  },
}

function subscribeNever(): () => void {
  return () => {}
}

function readTopic(): (typeof TOPICS)[string] | null {
  const requested = new URLSearchParams(window.location.search).get('topic')
  return (requested && TOPICS[requested]) || null
}

export default function SupportPage() {
  const topic = useSyncExternalStore(subscribeNever, readTopic, () => null)
  // Prefilled rather than merely explained: the one thing we need from them is
  // the number, and an empty box after a paragraph asks them to work out what
  // to say. `typed` takes over the moment they touch it, so the prefill can
  // never overwrite something they wrote.
  const [typed, setTyped] = useState<string | null>(null)
  const message = typed ?? topic?.prefill ?? ''
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    const body = message.trim()
    if (!body || sending) return
    setSending(true)
    setError('')

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: getUserId(), message: body, page: '/support' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not send that. Try again in a moment.')
        setSending(false)
        return
      }
      setSent(true)
      setTyped('')
    } catch {
      setError('Could not reach the server.')
    }
    setSending(false)
  }

  return (
    <ContentPage title="Support" lede="Something broken, something unclear, or a scenario you wish existed.">
      {topic ? (
        <>
          <H2>About a team</H2>
          <P>{topic.lede}</P>
        </>
      ) : (
        <>
          <H2>Tell us what happened</H2>
          <P>
            This goes straight to the people who build it. If it is about a
            specific rehearsal, say which scenario — we can look at the
            transcript only if you ask us to.
          </P>
        </>
      )}

      {sent ? (
        <p className="pl-notice pl-notice--good" role="status">
          Sent. If it needs a reply and we have your email on file, you will get
          one.
        </p>
      ) : (
        <>
          <label className="pl-sr-only" htmlFor="support-message">
            What happened
          </label>
          <textarea
            id="support-message"
            className="pl-textarea"
            value={message}
            onChange={e => setTyped(e.target.value)}
            rows={6}
            maxLength={3000}
            placeholder="What happened, and what you expected instead."
          />
          {error && (
            <p className="pl-field-error" role="alert">
              {error}
            </p>
          )}
          <button
            onClick={send}
            disabled={!message.trim() || sending}
            className="pl-btn pl-btn--primary pl-support__send"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      )}

      <H2>Before you write in</H2>
      <P>
        A stuck rehearsal usually resolves by ending it and reading the debrief —
        transcripts are written turn by turn, so nothing you said is lost. A
        debrief that failed to generate can be retried from the same page
        without re-running the rehearsal.
      </P>
      <P>
        Billing questions, including cancellation, are self-serve from{' '}
        <Link href="/billing" className="pl-link">
          your billing page
        </Link>
        .
      </P>

      <H2>Other ways to reach us</H2>
      <P>
        Support address and response times for this deployment:{' '}
        <Configure what="support email" />. Postal address for formal notices:{' '}
        <Configure what="registered address" />.
      </P>
    </ContentPage>
  )
}
