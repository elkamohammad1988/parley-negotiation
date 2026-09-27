'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import Redacted from '@/app/components/Redacted'
import { SIGNAL, scoreBand } from '@/lib/design'
import { DIMENSIONS } from '@/lib/negotiation/dimensions'
import { LEVER_KIND_LABELS, OUTCOME_LABELS, leverVerdict, tallyLevers } from '@/lib/negotiation/debrief'
import { MAX_REPORT_DETAIL, REPORT_REASONS, type ReportReason } from '@/lib/negotiation/reports'
import { useUserId } from '@/lib/hooks/useUserId'
import { useSignedIn } from '@/lib/hooks/useSignedIn'
import { canGenerateDebrief, toRehearsalStatus } from '@/lib/negotiation/lifecycle'
import { takeRevealPending } from '@/lib/revealHandoff'
import type { Debrief, DimensionId, KeyMoment, ScoredLever } from '@/lib/negotiation/types'

// The debrief.
//
// It opens in the room's register, not the page's. You arrive from the room
// with the rehearsal just ended, and the first thing that happens is the thing
// you could not have while you were in there: the mandate unseals, sentence by
// sentence, on the same dark ground you have been negotiating on. Only once you
// have read it does the dark lift off and the paper debrief — scores, moments,
// the one thing to change — settle in underneath. That crossing is the
// product's signature moment, and it is staged as a transition rather than
// drawn as a card, because "now I know what was actually happening" is an
// event and not a section.
//
// Reading order on the paper page stays deliberate and the opposite of a
// dashboard: the mandate first, before any score. A 61 reads very differently
// once you know they had nine per cent in their pocket the whole time.
//
// The reveal plays once. The room leaves a note as it ends (lib/revealHandoff)
// and the debrief takes it; a later visit reads the record. The mandate text is
// only ever mounted here, on a screen reachable once the rehearsal has ended,
// so there is never a moment where it sits in the DOM under a black rectangle
// waiting to be inspected.

/** Custom properties in a style object, without scattering casts everywhere. */
const v = (props: Record<string, string | number>) => props as CSSProperties

interface TurnView {
  side: 'you' | 'counterpart'
  content: string
  position: number
}

interface ScenarioView {
  slug: string
  title: string
  premise: string
  objective: string
  counterpartRole: string
  hiddenMandate: string | null
}

/** Where the dark act is. `done` means the paper page is the page. */
type ActState = 'sealed' | 'open' | 'leaving' | 'done'

/**
 * The mandate arrives one sentence at a time. Splitting on terminal
 * punctuation is enough for the prose in lib/negotiation/scenarios.ts, and
 * anything it cannot split it shows whole — a reveal that shows the mandate
 * in one piece is a smaller failure than one that hides part of it.
 */
