'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { BUILT_IN_COUNTERPARTS } from '@/lib/negotiation/counterparts'
import { useUserId } from '@/lib/hooks/useUserId'
import type { Counterpart } from '@/lib/negotiation/types'

// The counterpart bench.
//
// The built-ins are archetypes chosen to stress different dimensions. The
// custom ones are the real value: rehearsing against a description of the
// actual person you are about to face is the closest this gets to the real
// thing, and it is why the builder asks for a "tell" — the giveaway you learn
// to read in someone you know.

export default function CounterpartsPage() {
  const userId = useUserId()
  const [custom, setCustom] = useState<Counterpart[]>([])
  const [limit, setLimit] = useState(0)
  const [loading, setLoading] = useState(true)
  // See the note in app/playbook/page.tsx: a failed read used to render the
  // same "Nobody here yet" screen as a successful empty one.
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    // useUserId returns an empty string during SSR and the first
    // paint; there is nothing to fetch until it resolves.
    if (!userId) return
    const uid = userId
    fetch(`/api/counterparts?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (d?.custom) setCustom(d.custom)
        if (typeof d?.limit === 'number') setLimit(d.limit)
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [userId])

  async function remove(id: string) {
    setCustom(prev => prev.filter(c => c.id !== id))
    try {
      await fetch(
        `/api/counterparts?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
    } catch {
      // Optimistic; reappears on reload if it failed.
    }
  }

  const canCreate = limit === -1 || custom.length < limit

  return (
    <>
      <Nav activePath="/counterparts" />
      <main className="pl-container pl-container--narrow pl-page">
        <div className="pl-head">
          <p className="pl-stamp">Counterparts</p>
          <h1 className="pl-head__title">Who the vendor puts on the call</h1>
          <p className="pl-head__lede">
            Each one breaks a different part of your game, and on the day you do
            not get to choose. Run the same deal against two of them and you get
            two different scores, which tells you more than either one alone.
          </p>
        </div>

        <h2 className="pl-stamp pl-cp-section">The bench</h2>
        <div className="pl-cp-grid">
          {BUILT_IN_COUNTERPARTS.map((c, i) => (
            <article key={c.id} className="pl-cp">
              <span className="pl-index pl-cp__n" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>

              <h3 className="pl-cp__name">{c.name}</h3>
              <p className="pl-cp__role">{c.role}</p>
              <p className="pl-cp__disposition">{c.disposition}</p>

              <h4 className="pl-stamp pl-cp__label">What they do to you</h4>
              <ul className="pl-cp__tactics">
                {c.tactics.map((t, j) => (
                  <li key={j}>
                    <span className="pl-index" aria-hidden="true">{j + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>

              {/* The tell is the payoff of the whole page: the thing you learn
                  to read. It carries citron because that is the product's
                  colour for information you earned rather than were given. */}
              <div className="pl-cp__tell">
                <h4 className="pl-stamp pl-stamp--citron">Their tell</h4>
                <p>{c.tell}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="pl-cp-own-head">
          <h2 className="pl-stamp">Your own</h2>
          {canCreate && (
            <Link href="/counterparts/new" className="pl-btn pl-btn--secondary pl-btn--sm">
              Build one
            </Link>
          )}
        </div>

        {loading ? (
          <div className="pl-state pl-state--busy" role="status">
            <span className="pl-state__mark" aria-hidden="true" />
            <p className="pl-state__body">Looking up the counterparts you have written.</p>
            <span className="pl-sweep" aria-hidden="true" />
          </div>
        ) : loadFailed ? (
          <div className="pl-dash-empty" role="alert">
            <h3 className="pl-dash-empty__title">Could not load your counterparts</h3>
            <p className="pl-dash-empty__body">
              Anyone you have written is safe — this is a problem reaching them,
              not a problem with them. Reload the page, and if it keeps
              happening give it a few minutes.
            </p>
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : custom.length === 0 ? (
          <div className="pl-dash-empty">
            <h3 className="pl-dash-empty__title">Nobody here yet</h3>
            <p className="pl-dash-empty__body">
              The bench covers the common shapes. But you are probably about to
              take a call with one specific rep who has one specific habit.
              Describe them, and rehearse against that instead.
            </p>
            {canCreate ? (
              <Link href="/counterparts/new" className="pl-btn pl-btn--primary">
                Build a counterpart
              </Link>
            ) : (
              /* The entitlement is a sentence, so it is prose; the button is
                 the action. It used to be one control carrying the whole
                 sentence as its label, and because .pl-btn is white-space:
                 nowrap that made it 404px wide — every phone scrolled sideways
                 on this page. A button label should be a verb either way. */
              <>
                <p className="pl-dash-empty__body">
                  Custom counterparts are on Practitioner and above.
                </p>
                <Link href="/pricing" className="pl-btn pl-btn--secondary">
                  See plans
                </Link>
              </>
            )}
          </div>
        ) : (
          /* The same roster shape as the bench above, marked in clay rather
             than steel because clay is the user's colour everywhere in this
             product. See .pl-cp-own in globals.css — this was the page's last
             island of inline styling, which is why one screen drew the same
             kind of object two different ways. */
          <div className="pl-cp-own">
            {custom.map(c => (
              <article key={c.id} className="pl-cp-own__item">
                <div className="pl-cp-own__head">
                  <h3 className="pl-cp-own__name">{c.name}</h3>
                  <span className="pl-cp-own__role">{c.role}</span>
                  <button onClick={() => remove(c.id)} className="pl-cp-own__delete">
                    Delete
                  </button>
                </div>
                <p className="pl-cp-own__disposition">{c.disposition}</p>
              </article>
            ))}

            {!canCreate && (
              <p className="pl-cp-own__note">
                You have used all {limit} custom counterparts on your plan.{' '}
                <Link href="/pricing" className="pl-link">
                  See plans
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}