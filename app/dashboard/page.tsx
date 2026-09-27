'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { SIGNAL, scoreBand } from '@/lib/design'
import { DIMENSION_BY_ID } from '@/lib/negotiation/dimensions'
import { formatLimit, PLAN_NAMES, type Plan } from '@/lib/plans'
import { useUserId } from '@/lib/hooks/useUserId'
import { STATUS_LABELS, destinationFor, toRehearsalStatus } from '@/lib/negotiation/lifecycle'
import type { DimensionId } from '@/lib/negotiation/types'

// The dashboard is organised around READINESS for a specific dated
// conversation, not around usage.
//
// That is the deliberate inversion. A usage dashboard asks "how much have you
// used the product?", which serves the product. This asks "how ready are you
// for Thursday?", which serves the user — and it means the app has a natural
// end state: the conversation happens, the user marks it done, and they leave
// until the next one. A tool for high-stakes moments should not be trying to
// become a daily habit.

interface Conversation {
  id: string
  title: string
  happensOn: string | null
  scenarioSlug: string | null
  scenarioTitle: string | null
}

interface RehearsalSummary {
  id: string
  scenarioSlug: string
  scenarioTitle: string
  counterpartName: string
  status: string
  startedAt: string
  durationSeconds: number
  overallScore: number | null
}

/** The lever aggregate from /api/progress. See LeverHistory there. */
interface Levers {
  found: number
  total: number
  byKind: { kind: string; found: number; total: number }[]
  freeMissRehearsals: number
  rehearsals: number
}

interface Trend {
  dimension: DimensionId
  latest: number | null
  movement: number | null
}

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime()
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - todayUtc) / 86_400_000)
}

function countdownLabel(days: number): { text: string; urgent: boolean } {
  if (days < 0) return { text: 'Already happened', urgent: false }
  if (days === 0) return { text: 'Today', urgent: true }
  if (days === 1) return { text: 'Tomorrow', urgent: true }
  if (days <= 7) return { text: `In ${days} days`, urgent: true }
  return { text: `In ${days} days`, urgent: false }
}

