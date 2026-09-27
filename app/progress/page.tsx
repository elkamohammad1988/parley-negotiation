'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, scoreBand } from '@/lib/design'
import { DIMENSION_BY_ID, DIMENSIONS } from '@/lib/negotiation/dimensions'
import { LEVER_KIND_LABELS } from '@/lib/negotiation/debrief'
import { getUserId } from '@/lib/user-id'
import type { DimensionId, LeverKind } from '@/lib/negotiation/types'

// Progress.
//
// One question: are you actually getting better, and at what?
//
// Charted as small sparklines rather than a single headline number, because
// the useful finding is almost always shaped like "your Discovery has climbed
// twenty points and your Close has not moved in nine rehearsals" — and a
// single average hides exactly that.

interface Trend {
  dimension: DimensionId
  series: number[]
  latest: number | null
  movement: number | null
}

interface LeverHistory {
  found: number
  total: number
  byKind: { kind: LeverKind; found: number; total: number }[]
  freeMissRehearsals: number
  rehearsals: number
}

/**
 * What kind of thing keeps getting left on the table.
 *
 * The trends above say whether the scores are moving. This says what they are
 * moving away from, and it is the only reading on this page with ground truth
 * underneath it: every one of these levers was written into the scenario
 * before the rehearsal started, so "you have surfaced four of the eleven
 * trades you have been offered" is a count, not an assessment.
 *
 * Deliberately not a chart. A bar per kind would invite comparison between
 * categories that have nothing to do with each other — missing an immovable is
 * not the same failure as missing a free trade — so it is set as a ruled list
 * with the fraction written out, and the sentence above it names the one thing
 * worth acting on.
 */
function Blindspots({ levers }: { levers: LeverHistory }) {
  if (levers.rehearsals === 0 || levers.total === 0) return null

  // The weakest kind the user has faced enough of to say anything about.
  //
  // Three is the floor at which a fraction stops being an anecdote, and
  // `immovable` is excluded outright: never discovering that something was
  // genuinely fixed costs nothing, so a buyer who is 0 of 5 on those has not
  // left a penny behind. It is the kind everyone scores worst on and the only
  // one where that is fine — naming it as the weak spot would send people to
  // push on the one thing in the room that will not move.
  const weakest = [...levers.byKind]
    .filter(k => k.kind !== 'immovable' && k.total >= 3)
    .sort((a, b) => a.found / a.total - b.found / b.total)[0]

  const missedAll = weakest && weakest.found === 0

  return (
    <section className="pl-blind" aria-labelledby="pl-blind-h">
      <div className="pl-blind__head">
        <h2 className="pl-stamp" id="pl-blind-h">
          What you keep leaving on the table
        </h2>
        <p className="pl-blind__count">
          <span className="pl-figure pl-figure--lg">{levers.found}</span>
          <span className="pl-blind__of">of {levers.total}</span>
        </p>
      </div>

      <p className="pl-blind__read">
        Across {levers.rehearsals} scored{' '}
        {levers.rehearsals === 1 ? 'rehearsal' : 'rehearsals'}, counterparts were
        holding {levers.total} things between them. You surfaced {levers.found}.
        {weakest && (
          <>
            {' '}
            {missedAll
              ? `You have never once found a ${LEVER_KIND_LABELS[weakest.kind].toLowerCase()} lever.`
              : `Your weakest is ${LEVER_KIND_LABELS[weakest.kind].toLowerCase()}: ${weakest.found} of ${weakest.total}.`}
          </>
        )}
      </p>

      <ul className="pl-blind__list">
        {levers.byKind.map(k => (
          <li key={k.kind} className="pl-blind__row">
            <span className="pl-blind__kind">{LEVER_KIND_LABELS[k.kind]}</span>
            <span className="pl-blind__bar" aria-hidden="true">
              <span
                className="pl-blind__fill"
                style={{ width: `${Math.round((k.found / k.total) * 100)}%` }}
              />
            </span>
            <span className="pl-num pl-blind__frac">
              {k.found}/{k.total}
            </span>
          </li>
        ))}
      </ul>

      {/* Without this, "FIXED 0/5" reads as five failures. It is the one row
          on the page where a zero is not a cost, and the list would be
          dishonest leaving the reader to assume otherwise. */}
      {levers.byKind.some(k => k.kind === 'immovable') && (
        <p className="pl-blind__foot">
          Fixed levers are the things that genuinely will not move. Finding out
          which they are saves you the minutes you would spend pushing; never
          finding out costs you nothing.
        </p>
      )}

      {/* The free lever is the one whose whole lesson is that it had to be
          asked for. Missing it in most rehearsals is the single most
          actionable fact this page can produce, so it gets its own line rather
          than a row in the list. */}
      {levers.freeMissRehearsals > 0 && (
        <p className="pl-blind__free">
          In {levers.freeMissRehearsals} of those {levers.rehearsals}, something
          that would have cost the counterpart nothing went unasked for.
        </p>
      )}
    </section>
  )
}

