'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUserId } from '@/lib/hooks/useUserId'
import { acceptsTurns, toRehearsalStatus } from '@/lib/negotiation/lifecycle'
import { markRevealPending } from '@/lib/revealHandoff'
import Redacted from '@/app/components/Redacted'

// The rehearsal room.
//
// Everything on this screen is in service of one thing: making the user answer
// under conditions close enough to the real conversation that their instincts
// show up. That is why the clock is always visible, why the objective stays
// pinned, and — most importantly — why the counterpart's mandate is nowhere in
// this component or in anything the API sends it while the rehearsal is live.
//
// THE COMPOSITION. Two columns, and the asymmetry between them is the product:
// your side of the table is a legible document, and their side is a redacted
// one. The sealed block in the counterpart panel is drawn from nothing — it
// contains no text at any point — so it can state the mechanic without being
// able to leak it. It is the same object that lifts on the debrief screen once
// the rehearsal has ended.
//
// THE TRANSCRIPT IS NOT A CHAT. No bubbles, no avatars, no "typing…". Two
// voices on one page, told apart by position, face and colour: theirs in the
// serif, inset and ruled in steel; yours in the sans, flush and ruled in clay.
// The composer is drawn as the next line of that transcript rather than as a
// form at the bottom of it — what you are typing looks like what you are about
// to have said.
//
// The room still gives no live feedback. No score ticking up, no hints, no
// "good question!". The phase strip is not an exception: it reports how much of
// the expected length is gone, which is what a clock on a wall tells you, and
// says nothing about how the user is doing.

interface TurnView {
  side: 'you' | 'counterpart'
  content: string
  position: number
}

interface ScenarioView {
  slug: string
  title: string
  premise: string
  situation: string
  objective: string
  constraints: string[]
  counterpartRole: string
  estimatedMinutes: number
  /** How many things they are holding. Constant for the whole rehearsal. */
  leverCount: number
}

interface CounterpartView {
  id: string
  name: string
  role: string
}

/**
 * How long the room holds still after you end it, before the debrief opens.
 * The rehearsal is over and nothing happens for a moment — which is what the
 * end of a real call feels like, and what makes the reveal that follows land
 * as an event rather than as the next page loading.
 */
const STILLNESS_MS = 560

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Where the conversation sits in its expected length. The thirds match the
 * pacing the counterpart itself runs on, so the strip and the room agree.
 */
function phaseOf(elapsedSeconds: number, estimatedMinutes: number) {
  const total = Math.max(1, estimatedMinutes * 60)
  const ratio = elapsedSeconds / total
  if (ratio < 0.35) return { key: 'early' as const, label: 'Opening', cells: 1 }
  if (ratio < 0.75) return { key: 'middle' as const, label: 'Midpoint', cells: 2 }
  return { key: 'late' as const, label: 'Closing', cells: 3 }
}

/**
 * The composer grows with what is being said, up to a share of the viewport,
 * instead of presenting a fixed box with a resize handle. A box asks to be
 * filled; a line that lengthens as you speak does not.
 */