export default function DashboardPage() {
  const userId = useUserId()
  const [loading, setLoading] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [rehearsals, setRehearsals] = useState<RehearsalSummary[]>([])
  const [trends, setTrends] = useState<Trend[]>([])
  const [levers, setLevers] = useState<Levers | null>(null)
  const [plan, setPlan] = useState<Plan>('free')
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  // Set when any of the three reads below fails. The dashboard composes
  // several sections, each with its own empty state, so a failed load used to
  // render as a completely empty but otherwise normal-looking dashboard — the
  // most alarming possible way to show an outage to someone who has work here.
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    // useUserId returns an empty string during SSR and the first
    // paint; there is nothing to fetch until it resolves.
    if (!userId) return
    const uid = userId

    Promise.all([
      fetch(`/api/conversations?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/rehearsal/session?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/progress?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([conv, reh, prog]) => {
        if (conv?.conversations) setConversations(conv.conversations)
        if (reh?.rehearsals) setRehearsals(reh.rehearsals)
        if (reh?.quota) setQuota({ used: reh.quota.used, limit: reh.quota.limit })
        if (reh?.plan) setPlan(reh.plan)
        if (prog?.trends) setTrends(prog.trends)
        if (prog?.levers) setLevers(prog.levers)
        // A null here is a non-ok response, not an empty account.
        if (!conv || !reh || !prog) setLoadFailed(true)
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [userId])

  async function resolveConversation(id: string) {
    setConversations(prev => prev.filter(c => c.id !== id))
    try {
      await fetch('/api/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, id, resolved: true }),
      })
    } catch {
      // Optimistic — a failure here just means it reappears on next load.
    }
  }

  const scored = rehearsals.filter(r => r.overallScore !== null)
  const weakest = trends
    .filter(t => t.latest !== null)
    .sort((a, b) => (a.latest ?? 100) - (b.latest ?? 100))[0]

  const next = conversations[0]

  // A brand-new account had nothing on the calendar and nothing rehearsed, so
  // it rendered two empty states stacked — "Nothing on the calendar yet" and
  // "Nothing rehearsed yet" — carrying three buttons between them that went to
  // two places. The first screen after signing up is the worst possible place
  // to look like an interface reporting its own emptiness twice.
  //
  // So the two collapse into one on a new account. Once either side has
  // something in it they separate again, and each empty state is then a true
  // statement about the half of the page it sits in.
  const firstRun = !next && rehearsals.length === 0

  return (
    <>
      <Nav />
      <main className="pl-container pl-container--narrow pl-page pl-page--top">
        {loading ? (
          <div className="pl-state pl-state--busy" role="status">
            <span className="pl-state__mark" aria-hidden="true" />
            <h1 className="pl-state__title">Pulling your file</h1>
            <p className="pl-state__body">
              Your upcoming conversations, what you have rehearsed, and where you
              are currently leaking the most.
            </p>
            <span className="pl-sweep" aria-hidden="true" />
          </div>
        ) : (
          <>
            {/* Says so, rather than letting every section below render its
                own empty state and imply the account is empty. */}
            {loadFailed && (
              <div className="pl-notice pl-notice--bad" role="alert">
                Some of this could not be loaded just now, so parts of the page
                may look empty. Nothing has been lost — reload to try again.
              </div>
            )}

            {/* ── What you are preparing for ─────────────────────────── */}
            {next ? (
              <NextConversation conversation={next} onResolve={resolveConversation} />
            ) : (
              <EmptyReadiness firstRun={firstRun} />
            )}

            {/* ── Where you leak ─────────────────────────────────────── */}
            {weakest && weakest.latest !== null && (
              <section
                className="pl-dash-leak"
                style={{ borderLeftColor: scoreBand(weakest.latest).color }}
              >
                <h2 className="pl-stamp">Where you leak most</h2>
                <div className="pl-dash-leak__row">
                  <span
                    className="pl-figure pl-figure--lg"
                    style={{ color: scoreBand(weakest.latest).textColor }}
                  >
                    {weakest.latest}
                  </span>
                  <span className="pl-dash-leak__dim">
                    {DIMENSION_BY_ID[weakest.dimension].label}
                  </span>
                  {weakest.movement !== null && weakest.movement !== 0 && (
                    <span
                      className="pl-dash-leak__move"
                      style={{ color: weakest.movement > 0 ? SIGNAL.gain : SIGNAL.clay }}
                    >
                      {weakest.movement > 0 ? '+' : ''}
                      {weakest.movement} over time
                    </span>
                  )}
                </div>
                {/* This line used to be the dimension's `failureMode` — the
                    static description of what a low score on it usually looks
                    like — printed under a heading that says "where YOU leak
                    most". It reads as a finding about this person and is not
                    one. The lever count is: it is their own history, counted
                    against a set that was authored before they ever sat down.
                    The failure mode stays as the fallback, labelled as the
                    general case it actually is. */}
                {levers && levers.total > 0 ? (
                  <p className="pl-dash-leak__why">
                    Across {levers.rehearsals} scored{' '}
                    {levers.rehearsals === 1 ? 'rehearsal' : 'rehearsals'}, you have
                    surfaced {levers.found} of the {levers.total} things counterparts
                    were holding.
                    {levers.freeMissRehearsals > 0 && (
                      <>
                        {' '}
                        In {levers.freeMissRehearsals} of them, something that would
                        have cost them nothing went unasked for.
                      </>
                    )}
                  </p>
                ) : (
                  <p className="pl-dash-leak__why">
                    <span className="pl-dash-leak__general">Usually</span>
                    {DIMENSION_BY_ID[weakest.dimension].failureMode}
                  </p>
                )}
              </section>
            )}

            {/* ── Recent rehearsals ──────────────────────────────────── */}
            {/* Held back on a new account: with no rehearsals to list, this
                section is a heading over a second empty state, and the block
                above has already said the same thing once. */}
            {!firstRun && (
              <section className="pl-dash-recent">
                <div className="pl-dash-sec">
                  <h2 className="pl-sec-title pl-dash-sec__title">Recent rehearsals</h2>
                  {quota && (
                    <span className="pl-dash-sec__note">
                      {quota.limit === -1
                        ? `${PLAN_NAMES[plan]} · unlimited`
                        : `${quota.used} of ${formatLimit(quota.limit)} this month`}
                    </span>
                  )}
                </div>

                {rehearsals.length === 0 ? (
                  <div className="pl-state">
                    <span className="pl-state__mark" aria-hidden="true" />
                    <h3 className="pl-state__title">Nothing rehearsed yet</h3>
                    <p className="pl-state__body">
                      Pick the deal closest to the one that is coming and have the
                      call once where it does not cost you anything.
                    </p>
                    <div className="pl-state__actions">
                      <Link href="/library" className="pl-btn pl-btn--primary">
                        Open the library
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="pl-dash-list">
                    {/* An archive, read by date. Each row is when, which deal,
                        against whom, and what it came to — and the way to run it
                        again, because the second attempt is where the score
                        moves. The title link stretches over the row (see
                        .pl-dash-row in globals.css) so the whole line opens the
                        record while the repeat action stays its own target. */}
                    {rehearsals.slice(0, 8).map(r => {
                      const band = r.overallScore !== null ? scoreBand(r.overallScore) : null
                      // Derived once. It was being recomputed three times per row
                      // to answer three questions about the same value.
                      const state = toRehearsalStatus(r.status)
                      const resumable = state === 'live' || state === 'draft'
                      const started = new Date(r.startedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })

                      return (
                        <div key={r.id} className="pl-dash-row">
                          <span className="pl-index pl-dash-row__date">{started}</span>

                          <div className="pl-dash-row__main">
                            <a href={destinationFor(state, r.id)} className="pl-dash-row__title">
                              {r.scenarioTitle}
                            </a>
                            <div className="pl-dash-row__meta">
                              {r.counterpartName}
                              {r.durationSeconds > 0 && ` · ${Math.round(r.durationSeconds / 60)} min`}
                            </div>
                          </div>

                          {/* A rehearsal you can still walk back into is the one
                              thing on this list worth acting on, so it is the
                              only one that gets the loud colour. */}
                          {resumable && <span className="pl-dash-row__open">Still open</span>}

                          {(state === 'failed' || state === 'expired') && (
                            <span className="pl-dash-row__quiet">{STATUS_LABELS[state]}</span>
                          )}

                          {!resumable &&
                            state !== 'failed' &&
                            (band ? (
                              <span className="pl-dash-row__result">
                                <span
                                  className="pl-figure pl-figure--md pl-dash-row__score"
                                  style={{ color: band.textColor }}
                                >
                                  {r.overallScore}
                                </span>
                                <span className="pl-dash-row__band" style={{ color: band.textColor }}>
                                  {band.label}
                                </span>
                              </span>
                            ) : (
                              <span className="pl-dash-row__quiet">No debrief</span>
                            ))}

                          {!resumable && (
                            <Link href={`/library/${r.scenarioSlug}`} className="pl-dash-row__again">
                              Again
                            </Link>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {scored.length >= 2 && (
              <Link href="/progress" className="pl-link pl-link--standalone">
                See how your scores are moving
              </Link>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

function NextConversation({
  conversation,
  onResolve,
}: {
  conversation: Conversation
  onResolve: (id: string) => void
}) {
  const countdown = conversation.happensOn ? countdownLabel(daysUntil(conversation.happensOn)) : null

  const urgent = countdown?.urgent ?? false

  return (
    // The countdown rides the file tab rather than sitting inside the card as a
    // line of tracked-out caps. It is the one piece of information on this page
    // that is about time running out, and a tab is the shape that says so.
    <section className={`pl-slab pl-dash-next${urgent ? ' pl-slab--clay' : ''}`}>
      <span className={`pl-tab${urgent ? ' pl-tab--clay' : ''}`}>
        {countdown ? countdown.text : 'No date set'}
      </span>

      <h1 className="pl-dash-next__title">{conversation.title}</h1>

      <div className="pl-dash-next__actions">
        <a
          href={conversation.scenarioSlug ? `/library/${conversation.scenarioSlug}` : '/library'}
          className="pl-btn pl-btn--primary"
        >
          Rehearse it
        </a>
        {conversation.scenarioTitle && (
          <span className="pl-dash-next__against">
            against “{conversation.scenarioTitle}”
          </span>
        )}
        <button
          type="button"
          onClick={() => onResolve(conversation.id)}
          className="pl-btn pl-btn--ghost pl-btn--sm pl-dash-next__clear"
        >
          It happened. Clear it
        </button>
      </div>
    </section>
  )
}

/**
 * Two states, one shape.
 *
 * On a new account this is the only thing on the page, so it says the one
 * thing worth doing first and leads with it: rehearse something. Adding the
 * real date is the second button, because a calendar entry with nothing
 * rehearsed against it is a reminder, not preparation.
 *
 * Once there are rehearsals but still no date, the emphasis swaps — the
 * library is already familiar and the missing piece is the real deal this is
 * all supposed to be pointed at.
 */
function EmptyReadiness({ firstRun }: { firstRun: boolean }) {
  return (
    <section className="pl-dash-empty">
      <h1 className="pl-dash-empty__title">
        {firstRun ? 'Nothing rehearsed yet' : 'Nothing on the calendar yet'}
      </h1>
      <p className="pl-dash-empty__body">
        {firstRun
          ? `Pick the deal closest to the one that is coming and have the call
             once where it does not cost you anything. Everything on this page
             fills in from there: what you are preparing for, where you leak
             most, and whether it is improving.`
          : `Parley works best pointed at a real deal with a real date. Add the
             next renewal or negotiation on your list, and this page will count
             down to it.`}
      </p>
      <div className="pl-dash-empty__actions">
        {firstRun ? (
          <>
            <Link href="/library" className="pl-btn pl-btn--primary">
              Open the library
            </Link>
            <Link href="/onboarding" className="pl-btn pl-btn--secondary">
              Add a negotiation
            </Link>
          </>
        ) : (
          <>
            <Link href="/onboarding" className="pl-btn pl-btn--primary">
              Add a negotiation
            </Link>
            <Link href="/library" className="pl-btn pl-btn--secondary">
              Browse the library
            </Link>
          </>
        )}
      </div>
    </section>
  )
}