export default function ProgressPage() {
  const [trends, setTrends] = useState<Trend[]>([])
  const [overall, setOverall] = useState<{ score: number; at: string; rehearsalId: string }[]>([])
  const [count, setCount] = useState(0)
  const [levers, setLevers] = useState<LeverHistory | null>(null)
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(true)
  // See the note in app/playbook/page.tsx: a failed read and a genuinely empty
  // history rendered the same screen, so an outage looked like "you have never
  // rehearsed anything".
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const uid = getUserId()
    fetch(`/api/progress?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (!d) return
        setTrends(d.trends ?? [])
        setOverall(d.overall ?? [])
        setCount(d.rehearsalCount ?? 0)
        setLevers(d.levers ?? null)
        setLocked(!!d.locked)
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [])

  // Movement across the whole history, which is the question the card's title
  // asks. Guarded by the same length check the card is.
  const overallMove =
    overall.length >= 2 ? overall[overall.length - 1].score - overall[0].score : 0

  return (
    <>
      <Nav activePath="/progress" />
      <main className="pl-container pl-container--narrow pl-page">
        <header className="pl-head">
          <h1 className="pl-head__title">Is it working?</h1>
          <p className="pl-head__lede">
            {count === 0
              ? 'Once you have a few scored rehearsals, this shows which dimensions are moving and which are stuck.'
              : `Across ${count} scored ${count === 1 ? 'rehearsal' : 'rehearsals'}.`}
          </p>
        </header>

        {loading ? (
          <div className="pl-state pl-state--busy" role="status">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">Reading your history</h2>
            <p className="pl-state__body">
              Pulling every scored rehearsal and working out which dimensions
              have moved.
            </p>
            <span className="pl-sweep" aria-hidden="true" />
          </div>
        ) : loadFailed ? (
          <div className="pl-state" role="alert">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">Could not read your history</h2>
            <p className="pl-state__body">
              Your rehearsals and debriefs are safe — this is a problem reaching
              them, not a problem with them. Reload the page, and if it keeps
              happening give it a few minutes.
            </p>
            <div className="pl-state__actions">
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          </div>
        ) : count === 0 ? (
          <div className="pl-state">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">Nothing to trend yet</h2>
            <p className="pl-state__body">
              A single debrief tells you about one conversation. Three or four
              start telling you about you — which is the part that transfers to
              the meeting that actually counts.
            </p>
            <div className="pl-state__actions">
              <Link href="/library" className="pl-btn pl-btn--primary">
                Rehearse something
              </Link>
            </div>
          </div>
        ) : (
          <>
            {levers && <Blindspots levers={levers} />}

            {/* Overall trajectory.
                The line is drawn over a fixed 0-100 domain on purpose (see
                Sparkline), which is honest and, in a card this wide, shallow:
                thirty-three points of real improvement crossed 1,290px as a
                slope you had to look for. The card carried no figures at all,
                so the one screen that answers "is it working?" answered it
                with a line and nothing to read it against.

                The domain stays. The endpoints are now written down beside
                it, which is where the answer actually is. */}
            {overall.length >= 2 && (
              <section className="pl-trend-overall">
                <div className="pl-trend-overall__head">
                  <h2 className="pl-stamp">Overall, oldest to newest</h2>
                  {overallMove !== 0 && (
                    <span
                      className="pl-num pl-trend-overall__move"
                      /* clayDeep, not clay: this is a WORD, and bright clay is
                         3.13:1 on the cream. The Sparkline below keeps the
                         bright tone because a stroke is a fill. Same split as
                         scoreBand() — see lib/design.ts. */
                      style={{ color: overallMove > 0 ? SIGNAL.gain : SIGNAL.clayDeep }}
                    >
                      {overallMove > 0 ? '+' : ''}
                      {overallMove} since your first
                    </span>
                  )}
                </div>
                <Sparkline values={overall.map(o => o.score)} height={92} color={SIGNAL.clay} showAxis />
                <div className="pl-trend-overall__ends">
                  <span>
                    <b className="pl-figure">{overall[0].score}</b> first
                  </span>
                  <span>
                    <b className="pl-figure">{overall[overall.length - 1].score}</b> latest
                  </span>
                </div>
              </section>
            )}

            {/* Per-dimension */}
            <div className="pl-trend">
              {DIMENSIONS.map(dim => {
                const trend = trends.find(t => t.dimension === dim.id)
                const latest = trend?.latest ?? null
                const band = latest !== null ? scoreBand(latest) : null
                return (
                  <div key={dim.id} className="pl-trend-row">
                    <div>
                      <div className="pl-trend-row__label">{dim.label}</div>
                      <div className="pl-trend-row__q">
                        {DIMENSION_BY_ID[dim.id].question}
                      </div>
                    </div>

                    <div
                      className="pl-num pl-figure pl-trend-row__score"
                      style={{ color: band?.textColor ?? PAPER.inkFaint }}
                    >
                      {latest ?? '—'}
                    </div>

                    <div className="pl-trend-row__spark">
                      {trend && trend.series.length >= 2 ? (
                        <Sparkline values={trend.series} height={34} color={band?.color ?? PAPER.inkFaint} />
                      ) : (
                        <span className="pl-trend-row__none">
                          {locked ? 'Trends are on Practitioner and above' : 'Not enough rehearsals yet'}
                        </span>
                      )}
                    </div>

                    <div className="pl-trend-row__end">
                      {trend?.movement != null && trend.movement !== 0 ? (
                        <span
                          className="pl-num pl-trend-row__move"
                          style={{ color: trend.movement > 0 ? SIGNAL.gain : SIGNAL.clay }}
                        >
                          {trend.movement > 0 ? '+' : ''}
                          {trend.movement}
                        </span>
                      ) : (
                        <span className="pl-trend-row__none">—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {locked && (
              <div className="pl-trend-gate">
                <h2 className="pl-trend-gate__title">
                  You are seeing your latest scores only
                </h2>
                <p className="pl-trend-gate__body">
                  Trends over time — which dimensions are climbing, which have
                  been flat for months — are part of Practitioner and above.
                </p>
                <Link href="/pricing" className="pl-btn pl-btn--primary pl-btn--sm">
                  See plans
                </Link>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  )
}

/**
 * Inline SVG sparkline. No chart library — the whole shape is a polyline over
 * a fixed 0-100 domain, and pulling in a dependency for that would cost more
 * than it saves. Fixing the domain (rather than scaling to the data) is
 * deliberate: a run of scores between 40 and 46 should look flat, not dramatic.
 */
function Sparkline({
  values,
  height,
  color,
  showAxis,
}: {
  values: number[]
  height: number
  color: string
  showAxis?: boolean
}) {
  if (values.length < 2) return null

  const width = 100
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - (Math.max(0, Math.min(100, v)) / 100) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const last = values[values.length - 1]
  const lastY = height - (Math.max(0, Math.min(100, last)) / 100) * height

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      role="img"
      aria-label={`Trend across ${values.length} rehearsals, most recent score ${last}`}
    >
      {showAxis && (
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={PAPER.line}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={width} cy={lastY} r="2.5" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