function fitField(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  const max = Math.round(window.innerHeight * 0.38)
  const next = Math.min(el.scrollHeight, max)
  el.style.height = `${next}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

export default function RoomClient({ rehearsalId }: { rehearsalId: string }) {
  const userId = useUserId()
  const router = useRouter()
  const [scenario, setScenario] = useState<ScenarioView | null>(null)
  const [counterpart, setCounterpart] = useState<CounterpartView | null>(null)
  const [turns, setTurns] = useState<TurnView[]>([])
  const [status, setStatus] = useState<'loading' | 'live' | 'ended' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [notice, setNotice] = useState<{ kind: 'refusal' | 'resources' | 'error'; text: string } | null>(null)

  const [elapsed, setElapsed] = useState(0)
  // Two independent pieces of state for one panel, because it is two different
  // things at two widths: a column you can collapse on a desktop, and a sheet
  // you pull open on a phone. Deriving one from the viewport would mean either
  // reading matchMedia during render (a hydration mismatch) or setting state in
  // an effect (a cascading render). CSS decides which one is in play.
  const [briefCollapsed, setBriefCollapsed] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)

  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const startedAtRef = useRef<number | null>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)
  const sheetTriggerRef = useRef<HTMLButtonElement>(null)
  const endConfirmRef = useRef<HTMLButtonElement>(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(
          `/api/rehearsal/session?userId=${encodeURIComponent(userId)}&rehearsalId=${encodeURIComponent(rehearsalId)}`
        )
        if (!res.ok) {
          if (!cancelled) {
            setStatus('error')
            setLoadError(res.status === 404 ? 'This rehearsal could not be found.' : 'Could not open this room.')
          }
          return
        }
        const data = await res.json()
        if (cancelled) return

        setScenario(data.scenario)
        setCounterpart(data.counterpart)
        setTurns(data.turns ?? [])
        startedAtRef.current = new Date(data.rehearsal.startedAt).getTime()
        // Only a live rehearsal takes turns; every other state renders the
        // read-only view. Asking the lifecycle rather than string-matching
        // means a state added later cannot accidentally read as writable.
        setStatus(acceptsTurns(toRehearsalStatus(data.rehearsal.status)) ? 'live' : 'ended')
      } catch {
        if (!cancelled) {
          setStatus('error')
          setLoadError('Could not reach the server.')
        }
      }
    })()

    return () => { cancelled = true }
  }, [userId, rehearsalId])

  // ── Clock ─────────────────────────────────────────────────────────────────
  // Derived from the server's started_at rather than counted locally, so a
  // refresh mid-rehearsal does not reset the pressure.
  useEffect(() => {
    if (status !== 'live') return
    const tick = () => {
      if (startedAtRef.current) {
        setElapsed(Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)))
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [status])

  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streaming])

  // The field shrinks back to one line after a turn is sent, and fits whatever
  // is restored into it. Keyed on the value so it also runs for the clear.
  useEffect(() => {
    if (inputRef.current) fitField(inputRef.current)
  }, [input])

  // ── The brief sheet, on narrow viewports ─────────────────────────────────
  // Escape closes it, focus moves into it on open and back to the trigger on
  // close. That is what makes it usable without a mouse.
  useEffect(() => {
    if (!sheetOpen) return
    sheetCloseRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheetOpen(false)
        sheetTriggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  useEffect(() => {
    if (!confirmEnd) return
    endConfirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ending) setConfirmEnd(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmEnd, ending])

  // ── Resync the transcript with the record ─────────────────────────────────
  //
  // The composer puts your turn on screen the moment you send it, before the
  // server has agreed to it. Most of the time the server does agree and the
  // optimism is invisible. When it does not — a safety refusal, a rehearsal
  // that has already ended, the daily cap, a write that did not land — the
  // request returns before the turn is persisted, and what you are looking at
  // is a transcript with a line in it that no longer exists anywhere else. It
  // survives until you reload, and then it is gone.
  //
  // That is the one failure this product must not have. A rehearsal transcript
  // is candid and it is the only record of what you said; a line that silently
  // disappears reads as lost data, not as a rejected turn. So every failed send
  // re-reads the transcript from the record and shows that instead. What is on
  // screen after a failure is what is stored, and the notice beside it says why.
  const resync = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(
        `/api/rehearsal/session?userId=${encodeURIComponent(userId)}&rehearsalId=${encodeURIComponent(rehearsalId)}`
      )
      if (!res.ok) return
      const data = await res.json()
      setTurns(data.turns ?? [])
      // A rehearsal the server has since ended stops taking turns here too,
      // rather than leaving a composer that can only fail.
      if (data.rehearsal && !acceptsTurns(toRehearsalStatus(data.rehearsal.status))) {
        setStatus('ended')
      }
    } catch {
      // The transcript stays as it was. The send's own notice already says
      // something went wrong, and a failed resync has nothing to add.
    }
  }, [userId, rehearsalId])

  // ── Send a turn ───────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending || status !== 'live') return

    setSending(true)
    setNotice(null)
    setInput('')
    setStreaming('')

    const nextPosition = turns.length
    setTurns(prev => [...prev, { side: 'you', content: text, position: nextPosition }])

    try {
      const res = await fetch('/api/rehearsal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rehearsalId, userId, message: text }),
      })

      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}))
        setNotice({
          kind: res.status === 400 || res.status === 451 ? 'refusal' : 'error',
          text: payload.error || 'The counterpart could not respond. Try again.',
        })
        // Put back whatever the turn you just sent left behind. Some of these
        // paths saved it and then failed to reach the counterpart; most
        // refused before writing anything. The record knows which.
        await resync()
        setSending(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let evt: {
            chunk?: string
            done?: boolean
            fullReply?: string
            resources?: string | null
            truncated?: boolean
          }
          try {
            evt = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (evt.chunk) {
            accumulated += evt.chunk
            setStreaming(accumulated)
          }

          if (evt.done) {
            const reply = evt.fullReply ?? accumulated
            setTurns(prev => [...prev, { side: 'counterpart', content: reply, position: nextPosition + 1 }])
            setStreaming('')
            if (evt.resources) {
              setNotice({ kind: 'resources', text: evt.resources })
            } else if (evt.truncated) {
              // Say so rather than letting a sentence that stops mid-clause
              // read as a deliberate move by the counterpart. Their turn is
              // saved either way, so the rehearsal continues from here.
              setNotice({
                kind: 'error',
                text: 'That reply was cut off before they finished. What arrived is in the transcript. Carry on, or say it again to draw them out.',
              })
            }
          }
        }
      }
    } catch {
      // "Your turn was saved" was asserted here, and the client has no way to
      // know that — a fetch that threw may never have reached the server at
      // all. The transcript below now answers the question instead of a
      // sentence promising an outcome nobody checked.
      setNotice({
        kind: 'error',
        text: 'The connection dropped mid-turn. The transcript below is what was recorded.',
      })
      await resync()
    } finally {
      setSending(false)
      setStreaming('')
      inputRef.current?.focus()
    }
  }, [input, sending, status, turns.length, rehearsalId, userId, resync])

  // ── End the rehearsal ─────────────────────────────────────────────────────
  // The dialog closes at once and the room goes still — the composer drops
  // away, the transcript dims, the live mark stops — while the end is recorded.
  // Then the debrief opens by a client-side transition, so the dark of the room
  // runs straight into the dark of the reveal with no page load between them.
  async function end() {
    if (ending) return
    setEnding(true)
    setConfirmEnd(false)
    // The debrief plays the reveal exactly once, and this is how it knows
    // this is that once. A flag with an id on it; the mandate stays server-side
    // until /api/debrief releases it for an ended rehearsal.
    markRevealPending(rehearsalId)

    const began = Date.now()
    try {
      await fetch('/api/rehearsal/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rehearsalId, userId, reason: 'completed' }),
      })
    } catch {
      // The debrief page ends the rehearsal itself if this did not land, so a
      // failure here is recoverable rather than a dead end.
    }
    const remaining = Math.max(0, STILLNESS_MS - (Date.now() - began))
    await new Promise(resolve => window.setTimeout(resolve, remaining))
    router.push(`/debrief/${rehearsalId}`)
  }

  const estimated = scenario?.estimatedMinutes ?? 0
  const overtime = scenario ? elapsed > estimated * 60 : false
  const phase = phaseOf(elapsed, estimated || 1)
  const yourTurns = turns.filter(t => t.side === 'you').length

  // ── States ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <Shell>
        <div className="pl-state pl-state--center pl-state--busy" role="status">
          <span className="pl-state__mark" aria-hidden="true" />
          <h1 className="pl-state__title">Opening the room</h1>
          <p className="pl-state__body">
            Loading your brief, and whoever is sitting on the other side of it.
          </p>
          <span className="pl-sweep" aria-hidden="true" />
        </div>
      </Shell>
    )
  }

  if (status === 'error') {
    return (
      <Shell>
        <div className="pl-state pl-state--center pl-state--error" role="alert">
          <span className="pl-state__mark" aria-hidden="true" />
          <h1 className="pl-state__title">{loadError}</h1>
          <p className="pl-state__body">
            A rehearsal belongs to the account that opened it, and the link only
            works from that browser. If this one was yours, the library will
            start a fresh one.
          </p>
          <div className="pl-state__actions">
            <Link href="/library" className="pl-btn pl-btn--primary">Back to the library</Link>
            <Link href="/dashboard" className="pl-btn pl-btn--secondary">Your rehearsals</Link>
          </div>
        </div>
      </Shell>
    )
  }

  const live = status === 'live'
  const who = counterpart?.name ?? 'Counterpart'

  return (
    <Shell ending={ending}>
      <header className="pl-room-head">
        {live && <span className="pl-live-dot pl-room-head__live" aria-hidden="true" />}

        {/* Who is across the table leads; the deal is the footnote. You
            already know which renewal you opened. What you have to hold on to
            for fourteen minutes is who is on the other side of it. */}
        <div className="pl-room-head__id">
          <div className="pl-room-head__who">
            {who}
            {scenario?.counterpartRole && (
              <span className="pl-room-head__role"> · {scenario.counterpartRole}</span>
            )}
          </div>
          <div className="pl-room-head__title">{scenario?.title}</div>
        </div>

        {live && (
          <div className="pl-room-phase" data-phase={phase.key}>
            <span className="pl-room-phase__cells" aria-hidden="true">
              {[1, 2, 3].map(n => (
                <span key={n} className="pl-room-phase__cell" data-on={n <= phase.cells ? 'true' : undefined} />
              ))}
            </span>
            <span className="pl-room-phase__label">{phase.label}</span>
          </div>
        )}

        <div className="pl-room-clock" data-over={overtime ? 'true' : undefined}>
          <span className="pl-figure pl-room-clock__now">{formatClock(elapsed)}</span>
          {estimated > 0 && <span className="pl-room-clock__of">of {estimated}m</span>}
        </div>

        {/* Two triggers, one panel. CSS shows whichever the viewport calls for,
            which avoids reading the viewport in JavaScript. */}
        <button
          type="button"
          className="pl-btn pl-btn--ghost pl-btn--sm pl-room-brief__toggle"
          onClick={() => setBriefCollapsed(v => !v)}
          aria-expanded={!briefCollapsed}
          aria-controls="pl-room-brief"
        >
          {briefCollapsed ? 'Show brief' : 'Hide brief'}
        </button>
        <button
          type="button"
          ref={sheetTriggerRef}
          className="pl-btn pl-btn--ghost pl-btn--sm pl-room-brief__open"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-controls="pl-room-brief"
        >
          Brief
        </button>

        {live ? (
          <button
            type="button"
            className="pl-btn pl-btn--secondary pl-btn--sm"
            onClick={() => setConfirmEnd(true)}
            disabled={ending}
          >
            {ending ? 'Ending' : 'End'}
          </button>
        ) : (
          <Link href={`/debrief/${rehearsalId}`} className="pl-btn pl-btn--primary pl-btn--sm">
            See debrief
          </Link>
        )}
      </header>

      <div className="pl-room-body">
        {sheetOpen && (
          <div
            className="pl-sheet-backdrop"
            onClick={() => { setSheetOpen(false); sheetTriggerRef.current?.focus() }}
            aria-hidden="true"
          />
        )}

        {/* Your side of the table. Stays reachable at every width: losing sight
            of your own objective mid-conversation is one of the failures being
            trained out, and hiding it on a phone removed the discipline exactly
            where it is hardest to keep. */}
        <aside
          id="pl-room-brief"
          className="pl-room-brief"
          data-collapsed={briefCollapsed ? 'true' : undefined}
          data-open={sheetOpen ? 'true' : undefined}
          {...(sheetOpen ? { role: 'dialog', 'aria-modal': true as const } : {})}
          aria-label="Your brief"
          // Scrolls on its own when the brief is longer than the viewport, so
          // it has to take focus: otherwise a keyboard user cannot scroll it.
          tabIndex={0}
        >
          <div className="pl-room-brief__inner">
            <button
              type="button"
              ref={sheetCloseRef}
              className="pl-btn pl-btn--ghost pl-btn--sm pl-room-brief__close"
              onClick={() => { setSheetOpen(false); sheetTriggerRef.current?.focus() }}
            >
              Close
            </button>

            <h2 className="pl-stamp pl-stamp--clay">Your objective</h2>
            <p className="pl-room-brief__objective">{scenario?.objective}</p>

            <h2 className="pl-stamp">Your constraints</h2>
            <ul className="pl-room-brief__list">
              {scenario?.constraints.map((c, i) => (
                <li key={i}>
                  <span className="pl-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>

            <h2 className="pl-stamp">The situation</h2>
            <p className="pl-room-brief__situation">{scenario?.situation}</p>

            {/* Their side of the table, stated as an object rather than as a
                sentence. This block never contains text — see Redacted. */}
            <div className="pl-room-sealed">
              <span className="pl-tab pl-tab--steel">Across the table</span>
              <p className="pl-room-sealed__who">{who}</p>
              <p className="pl-room-sealed__role">{scenario?.counterpartRole}</p>
              <h3 className="pl-stamp pl-stamp--steel">What they are working from</h3>
              {/* One bar per thing they are holding. A fixed number, set before
                  the rehearsal began and unchanged by anything said in it — it
                  is the brief restated, not a meter. A count that moved as you
                  found things would be live feedback, which this room does not
                  have and the real meeting will not either. */}
              <Redacted
                lines={scenario?.leverCount || 4}
                label={`${scenario?.leverCount ?? 'Several'} things, sealed until this rehearsal ends.`}
              />
              <p className="pl-room-sealed__note">
                {scenario?.leverCount
                  ? `${scenario.leverCount} things are behind that. Every one of them can be found by asking the right question.`
                  : 'Sealed until you finish. Everything in it can be found by asking the right question.'}
              </p>
            </div>
          </div>
        </aside>

        <div className="pl-room-main">
          {/* Focusable and named for the same reason as the brief: it is the
              one scrolling region a keyboard user most needs to read back. */}
          <div className="pl-room-scroll" ref={transcriptRef} tabIndex={0} role="region" aria-label="Transcript">
            <div className="pl-room-thread">
              {turns.map(turn => (
                <Line
                  key={turn.position}
                  side={turn.side}
                  who={turn.side === 'you' ? 'You' : who}
                  text={turn.content}
                />
              ))}

              {streaming && (
                <Line side="counterpart" who={who} text={streaming} caret streaming />
              )}

              {sending && !streaming && <Presence who={who} />}

              {notice && (
                <div className={`pl-room-notice pl-room-notice--${notice.kind}`} role="status">
                  {notice.text}
                </div>
              )}
            </div>
          </div>

          {live ? (
            <div className="pl-room-composer">
              <div className="pl-room-composer__inner">
                {/* The composer is the transcript's next line: your label in
                    your colour, a rule down the left, and the words after it.
                    The rule is faint until the field has focus and solid clay
                    once it does, which is the state you are in — speaking. */}
                <div className="pl-room-composer__who" aria-hidden="true">You</div>
                <label className="pl-sr-only" htmlFor="pl-room-input">Your turn</label>
                <textarea
                  id="pl-room-input"
                  ref={inputRef}
                  className="pl-room-composer__field"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  placeholder="Say it the way you would say it."
                  rows={1}
                  disabled={sending || ending}
                />
                <div className="pl-room-composer__foot">
                  <span className="pl-room-composer__hint">
                    {overtime ? (
                      <>Past the expected length. Nothing cuts you off, but they will start closing.</>
                    ) : (
                      <>
                        {/* The shortcut only exists with a keyboard; on a
                            touch screen the button is the way to send. */}
                        <span className="pl-room-composer__keys">
                          <kbd className="pl-kbd">Ctrl</kbd>
                          <kbd className="pl-kbd">Enter</kbd>
                          <span> to send.</span>
                        </span>
                        <span>No edits, no take-backs.</span>
                      </>
                    )}
                  </span>
                  <div className="pl-room-composer__right">
                    <span className="pl-index pl-room-composer__count">
                      {yourTurns} {yourTurns === 1 ? 'turn' : 'turns'}
                    </span>
                    <button
                      type="button"
                      className="pl-btn pl-btn--primary"
                      onClick={send}
                      disabled={sending || ending || !input.trim()}
                    >
                      {sending ? 'Sending' : 'Say it'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pl-room-composer">
              <div className="pl-room-composer__inner pl-room-composer__foot">
                <span className="pl-room-composer__hint">This rehearsal has ended.</span>
                <Link href={`/debrief/${rehearsalId}`} className="pl-btn pl-btn--primary">
                  Read the debrief
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmEnd && (
        <div className="pl-modal-backdrop" onClick={() => !ending && setConfirmEnd(false)} role="presentation">
          <div
            className="pl-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pl-end-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="pl-modal__title" id="pl-end-title">End the rehearsal?</h2>
            {/* A debrief needs at least two of your turns to read anything into
                (app/api/debrief refuses fewer with 422). Ending before that
                still closes the room and still counts for the month, so the
                dialog says so instead of promising a score it cannot deliver. */}
            {yourTurns < 2 ? (
              <p className="pl-modal__body">
                {yourTurns === 0 ? 'You have not said anything yet.' : 'You have said one thing so far.'}{' '}
                A debrief needs at least two of your turns, so ending now leaves
                nothing to score — and this rehearsal still counts as one of the
                month&apos;s. Say something first, or end it and start again from
                the brief.
              </p>
            ) : (
              <p className="pl-modal__body">
                The transcript gets scored and their mandate is unsealed. You cannot
                come back into this room afterwards, but you can run the scenario
                again from the start.
              </p>
            )}
            <div className="pl-modal__actions">
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={() => setConfirmEnd(false)}
                disabled={ending}
              >
                Keep going
              </button>
              <button
                type="button"
                ref={endConfirmRef}
                className="pl-btn pl-btn--primary"
                onClick={end}
                disabled={ending}
              >
                {yourTurns < 2 ? 'End anyway' : 'End and debrief'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, ending }: { children: React.ReactNode; ending?: boolean }) {
  return (
    // <main> because the room is the page: without a main landmark, screen
    // reader users had no way to jump past the header into the conversation.
    <main className="pl-room pl-room-shell" data-ending={ending ? 'true' : undefined}>
      {children}
      {/* The room is the only dark surface in the product, and <body> sits
          behind it during overscroll. The colour is the room's own ground,
          read from the token rather than repeated here. */}
      <style>{`body { background: var(--pl-room-ground); }`}</style>
    </main>
  )
}

/**
 * The counterpart, present but not yet speaking. Their name is already on the
 * page and a single steel rule breathes where their words will go, so the gap
 * before a reply reads as a person drawing breath rather than as a machine
 * working. When the first token lands, the label stays where it is and the
 * rule becomes the sentence.
 */
function Presence({ who }: { who: string }) {
  return (
    <div className="pl-say pl-say--them pl-say--pending" role="status">
      <div className="pl-say__who">{who}</div>
      <div className="pl-say__text" aria-hidden="true">
        <span className="pl-breath" />
      </div>
      <span className="pl-sr-only">{who} is answering</span>
    </div>
  )
}

function Line({
  side,
  who,
  text,
  caret,
  streaming,
}: {
  side: 'you' | 'counterpart'
  who: string
  text: string
  caret?: boolean
  streaming?: boolean
}) {
  // Colour and side are the only things distinguishing the two, and they are
  // consistent everywhere in the product: clay is you, steel is them. In a
  // scrolled-back transcript that lets you find your own turns without reading
  // a word of them.
  return (
    <div className={`pl-say pl-say--${side === 'you' ? 'you' : 'them'}${streaming ? '' : ' pl-rise'}`}>
      <div className="pl-say__who">{who}</div>
      <div className="pl-say__text">
        {text}
        {caret && <span className="pl-caret" />}
      </div>
    </div>
  )
}