function sentencesOf(text: string): string[] {
  const found = text.match(/[^.!?]+[.!?]+["”’']?(?:\s+|$)/g)
  const parts = (found ?? [text]).map(s => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [text]
}

const LINE_START_MS = 260
const LINE_STAGGER_MS = 240
const LINE_SLIDE_MS = 620

export default function DebriefClient({ rehearsalId }: { rehearsalId: string }) {
  const userId = useUserId()
  const signedIn = useSignedIn()
  const [debrief, setDebrief] = useState<Debrief | null>(null)
  const [scenario, setScenario] = useState<ScenarioView | null>(null)
  const [counterpartName, setCounterpartName] = useState('')
  const [turns, setTurns] = useState<TurnView[]>([])
  const [phase, setPhase] = useState<'loading' | 'generating' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  // The API's machine-readable reason, kept beside the sentence. 'too_short'
  // is the one that changes what the error screen offers: a retry cannot
  // succeed against a transcript that will never have more turns in it.
  const [errorCode, setErrorCode] = useState('')
  const [act, setAct] = useState<ActState>('sealed')
  // True when the mandate was unsealed in the act on this visit, so the paper
  // page below shows it settled rather than staging the lift a second time.
  const [staged, setStaged] = useState(false)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [flashed, setFlashed] = useState<number | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  const generate = useCallback(async (uid: string) => {
    setPhase('generating')
    setAct('sealed')
    setErrorCode('')
    try {
      const res = await fetch('/api/debrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, rehearsalId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'The debrief could not be generated.')
        setErrorCode(typeof data.code === 'string' ? data.code : '')
        setPhase('error')
        setAct('done')
        return
      }
      setDebrief(data.debrief)
      setPhase('ready')
      // First sight of the mandate, whichever path led here.
      setStaged(true)
      setAct('open')
    } catch {
      setError('Could not reach the server.')
      setPhase('error')
      setAct('done')
    }
  }, [rehearsalId])

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(
          `/api/debrief?userId=${encodeURIComponent(userId)}&rehearsalId=${encodeURIComponent(rehearsalId)}`
        )
        if (!res.ok) {
          if (!cancelled) {
            setError(res.status === 404 ? 'This rehearsal could not be found.' : 'Could not load this debrief.')
            setPhase('error')
            setAct('done')
          }
          return
        }
        const data = await res.json()
        if (cancelled) return

        setScenario(data.scenario)
        setCounterpartName(data.counterpart?.name ?? 'Counterpart')
        setTurns(data.turns ?? [])

        // The room's note. Taken here whichever branch follows, so it can
        // never be left behind to stage a reveal on some later visit.
        const owed = takeRevealPending(rehearsalId)

        if (data.debrief) {
          setDebrief(data.debrief)
          setPhase('ready')
          // Scored already. Stage the reveal only if the room just sent us —
          // its end request landed and it was scored on the way — otherwise
          // this is a record being reopened, and a record does not re-stage
          // its own unsealing.
          if (owed) {
            setStaged(true)
            setAct('open')
          } else {
            setAct('done')
          }
          return
        }

        // Arriving straight from the room: the rehearsal has just ended and
        // nothing has scored it yet, so generate on first view. If the room's
        // own end request did not land, close it here first — the PATCH is
        // idempotent, so doing it twice is safe.
        const status = toRehearsalStatus(data.rehearsal?.status)
        if (!canGenerateDebrief(status)) {
          await fetch('/api/rehearsal/session', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, rehearsalId, reason: 'completed' }),
          })
        }
        await generate(userId)
      } catch {
        if (!cancelled) {
          setError('Could not reach the server.')
          setPhase('error')
          setAct('done')
        }
      }
    })()

    return () => { cancelled = true }
  }, [userId, rehearsalId, generate])

  // The act owns the viewport while it is up: nothing behind it scrolls, and
  // the floating chrome — the cookie notice, the support launcher — is
  // deferred beneath it by the attribute on <html> (see globals.css), the way
  // the room suppresses it. Both are undone the moment the act is gone.
  useEffect(() => {
    if (act === 'done') return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.setAttribute('data-pl-act', 'true')
    return () => {
      document.body.style.overflow = previous
      document.documentElement.removeAttribute('data-pl-act')
    }
  }, [act])

  // Leaving the act: the dark plane lifts (CSS), and once it has gone the
  // paper page takes focus at its title so a keyboard or screen-reader user
  // lands on the debrief rather than at the top of the document. Reduced
  // motion skips the lift — the state change is the transition.
  const leaveAct = useCallback(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setAct(reduced ? 'done' : 'leaving')
  }, [])

  useEffect(() => {
    if (act !== 'done' || phase !== 'ready') return
    titleRef.current?.focus({ preventScroll: true })
  }, [act, phase])

  async function saveToPlaybook(key: string, note: string, dimension: DimensionId | null) {
    if (saved.has(key)) return
    setSaved(prev => new Set(prev).add(key))
    try {
      await fetch('/api/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          note,
          dimension,
          sourceRehearsalId: rehearsalId,
          sourceScenarioTitle: scenario?.title,
        }),
      })
    } catch {
      setSaved(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  function scrollToTurn(position: number) {
    const el = document.getElementById(`turn-${position}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Marks the line in citron — the colour the product reserves for something
    // that was found out — rather than reaching into the node's style.
    setFlashed(position)
    window.setTimeout(() => setFlashed(null), 1600)
  }

  // Information gain is the dimension that measures how much of the mandate the
  // user actually surfaced, so it belongs beside the reveal rather than fourth
  // in a list of five. "Here is what they were holding" is only half a
  // sentence; "and here is how much of it you got" finishes it.
  const discovery = debrief?.dimensions.find(d => d.dimension === 'discovery') ?? null

  // Every key moment, filed against the line it happened on, so the full
  // transcript can be read with the debrief's notes in the margin.
  const momentsByTurn = useMemo(() => {
    const map = new Map<number, KeyMoment[]>()
    for (const m of debrief?.keyMoments ?? []) {
      const list = map.get(m.turnPosition) ?? []
      list.push(m)
      map.set(m.turnPosition, list)
    }
    return map
  }, [debrief])

  // ── The act ───────────────────────────────────────────────────────────────
  // Up for the whole of loading and generating, and for the reveal itself.
  const actNode =
    act !== 'done' ? (
      <RevealAct
        state={act}
        busy={phase !== 'ready'}
        who={counterpartName}
        scenarioTitle={scenario?.title ?? ''}
        mandate={debrief?.mandateReveal ?? ''}
        levers={debrief?.levers ?? []}
        discovery={discovery}
        onContinue={leaveAct}
        onLeft={() => setAct('done')}
      />
    ) : null

  if (phase === 'loading' || phase === 'generating') {
    return <Page>{actNode}</Page>
  }

  // Too few turns to score. Not a failure to retry — the transcript is
  // finished and will never have more in it — so the way out is the brief,
  // and the screen says plainly that the month's count already moved. It
  // used to offer "Try again", which repeated the same 422 forever.
  if (phase === 'error' && errorCode === 'too_short') {
    return (
      <Page>
        <div className="pl-state" role="status">
          <span className="pl-state__mark" aria-hidden="true" />
          <h1 className="pl-state__title">Too short to score</h1>
          <p className="pl-state__body">
            A debrief needs at least two of your turns to read anything into,
            and this rehearsal ended before that. It still counts as one of the
            month&apos;s, and the transcript is kept. Open the brief again and
            stay in the room a little longer.
          </p>
          <div className="pl-state__actions">
            {scenario?.slug && (
              <Link href={`/library/${scenario.slug}`} className="pl-btn pl-btn--primary">
                Rehearse again
              </Link>
            )}
            <Link href="/dashboard" className="pl-btn pl-btn--secondary">Dashboard</Link>
          </div>
        </div>
      </Page>
    )
  }

  if (phase === 'error') {
    return (
      <Page>
        <div className="pl-state pl-state--error" role="alert">
          <span className="pl-state__mark" aria-hidden="true" />
          <h1 className="pl-state__title">{error}</h1>
          <p className="pl-state__body">
            Nothing is lost. The transcript is saved against this rehearsal, and
            scoring it again costs you nothing.
          </p>
          <div className="pl-state__actions">
            <button type="button" className="pl-btn pl-btn--primary" onClick={() => generate(userId)}>
              Try again
            </button>
            <Link href="/dashboard" className="pl-btn pl-btn--secondary">Back to dashboard</Link>
          </div>
        </div>
      </Page>
    )
  }

  if (!debrief) return null

  const band = scoreBand(debrief.overallScore)
  const discoveryBand = discovery ? scoreBand(discovery.score) : null
  const costMoments = debrief.keyMoments.filter(m => m.kind === 'cost')
  const gainMoments = debrief.keyMoments.filter(m => m.kind === 'gain')
  const ordered = [...costMoments, ...gainMoments]

  return (
    <Page>
      {actNode}

      <div className="pl-db" data-arrived={staged ? 'true' : undefined}>
        <header className="pl-db-head">
          <Link href="/dashboard" className="pl-link pl-db-head__back">
            Dashboard
          </Link>
          <h1 className="pl-db-head__title" ref={titleRef} tabIndex={-1}>
            {scenario?.title}
          </h1>
          <div className="pl-db-head__meta">
            <span>Against {counterpartName}</span>
            <span aria-hidden="true">·</span>
            <span>{scenario?.counterpartRole}</span>
          </div>
        </header>

        {/* ── The reveal, settled ─────────────────────────────────────────── */}
        {/* When the act has just played, this is the same text at rest: no
            second lift, because the mandate has already been read. Opened
            from the dashboard, the bar slides off here instead. */}
        {debrief.mandateReveal && (
          <section
            className="pl-db-reveal pl-settle"
            aria-labelledby="pl-db-reveal-h"
            data-still={staged ? 'true' : undefined}
          >
            <span className="pl-tab pl-tab--citron">Unsealed</span>
            <h2 className="pl-stamp pl-stamp--citron" id="pl-db-reveal-h">
              What they were holding
            </h2>
            <div className="pl-reveal" style={v({ '--d': '260ms' })}>
              <p className="pl-db-reveal__text">{debrief.mandateReveal}</p>
            </div>
            <p className="pl-db-reveal__foot">
              You could not see this while you were in the room. Everything below
              is scored against it.
            </p>

            {/* The ledger, or — for a debrief scored before levers existed —
                the dimension score that used to stand in its place. */}
            {debrief.levers.length > 0 ? (
              <LeverLedger levers={debrief.levers} delay="760ms" />
            ) : (
              discovery &&
              discoveryBand && (
                <div
                  className="pl-db-surfaced"
                  style={v({ '--pl-score': discoveryBand.color, '--pl-score-ink': discoveryBand.textColor, '--d': '760ms' })}
                >
                  <div className="pl-db-surfaced__n">
                    <span className="pl-figure pl-figure--lg">{discovery.score}</span>
                    <span className="pl-db-surfaced__unit">of 100</span>
                  </div>
                  <div>
                    <h3 className="pl-stamp">What you surfaced</h3>
                    <p className="pl-db-surfaced__note">{discovery.note}</p>
                  </div>
                </div>
              )
            )}
          </section>
        )}

        {/* ── Verdict ─────────────────────────────────────────────────────── */}
        <section className="pl-db-verdict pl-settle" style={v({ '--d': '120ms' })}>
          <div className="pl-db-score" style={v({ '--pl-score': band.color, '--pl-score-ink': band.textColor })}>
            <span className="pl-stamp">Overall</span>
            <span className="pl-figure pl-figure--xl pl-db-score__n">{debrief.overallScore}</span>
            <span className="pl-db-score__band">{band.label}</span>
            <span className="pl-db-score__outcome">{OUTCOME_LABELS[debrief.outcome]}</span>
          </div>

          <div className="pl-db-one">
            <h2 className="pl-stamp pl-stamp--clay">Change this one thing</h2>
            <p className="pl-db-one__text">{debrief.oneThing}</p>
            <div>
              <button
                type="button"
                className="pl-btn pl-btn--secondary pl-btn--sm"
                onClick={() => saveToPlaybook('one-thing', debrief.oneThing, null)}
                disabled={saved.has('one-thing')}
              >
                {saved.has('one-thing') ? 'In your playbook' : 'Save to playbook'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Keep it ─────────────────────────────────────────────────────── */}
        {/* The landing and pricing pages open a room on a browser-only id and
            never say so. This is the moment the user has just received
            something worth keeping, so it is where the product says where the
            record lives and how to take it with them — not at the door, where
            there would be nothing to keep yet.

            Three rules it is written to. It states the situation before it
            makes an offer, because "saved to this browser only" is a fact the
            person is entitled to whether or not they ever sign up. It names
            what is kept item by item, and every item on that list is a table
            the migration actually moves (see MIGRATED_TABLES in
            app/api/user/migrate) — progress trends are deliberately absent,
            because they are a paid entitlement and a free account does not get
            them. And it carries a ?next= back to this page, so the answer to
            "keep this" is this page again rather than a first-run screen.

            No modal, no countdown, no second ask. Shown to a browser-only
            identity AND to a throwaway guest account, whose work is held
            exactly as precariously — see lib/hooks/useSignedIn. */}
        {!signedIn && (
          <aside className="pl-db-keep" aria-label="Keep this rehearsal">
            <div className="pl-db-keep__said">
              <p className="pl-db-keep__copy">
                <strong>Saved to this browser only.</strong> Everything above
                lives under an id in this browser and nowhere else. Clear the
                browser, or open Parley on your phone, and it is gone.
              </p>
              <p className="pl-db-keep__copy">
                An account keeps <strong>this debrief</strong>, the{' '}
                <strong>full transcript</strong> of what you both said, and any{' '}
                <strong>playbook notes</strong> you saved from it — readable from
                anywhere you sign in. It takes an email and a password, and it
                brings you straight back to this page.
              </p>
            </div>
            <Link
              href={`/signup?next=${encodeURIComponent(`/debrief/${rehearsalId}`)}`}
              className="pl-btn pl-btn--primary pl-btn--sm pl-db-keep__cta"
            >
              Keep this rehearsal
            </Link>
          </aside>
        )}

        {/* ── Dimensions ──────────────────────────────────────────────────── */}
        {/* A ledger, not a chart. Five ruled rows: the dimension and the
            question it asks, the figure, the bar as a reading of that figure,
            and the note that cites the transcript. Glanceable down the figure
            column, explainable across the row. */}
        <h2 className="pl-stamp pl-db-section">How it broke down</h2>
        <section className="pl-db-dims pl-settle" style={v({ '--d': '180ms' })} aria-label="Scores by dimension">
          {DIMENSIONS.map((dim, i) => {
            const scored = debrief.dimensions.find(d => d.dimension === dim.id)
            const score = scored?.score ?? 0
            const dimBand = scoreBand(score)
            return (
              <div className="pl-db-dim" key={dim.id} style={v({ '--pl-score': dimBand.color, '--pl-score-ink': dimBand.textColor })}>
                <span className="pl-index pl-db-dim__i" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="pl-db-dim__what">
                  <h3 className="pl-db-dim__label">{dim.label}</h3>
                  <p className="pl-db-dim__q">{dim.question}</p>
                </div>
                <div className="pl-db-dim__read">
                  <span className="pl-figure pl-figure--lg pl-db-dim__n">{score}</span>
                  <span className="pl-db-dim__band">{dimBand.label}</span>
                  <div className="pl-db-dim__track" aria-hidden="true">
                    <div
                      className="pl-db-dim__fill"
                      style={v({ width: `${score}%`, '--d': `${240 + i * 90}ms` })}
                    />
                  </div>
                </div>
                <p className="pl-db-dim__note">{scored?.note}</p>
              </div>
            )
          })}
        </section>

        {/* ── Moments ─────────────────────────────────────────────────────── */}
        {ordered.length > 0 && (
          <>
            <h2 className="pl-stamp pl-db-section">The moments that moved it</h2>
            <section className="pl-db-moments">
              {ordered.map((moment, i) => {
                const isCost = moment.kind === 'cost'
                const key = `moment-${moment.turnPosition}-${i}`
                const turn = turns.find(t => t.position === moment.turnPosition)
                return (
                  <article
                    className="pl-db-moment pl-settle"
                    key={key}
                    /* Drawn tone and written tone — see .pl-db-moment__kind in
                       globals.css for why cost needs both and gain does not. */
                    style={v({
                      '--pl-moment': isCost ? SIGNAL.clay : SIGNAL.gain,
                      '--pl-moment-ink': isCost ? SIGNAL.clayDeep : SIGNAL.gain,
                      '--d': `${i * 70}ms`,
                    })}
                  >
                    <div className="pl-db-moment__head">
                      <span className="pl-db-moment__kind">{isCost ? 'Cost you' : 'Worked'}</span>
                      <button
                        type="button"
                        className="pl-link pl-db-moment__jump"
                        onClick={() => scrollToTurn(moment.turnPosition)}
                      >
                        Jump to the line
                      </button>
                    </div>

                    <p className="pl-db-moment__label">{moment.label}</p>

                    {turn && (
                      <blockquote className="pl-db-moment__quote">
                        {turn.content.length > 220 ? `${turn.content.slice(0, 220)}…` : turn.content}
                      </blockquote>
                    )}

                    {moment.betterLine && (
                      <div className="pl-db-better">
                        <h3 className="pl-stamp">Say it like this</h3>
                        <p className="pl-db-better__text">“{moment.betterLine}”</p>
                        <button
                          type="button"
                          className="pl-btn pl-btn--secondary pl-btn--sm"
                          onClick={() => saveToPlaybook(key, moment.betterLine!, null)}
                          disabled={saved.has(key)}
                        >
                          {saved.has(key) ? 'In your playbook' : 'Save to playbook'}
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </section>
          </>
        )}

        {/* ── Again ───────────────────────────────────────────────────────── */}
        <section className="pl-db-again">
          <div className="pl-db-again__copy">
            <h2 className="pl-stamp pl-stamp--clay">Run it again</h2>
            <p className="pl-db-again__title">You know what they were holding now.</p>
            <p className="pl-db-again__body">
              The second attempt is where the score actually moves. You have
              faced {counterpartName} on this one — pick someone else from the
              bench and it is a different call again, which is what happens when
              the vendor changes who is on it.
            </p>
          </div>
          <Link href={`/library/${scenario?.slug}`} className="pl-btn pl-btn--primary pl-btn--lg">
            Rehearse again
          </Link>
        </section>

        {/* ── Transcript ──────────────────────────────────────────────────── */}
        {/* The evidence, with the debrief's notes in the margin. A line the
            scorer named carries a mark in the gutter and its note beside it;
            every other line is left alone. Selective, so the marked ones read. */}
        <h2 className="pl-stamp pl-db-section">Full transcript</h2>
        <section className="pl-db-script">
          {turns.map(turn => {
            const notes = momentsByTurn.get(turn.position)
            const marked = notes && notes.length > 0
            const kind = marked ? (notes.some(n => n.kind === 'cost') ? 'cost' : 'gain') : undefined
            return (
              <div
                key={turn.position}
                id={`turn-${turn.position}`}
                className={`pl-db-turn pl-db-turn--${turn.side === 'you' ? 'you' : 'them'}`}
                data-flash={flashed === turn.position ? 'true' : undefined}
                data-mark={kind}
              >
                <div className="pl-db-turn__who">{turn.side === 'you' ? 'You' : counterpartName}</div>
                <div className="pl-db-turn__text">{turn.content}</div>
                {marked && (
                  <aside className="pl-db-turn__notes" aria-label="Debrief note on this line">
                    {notes.map((n, j) => (
                      <p
                        key={j}
                        className="pl-db-turn__note"
                        style={v({
                          '--pl-moment': n.kind === 'cost' ? SIGNAL.clay : SIGNAL.gain,
                          '--pl-moment-ink': n.kind === 'cost' ? SIGNAL.clayDeep : SIGNAL.gain,
                        })}
                      >
                        <span className="pl-db-turn__note-kind">{n.kind === 'cost' ? 'Cost you' : 'Worked'}</span>
                        {n.label}
                      </p>
                    ))}
                  </aside>
                )}
              </div>
            )
          })}
        </section>

        {/* ── Report ──────────────────────────────────────────────────────── */}
        {/* Placed here, under the transcript, for two reasons. It is the moment
            the person has just re-read what the counterpart actually said, so
            it is when they know whether it broke role. And it is after the
            rehearsal, which is the only place it may be: a "report this turn"
            control inside the room would put a judgement about the counterpart
            on screen while the negotiation is running, which is the live
            feedback this product refuses on purpose. */}
        <ReportCounterpart rehearsalId={rehearsalId} userId={userId} who={counterpartName} />
      </div>
    </Page>
  )
}

/**
 * Telling us the counterpart misbehaved.
 *
 * The backend for this existed for a long time before anything could
 * reach it — the route, the reasons and the table were built and never given a
 * door, so the `reports` table could not receive a row. That matters more here
 * than it would in most products: every claim this one makes rests on the
 * counterpart not folding and not disclosing, both of which are checked by an
 * eval suite that is explicitly unverified against a live model
 * (docs/product-direction.md §8.7). A user who has just watched one concede in
 * three turns is the only instrument that sees the real distribution.
 *
 * Deliberately a disclosure and not a card. It is the last thing on a long
 * page and it is for the minority of rehearsals that went wrong; drawn open it
 * would read as an invitation to find fault with a debrief the person is
 * supposed to be learning from. `<details>` is native, so it is keyboard
 * reachable and announced as expandable without any ARIA of our own.
 */
function ReportCounterpart({
  rehearsalId,
  userId,
  who,
}: {
  rehearsalId: string
  userId: string
  who: string
}) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  async function send() {
    if (!reason || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, rehearsalId, reason, detail: detail.trim() || undefined }),
      })
      // The route answers ok only on a row that actually landed, so this is a
      // real confirmation rather than a hopeful one.
      setState(res.ok ? 'sent' : 'failed')
    } catch {
      setState('failed')
    }
  }

  if (state === 'sent') {
    return (
      <section className="pl-db-report" aria-live="polite">
        <p className="pl-db-report__done">
          Filed. Reports are read against the scenario&apos;s own prompt — this is
          how a counterpart that folds gets found.
        </p>
      </section>
    )
  }

  return (
    <section className="pl-db-report">
      <details className="pl-db-report__d">
        <summary className="pl-db-report__summary">Did {who} behave wrongly?</summary>
        <div className="pl-db-report__body">
          <p className="pl-db-report__lede">
            Pressure, silence and a flat no are the exercise. Coaching you,
            folding, or telling you what they were holding is a fault in the
            scenario, and we would rather hear about it than not.
          </p>

          <fieldset className="pl-db-report__set">
            <legend className="pl-sr-only">What went wrong</legend>
            {REPORT_REASONS.map(r => (
              <label className="pl-db-report__opt" key={r.id}>
                <input
                  type="radio"
                  name="report-reason"
                  value={r.id}
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                />
                <span>
                  <span className="pl-db-report__opt-label">{r.label}</span>
                  <span className="pl-db-report__opt-hint">{r.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="pl-db-report__detail-label" htmlFor="report-detail">
            Anything else <span className="pl-db-report__optional">(optional)</span>
          </label>
          <textarea
            id="report-detail"
            className="pl-textarea"
            rows={3}
            maxLength={MAX_REPORT_DETAIL}
            value={detail}
            onChange={e => setDetail(e.target.value)}
            placeholder="Which turn, and what they did."
          />
          {/* The transcript is not attached. It is already stored against this
              rehearsal and the id goes with the report, so copying candid text
              into a second table would spread it for no gain. Saying so is the
              point — someone deciding whether to report has just re-read what
              they typed about their own employer. */}
          <p className="pl-db-report__fine">
            Your transcript is not attached. The report carries this
            rehearsal&apos;s id, and it is already stored.
          </p>

          {state === 'failed' && (
            <p className="pl-db-report__error" role="alert">
              That did not send. Try again in a moment — nothing else about this
              debrief is affected.
            </p>
          )}

          <button
            type="button"
            className="pl-btn pl-btn--secondary"
            onClick={send}
            disabled={!reason || state === 'sending'}
          >
            {state === 'sending' ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </details>
    </section>
  )
}

/**
 * The ledger: every lever the counterpart was holding, found or missed.
 *
 * This is the part of the debrief a general-purpose chat cannot produce. The
 * set is closed and authored in advance — it is not the model's opinion about
 * what might have been available — so "two of five" is a fraction with a real
 * denominator, and the three missed rows carry the question that would have
 * opened each one. A score tells you that you did badly at discovery. This
 * tells you which sentence you did not say.
 *
 * Drawn as a register rather than as cards: a rule per row, a mark in the
 * gutter, the taxonomy set small and right. Cards would give five items equal
 * visual weight and invite the eye to graze; the list makes it a reading, top
 * to bottom, which is what a ledger is for.
 *
 * Colour follows the product's three meanings and adds nothing. Citron is a
 * thing you found out, so found rows are filled citron. Clay is cost, so the
 * rows that cost the counterpart NOTHING and were still missed are filled clay
 * — the sting the whole mechanic exists to deliver. Everything else is a
 * hollow mark and muted ink, because a thing you never found is not an event.
 */
function LeverLedger({ levers, delay }: { levers: ScoredLever[]; delay: string }) {
  const tally = tallyLevers(levers)
  const band = scoreBand(tally.percent)

  return (
    <section
      className="pl-ledger"
      aria-labelledby="pl-ledger-h"
      style={v({ '--d': delay, '--pl-score': band.color, '--pl-score-ink': band.textColor })}
    >
      <header className="pl-ledger__head">
        <h3 className="pl-stamp" id="pl-ledger-h">
          What was on the table
        </h3>
        <p className="pl-ledger__count">
          <span className="pl-figure pl-figure--lg">{tally.found}</span>
          <span className="pl-ledger__of">of {tally.total}</span>
        </p>
      </header>

      <p className="pl-ledger__verdict">{leverVerdict(levers)}</p>

      <ol className="pl-ledger__list">
        {levers.map(lever => {
          const missedFree = !lever.found && lever.free === true
          return (
            <li
              key={lever.id}
              className="pl-ledger__row"
              data-found={lever.found ? 'true' : undefined}
              data-free={missedFree ? 'true' : undefined}
            >
              <span className="pl-ledger__mark" aria-hidden="true" />
              <div className="pl-ledger__body">
                <p className="pl-ledger__label">
                  {/* The mark is the only visual carrier of the verdict, so the
                      word itself is spoken rather than implied. */}
                  <span className="pl-sr-only">{lever.found ? 'Found: ' : 'Missed: '}</span>
                  {lever.label}
                </p>
                {!lever.found && (
                  <p className="pl-ledger__miss">
                    {/* The separating space is explicit: the label's margin is
                        visual only, and without it this reads aloud as
                        "what opens itAsking what a longer commitment…". */}
                    <span className="pl-ledger__miss-k">
                      {missedFree ? 'Cost them nothing' : 'What opens it'}
                    </span>{' '}
                    {lever.unlockedBy}
                  </p>
                )}
              </div>
              <span className="pl-ledger__kind">{LEVER_KIND_LABELS[lever.kind]}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * The reveal, staged.
 *
 * A dark plane over the whole viewport in the room's register. While the
 * transcript is being scored it holds the sealed block — the same redaction
 * you stared at for the whole rehearsal — and a line saying what is happening.
 * When the debrief lands, the block becomes the mandate: each sentence mounts
 * under its own bar and the bars slide off in order, top to bottom. Then the
 * measure of how much of it you surfaced settles in under it, and finally the
 * way out. Continuing lifts the plane upward off the page.
 *
 * Nothing here fades in from nowhere. Every arrival is a movement and every
 * movement is a change of state.
 */
function RevealAct({
  state,
  busy,
  who,
  scenarioTitle,
  mandate,
  levers,
  discovery,
  onContinue,
  onLeft,
}: {
  state: ActState
  busy: boolean
  who: string
  scenarioTitle: string
  mandate: string
  levers: ScoredLever[]
  discovery: { score: number; note: string } | null
  onContinue: () => void
  onLeft: () => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const goRef = useRef<HTMLButtonElement>(null)
  const lines = useMemo(() => (mandate ? sentencesOf(mandate) : []), [mandate])
  const settledMs = LINE_START_MS + Math.max(0, lines.length - 1) * LINE_STAGGER_MS + LINE_SLIDE_MS

  // The figure this screen lands on.
  //
  // A fraction, not a score out of a hundred: "you got two of the five things
  // they were holding" is a sentence the person can check against the list
  // they are about to read, and "61" is not. The 0–100 Information gain score
  // is still on the paper page, in the dimension grid where the other four
  // live — it belongs in a trend, not in the moment.
  //
  // Levers are absent only on a debrief scored before they existed, and that
  // one falls back to the score it was written with rather than to nothing.
  const tally = levers.length > 0 ? tallyLevers(levers) : null
  const band = tally
    ? scoreBand(tally.percent)
    : discovery
      ? scoreBand(discovery.score)
      : null

  // Focus follows the act: into the frame while it is sealed, so assistive
  // technology reads the status; onto the way out once it is open, after the
  // last bar has lifted.
  useEffect(() => {
    if (state === 'sealed') frameRef.current?.focus({ preventScroll: true })
  }, [state])

  useEffect(() => {
    if (state !== 'open') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(() => goRef.current?.focus({ preventScroll: true }), reduced ? 0 : settledMs + 320)
    return () => window.clearTimeout(t)
  }, [state, settledMs])

  // The curtain's own animation ends the act. A fallback timer covers the case
  // where the event never fires — a stylesheet still loading, an odd browser —
  // because an overlay that never leaves is a page that never arrives.
  useEffect(() => {
    if (state !== 'leaving') return
    const t = window.setTimeout(onLeft, 900)
    return () => window.clearTimeout(t)
  }, [state, onLeft])

  return (
    <div
      className="pl-room pl-act"
      data-state={state}
      onAnimationEnd={e => {
        if (state === 'leaving' && e.target === e.currentTarget) onLeft()
      }}
    >
      <style>{`body { background: var(--pl-room-ground); }`}</style>

      <div className="pl-act__frame" ref={frameRef} tabIndex={-1}>
        <p className="pl-act__where">
          <span className="pl-act__who">{who}</span>
          {scenarioTitle && <span className="pl-act__title">{scenarioTitle}</span>}
        </p>

        {state === 'sealed' || busy ? (
          <>
            <h1 className="pl-stamp pl-stamp--steel pl-act__stamp">What they were holding</h1>
            <div className="pl-act__sealed">
              <Redacted lines={5} label="Their mandate, still sealed." />
            </div>
            <p className="pl-act__status" role="status">
              <span className="pl-sweep" aria-hidden="true" />
              <span>
                The rehearsal has ended. Reading the transcript against what they
                were holding — a few seconds.
              </span>
            </p>
          </>
        ) : (
          <>
            <h1 className="pl-stamp pl-stamp--citron pl-act__stamp">What they were holding</h1>
            <div className="pl-act__mandate">
              {lines.map((line, i) => (
                <p
                  key={i}
                  className="pl-reveal pl-act__line"
                  style={v({ '--d': `${LINE_START_MS + i * LINE_STAGGER_MS}ms` })}
                >
                  {line}
                </p>
              ))}
            </div>

            {band && (tally || discovery) && (
              <div
                className="pl-act__surfaced pl-settle"
                /* Dark stage: bright tone only. --pl-score-ink is the paper
                   variant and would be unreadable here. See lib/design.ts. */
                style={v({ '--d': `${settledMs + 120}ms`, '--pl-score': band.color })}
              >
                <div className="pl-act__surfaced-n">
                  <span className="pl-figure pl-figure--lg">
                    {tally ? tally.found : discovery?.score}
                  </span>
                  <span className="pl-act__unit">{tally ? `of ${tally.total}` : 'of 100'}</span>
                </div>
                <div>
                  <h2 className="pl-stamp">What you surfaced</h2>
                  <p className="pl-act__surfaced-note">
                    {tally ? leverVerdict(levers) : discovery?.note}
                  </p>
                </div>
              </div>
            )}

            <div className="pl-act__go pl-settle" style={v({ '--d': `${settledMs + 360}ms` })}>
              <button
                type="button"
                ref={goRef}
                className="pl-btn pl-btn--primary pl-btn--lg"
                onClick={onContinue}
              >
                See what it cost
              </button>
              <span className="pl-act__go-note">
                {tally && tally.found < tally.total
                  ? `The ${tally.total - tally.found} you missed, the questions that would have opened them, and five scores.`
                  : 'Five scores, the moments that moved it, and one thing to change.'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
    </>
  )
}
