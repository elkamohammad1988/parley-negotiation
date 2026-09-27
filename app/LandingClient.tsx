'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import Redacted from '@/app/components/Redacted'
import { DIMENSIONS, DIMENSION_BY_ID } from '@/lib/negotiation/dimensions'
import type { DimensionId } from '@/lib/negotiation/types'
import { BUILT_IN_COUNTERPARTS } from '@/lib/negotiation/counterparts'
import type { CatalogueScenario, LandingScenario } from '@/lib/negotiation/redact'
import { PLAN_FEATURES } from '@/lib/plans'
import { useUserId } from '@/lib/hooks/useUserId'
import { useOpenRoom } from '@/lib/hooks/useOpenRoom'
import './landing.css'

// The landing page.
//
// app/landing.css carries the art direction and the reasoning behind it; this
// file is the composition and the one piece of real product on it. Two rules
// govern everything here:
//
//   1. Every fact is read out of lib/negotiation and lib/plans rather than
//      retyped, so the marketing surface cannot drift from the product. The
//      counterpart's opening line, the scenario titles, the five dimension
//      names and the free-plan allowance are all live values.
//   2. Clay/flare is the user and steel is the counterpart, everywhere —
//      the same rule the room and the debrief follow. On this page it is
//      carried by shape as well as colour: an utterance has a squared corner
//      where its tail would be, left for you and right for them.
//
// The page is six movements and the shared footer, ordered so the two things
// actually sell the product come first:
//
//   1 Hero        the asymmetry, stated — and the console, playable, beside it.
//                 A visitor can run a turn of the product before scrolling.
//   2 The room    the REAL rehearsal screen, drawn in the room's own register
//                 with the room's own classes, so what a visitor sees here is
//                 what they get. The brief is legible, the mandate is redacted,
//                 and the asymmetry is annotated rather than explained.
//   3 The debrief two takes on one moment, then the mandate unsealed.
//   4 Counterparts who they might put on the call.
//   5 The index   the deals, as a ruled list.
//   6 Close       the way in.
//
// A "how it works" section was cut because the console, the room and the takes
// already are how it works. The stakes section was folded into the hero and the
// room: its headline was the best line on the page and was three screens down.

const FREE_REHEARSALS = PLAN_FEATURES.free.monthlyRehearsals

/** Custom properties in a style object, without scattering casts everywhere. */
const v = (props: Record<string, string | number>) => props as CSSProperties

// ── The playable moment ─────────────────────────────────────────────────────

// Three real replies to the counterpart's real opening line, each with the
// answer it actually provokes and what it costs. This is the product reduced to
// one click: a visitor who picks a line has understood Parley better than any
// amount of feature copy would have managed.

type Delta = { id: DimensionId; n: number }

type Move = {
  id: string
  key: string
  /** What the visitor says. */
  text: string
  /** A silence, when the counterpart's move is to not speak. */
  beat?: string
  /** What comes back. */
  reply: string
  verdict: ReactNode
  deltas: Delta[]
  clock: string
}

const MOVES: Move[] = [
  {
    id: 'soft',
    key: 'A',
    text: 'Twenty-two will not fly, but there is probably a version that works.',
    reply: 'Good. What number did you have in mind?',
    verdict: (
      <>
        You agreed there is a number before finding out whether the twenty-two
        was ever real. From here you are <b>bidding against yourself</b>, and
        the half hour goes on how high you will go rather than how low they can.
      </>
    ),
    deltas: [
      { id: 'concession', n: -18 },
      { id: 'anchoring', n: -11 },
    ],
    clock: '11:02',
  },
  {
    id: 'anchor',
    key: 'B',
    text: 'Eight per cent. One year. Same scope.',
    beat: 'Nine seconds. They write something down.',
    reply: 'That is a long way from where we are.',
    verdict: (
      <>
        The anchor held, and you let the silence run. Nine seconds of nothing is
        the cheapest question you have, and <b>this time they filled it</b>.
      </>
    ),
    deltas: [
      { id: 'anchoring', n: 21 },
      { id: 'composure', n: 16 },
    ],
    clock: '10:47',
  },
  {
    id: 'ask',
    key: 'C',
    text: 'Before the number — who else has already taken the twenty-two?',
    reply: '…I would have to check what I am able to share there.',
    verdict: (
      <>
        It is going out across the base, they said. That hesitation says it is
        not, and it is <b>the first true thing you know about their mandate</b>
        {' '}— bought for the price of one question.
      </>
    ),
    deltas: [
      { id: 'discovery', n: 24 },
      { id: 'anchoring', n: 4 },
    ],
    clock: '11:19',
  },
]

// ── The two takes ───────────────────────────────────────────────────────────

const TAKE_ONE = [58, 21, 34, 27, 40]
const TAKE_TWO = [71, 64, 78, 80, 55]
const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)

// ── Hooks ───────────────────────────────────────────────────────────────────

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * The motion preference, read as the external store it is — the same shape Nav
 * uses for sign-in state. The server snapshot is a plain `false` so hydration
 * has something to agree with, and a change to the OS setting takes effect
 * without a reload.
 */
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false
  )
}

/**
 * Where a section is in its entrance.
 *
 *   'rest'  — nothing has armed it. This is what the server renders, and what
 *             a browser whose JS never arrives keeps: no reveal styles apply
 *             at all, so the section is simply visible.
 *   'armed' — JS is running, the observer exists, and the section is off
 *             screen. The entrance's START state applies.
 *   'in'    — it has arrived, and rides in.
 *
 * THE RULE THIS ENCODES: content is never gated on an animation running. The
 * page used to hold every revealable element at `opacity: 0` by default and
 * depend on this hook to clear it, so the server-rendered markup was 32 hidden
 * elements and nothing else — a landing page that is blank until React
 * hydrates and an IntersectionObserver fires. Anything that broke either step
 * left it blank permanently. Now the hidden state is something JS opts INTO,
 * which it can only do once it is in a position to opt back out.
 */
type RevealPhase = 'rest' | 'armed' | 'in'

/**
 * Marks a section the first time it reaches the viewport. Everything that moves
 * on this page is an entrance, and an entrance should happen when you arrive at
 * it and never replay.
 */
function useInView<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T | null>(null)
  const [phase, setPhase] = useState<RevealPhase>('rest')

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Everything is decided inside the callback, which matters twice over.
    //
    // `observe()` queues an initial notification for every element, so the
    // first call tells us where the section already is: on screen goes
    // straight to 'in', and only an off-screen one is ever armed. An
    // above-the-fold section therefore never wears the start state, so there
    // is no flash of visible-then-hidden content while the page settles.
    //
    // And nothing outside this callback arms anything. If the constructor
    // below throws — no IntersectionObserver, a hardened environment, a
    // polyfill that failed — the phase stays 'rest', which is the visible
    // state. A section can only be hidden by the same code that is in a
    // position to show it again.
    try {
      const observer = new IntersectionObserver(
        entries => {
          if (entries.some(e => e.isIntersecting)) {
            setPhase('in')
            observer.disconnect()
          } else {
            setPhase('armed')
          }
        },
        { threshold, rootMargin: '0px 0px -6% 0px' }
      )
      observer.observe(el)
      return () => observer.disconnect()
    } catch {
      // Left at 'rest'. No entrance, and nothing hidden.
    }
  }, [threshold])

  return [ref, phase] as const
}

/**
 * The `data-in` a section carries, which is the only thing the reveal CSS
 * reads. Absent means "resting, visible" — which is what the server renders
 * and what reduced motion gets, since for both of them the entrance is not
 * something that is going to happen.
 */
function revealAttr(phase: RevealPhase, reduced: boolean): 'armed' | 'true' | undefined {
  if (reduced || phase === 'rest') return undefined
  return phase === 'armed' ? 'armed' : 'true'
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/**
 * Where the conversation sits in its expected length — the room's own
 * instrument, drawn in the landing's register.
 *
 * It replaced a "Their leverage" meter that moved when a line was picked. That
 * meter was the single thing on this page the product refuses to build: a live
 * readout of how you are doing, in the room's own chrome, two sections above
 * this page's own promise that nothing on the screen will tell you that. See
 * the note at the top of RoomClient — the strip is not an exception to that
 * rule, because it reports how much of the expected length is gone and says
 * nothing about the person.
 *
 * One exchange does not move it, which is the point. `phaseOf` puts the first
 * third of a fourteen-minute scenario in the opening, and every clock this
 * console can reach is inside it.
 */
function Phase() {
  return (
    <span className="pl-lp-phase">
      <span className="pl-lp-phase__cells" aria-hidden="true">
        {[1, 2, 3].map(n => (
          <span key={n} className="pl-lp-phase__cell" data-on={n === 1 ? 'true' : undefined} />
        ))}
      </span>
      <span>Opening</span>
    </span>
  )
}

/**
 * The console.
 *
 * A working slice of the product rather than a picture of one. The counterpart
 * opens with the scenario's own opening line, the visitor picks a reply, and
 * the answer, the leverage and the debrief all move accordingly — which is the
 * loop the product runs, at the smallest size it still makes sense.
 */
function Console({ reduced, scenario }: { reduced: boolean; scenario: LandingScenario }) {
  const [ref, phase] = useInView<HTMLDivElement>(0.1)
  const [chosen, setChosen] = useState<Move | null>(null)
  const verdictRef = useRef<HTMLDivElement>(null)

  // Focus management across the option ⇄ verdict swap.
  //
  // Activating an option unmounts the button that was activated, so focus fell
  // to <body> and a keyboard user had to tab from the top of the document
  // again. Each side of the swap already contains exactly one control, so there
  // is somewhere sensible to put focus without adding any markup: the verdict's
  // "Try a different line", and the first of the three replies coming back.
  const againRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)

  // Whether the swap that is about to happen was driven from the keyboard.
  //
  // A click from Enter or Space on a native button carries detail 0; a real
  // pointer click carries 1 or more. Reading it in the handler is the smallest
  // way to tell them apart, and it keeps the decision local to the event that
  // caused the change rather than making the component track input modality.
  // Moving focus is right for a keyboard user and wrong for a mouse user, who
  // did not have focus in the console to begin with.
  const viaKeyboardRef = useRef(false)

  // Picking a line makes the console taller — it gains your turn, sometimes a
  // silence, and their answer — which pushes the verdict under the fold on a
  // laptop. Reserving the height up front would be worse: it puts the three
  // replies below the fold before anything has been clicked, which is the
  // problem this hero was rebuilt to fix.
  //
  // So the result is brought to the reader instead. `block: 'nearest'` scrolls
  // the minimum distance that makes the verdict visible and does nothing at all
  // when it already is, so this never fires on a tall window and never yanks
  // the page — and it is skipped entirely on reset, which is a return to a
  // state the reader can already see.
  useEffect(() => {
    if (!chosen) return
    verdictRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [chosen, reduced])

  // Runs after the scroll effect above, and only when the flag says a keyboard
  // put us here — which is also what keeps it off the first render, since
  // nothing but a handler ever sets it. A page that took focus on load would be
  // a worse bug than the one this fixes.
  //
  // preventScroll, because the effect above is already moving the page and the
  // control being focused is inside what it is bringing into view; letting
  // focus scroll as well would fight a smooth scroll with an instant one.
  useEffect(() => {
    if (!viaKeyboardRef.current) return
    viaKeyboardRef.current = false
    const next = chosen ? againRef.current : firstOptionRef.current
    next?.focus({ preventScroll: true })
  }, [chosen])

  return (
    <div className="pl-lp-console" ref={ref} data-in={revealAttr(phase, reduced)}>
      <div className="pl-lp-console__bar">
        <span className="pl-lp-console__dot" aria-hidden="true" />
        <span>{scenario.title}</span>
        <span className="pl-lp-console__reads">
          <Phase />
          <span className="pl-lp-console__clock">{chosen ? chosen.clock : '11:34'}</span>
        </span>
      </div>

      <div className="pl-lp-console__body">
        {/* Without the objective the three replies below are a personality
            quiz. With it they are three ways to chase a stated goal. */}
        <p className="pl-lp-console__brief">
          <span>Your objective</span>
          {scenario.objective}
        </p>

        <div className="pl-lp-say pl-lp-say--them" data-reveal>
          <span className="pl-lp-who">{scenario.counterpartRole}</span>
          <p className="pl-lp-said">{scenario.opening}</p>
        </div>

        {chosen && (
          <>
            <div className="pl-lp-say pl-lp-say--you pl-lp-rise">
              <span className="pl-lp-who">You</span>
              <p className="pl-lp-said">{chosen.text}</p>
            </div>

            {chosen.beat && (
              <div className="pl-lp-say pl-lp-say--beat pl-lp-rise">
                <p className="pl-lp-said">[ {chosen.beat} ]</p>
              </div>
            )}

            <div className="pl-lp-say pl-lp-say--them pl-lp-rise">
              <span className="pl-lp-who">{scenario.counterpartRole}</span>
              <p className="pl-lp-said">{chosen.reply}</p>
            </div>
          </>
        )}
      </div>

      <div className="pl-lp-choice">
        {!chosen ? (
          <>
            <p className="pl-lp-choice__label" id="pl-lp-your-move">
              Your move. Pick a line
            </p>
            <div className="pl-lp-choice__opts" aria-labelledby="pl-lp-your-move">
              {MOVES.map((move, i) => (
                <button
                  key={move.id}
                  type="button"
                  className="pl-lp-opt"
                  ref={i === 0 ? firstOptionRef : undefined}
                  onClick={e => {
                    viaKeyboardRef.current = e.detail === 0
                    setChosen(move)
                  }}
                >
                  <span className="pl-lp-opt__key" aria-hidden="true">
                    {move.key}
                  </span>
                  <span>{move.text}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="pl-lp-verdict pl-lp-rise" ref={verdictRef}>
            <p className="pl-lp-choice__label">What that cost you</p>
            <p className="pl-lp-verdict__line">{chosen.verdict}</p>
            <div className="pl-lp-deltas">
              {chosen.deltas.map(delta => (
                <span
                  key={delta.id}
                  className={`pl-lp-delta pl-lp-delta--${delta.n > 0 ? 'up' : 'down'}`}
                >
                  {DIMENSION_BY_ID[delta.id].label}
                  <b>
                    {delta.n > 0 ? '+' : '−'}
                    {Math.abs(delta.n)}
                  </b>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="pl-lp-again"
              ref={againRef}
              onClick={e => {
                viaKeyboardRef.current = e.detail === 0
                setChosen(null)
              }}
            >
              Try a different line
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── The room, as it actually is ─────────────────────────────────────────────

// A faithful still of the rehearsal screen, assembled from the product's own
// parts: the .pl-room scope supplies the register's tokens, .pl-say draws the
// two voices with the same colour and typeface rule the live transcript uses,
// and the sealed block is the very same <Redacted> component the room and the
// debrief mount. Nothing here is a picture of the product — it is the product's
// CSS, with static content in it, which is why it cannot drift out of date the
// way a screenshot would.
//
// The turns: the counterpart's opening is the scenario's real one, read from
// lib/negotiation. The two user lines and the reply after them are written for
// this still — they are the same exchange the console plays, so a visitor who
// clicked C in the hero sees where that line leads.

const roomTurns = (opening: string): { side: 'you' | 'them'; text: string }[] => [
  { side: 'them', text: opening },
  { side: 'you', text: 'Before we get to the number — who else has already taken the twenty-two?' },
  {
    side: 'them',
    text: '…I would have to check what I am able to share there. It is not something I can put in writing.',
  },
  { side: 'you', text: 'Eight per cent. One year. Same scope.' },
]

function Room({ scenario }: { scenario: LandingScenario }) {
  const turns = roomTurns(scenario.opening)
  return (
    <div className="pl-lp-roomshot" data-reveal style={v({ '--d': '180ms' })}>
      {/* The two brackets. They label the columns rather than decorating them,
          and they say what each column is FOR: the left is everything you walk
          in holding, including the black block that says what you are not
          holding; the right is the only place the block can be opened. Naming
          them that way is the difference between a visitor seeing a chat window
          with a sidebar and a visitor seeing the mechanic. */}
      <div className="pl-lp-roomshot__tags">
        <span className="pl-lp-roomtag pl-lp-roomtag--you">
          Your brief — and what it will not tell you
        </span>
        <span className="pl-lp-roomtag pl-lp-roomtag--them">
          Fourteen minutes to get it out of them
        </span>
      </div>

      <div className="pl-room pl-lp-roomshot__frame">
        <div className="pl-lp-roomshot__bar">
          <span className="pl-lp-roomshot__live" aria-hidden="true" />
          <span className="pl-lp-roomshot__who">The Closer</span>
          <span className="pl-lp-roomshot__scen">{scenario.title}</span>
          <span className="pl-lp-roomshot__clock">
            <b>06:14</b> of {scenario.estimatedMinutes}m
          </span>
        </div>

        <div className="pl-lp-roomshot__body">
          {/* Your side. Legible, and pinned there for the whole rehearsal —
              abandoning your own stated constraints under pressure is the
              failure the debrief is built to catch. */}
          <aside className="pl-lp-roomshot__brief">
            <h3 className="pl-stamp pl-stamp--clay">Your objective</h3>
            <p className="pl-lp-roomshot__obj">{scenario.objective}</p>

            <h3 className="pl-stamp">Your constraints</h3>
            <ul className="pl-lp-roomshot__list">
              {scenario.constraints.slice(0, 3).map((c, i) => (
                <li key={i}>
                  <span className="pl-index" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>

            {/* Their side, stated as an object rather than as a sentence. The
                block draws no text at any point — see app/components/Redacted. */}
            <div className="pl-lp-roomshot__sealed">
              <span className="pl-tab pl-tab--steel">Across the table</span>
              <p className="pl-lp-roomshot__role">{scenario.counterpartRole}</p>
              <h3 className="pl-stamp pl-stamp--steel">What they are working from</h3>
              <Redacted lines={4} label="Their mandate is sealed until the rehearsal ends." />
              <p className="pl-lp-roomshot__note">
                Their discount authority, the ladder above them, and the one
                thing they will never concede. Everything in it can be found by
                asking the right question.
              </p>
            </div>
          </aside>

          <div className="pl-lp-roomshot__thread">
            {turns.map((turn, i) => (
              <div key={i} className={`pl-say pl-say--${turn.side}`}>
                <div className="pl-say__who">{turn.side === 'you' ? 'You' : 'The Closer'}</div>
                <div className="pl-say__text">{turn.text}</div>
              </div>
            ))}

            <div className="pl-lp-roomshot__composer">
              <div className="pl-lp-roomshot__composer-who">You</div>
              <p className="pl-lp-roomshot__composer-field">Say it the way you would say it.</p>
              <p className="pl-lp-roomshot__composer-foot">
                <span>
                  <kbd className="pl-kbd">Ctrl</kbd> <kbd className="pl-kbd">Enter</kbd> to send.
                  No edits, no take-backs.
                </span>
                <span className="pl-lp-roomshot__turns">2 turns</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* One line, because the still above has already said it. */}
      <p className="pl-lp-roomshot__cap">
        No score ticking up. No hints. No &ldquo;good question!&rdquo;. The
        feedback comes when it is over — which is the only place feedback exists
        on the day.
      </p>
    </div>
  )
}

function Take({
  variant,
  tag,
  said,
  why,
  scores,
}: {
  variant: 'one' | 'two'
  tag: string
  said: string
  why: string
  scores: number[]
}) {
  return (
    <div className={`pl-lp-take pl-lp-take--${variant}`} data-reveal>
      <p className="pl-lp-take__tag">{tag}</p>
      <p className="pl-lp-take__score">{mean(scores)}</p>
      <p className="pl-lp-take__said">&ldquo;{said}&rdquo;</p>
      <ul className="pl-lp-bars">
        {DIMENSIONS.map((dimension, i) => (
          <li key={dimension.id}>
            <span>{dimension.label}</span>
            <span className="pl-lp-track">
              <i style={v({ '--w': `${scores[i]}%`, '--i': i })} />
            </span>
            <span className="pl-lp-n" aria-hidden="true">
              {scores[i]}
            </span>
            <span className="pl-sr-only">
              {dimension.label}: {scores[i]} out of 100
            </span>
          </li>
        ))}
      </ul>
      <p className="pl-lp-take__why">{why}</p>
    </div>
  )
}

// ── The page ────────────────────────────────────────────────────────────────

export default function LandingClient({
  hero,
  scenarios,
}: {
  hero: LandingScenario
  scenarios: CatalogueScenario[]
}) {
  const reduced = useReducedMotion()
  const userId = useUserId()
  const room = useOpenRoom(userId)

  const [heroRef, heroIn] = useInView<HTMLElement>(0.05)
  const [roomRef, roomIn] = useInView<HTMLElement>()
  const [debriefRef, debriefIn] = useInView<HTMLElement>()
  const [castRef, castIn] = useInView<HTMLElement>()
  const [indexRef, indexIn] = useInView<HTMLElement>()
  const [closeRef, closeIn] = useInView<HTMLElement>()

  const on = (phase: RevealPhase) => revealAttr(phase, reduced)

  return (
    <>
      <Nav variant="marketing" />

      <main className="pl-lp">
        {/* ── 1 · Hero ─────────────────────────────────────────────────── */}
        {/* The asymmetry is the product, so it is the headline — it used to be
            three screens down, where most visitors never reached it. Beside it
            is the console rather than a still life of one: the fastest possible
            route to understanding this product is to take one turn in it, and
            that should not cost a scroll. */}
        <header className="pl-lp-hero" ref={heroRef} data-in={on(heroIn)}>
          <div className="pl-lp-frame pl-lp-hero__grid">
            <div className="pl-lp-hero__say">
              <p className="pl-lp-mark" data-reveal>
                AI negotiation rehearsal
              </p>

              <h1 className="pl-lp-hero__h1" data-reveal style={v({ '--d': '70ms' })}>
                They have rehearsed this conversation.{' '}
                <span className="pl-lp-hero__turn">
                  You have <span className="pl-lp-hl">read the contract</span>.
                </span>
              </h1>

              <p
                className="pl-lp-lede pl-lp-hero__lede"
                data-reveal
                style={v({ '--d': '140ms' })}
              >
                The rep on your renewal call runs that deal a couple of hundred
                times a year. You run it twice. Parley is where you run the other
                hundred and ninety-eight — against an AI counterpart holding the
                discount authority, the deal desk and the quarter-end clock you
                are not allowed to see.
              </p>

              <div className="pl-lp-hero__cta" data-reveal style={v({ '--d': '200ms' })}>
                {/* One click to a real rehearsal: the flagship deal against the
                    default counterpart, as a guest. It used to take four —
                    library, brief, counterpart, room — before a visitor heard
                    the counterpart speak. Choosing a deal is still one link
                    away, below. */}
                <button
                  type="button"
                  className="pl-lp-btn"
                  onClick={() => room.open(hero.slug, BUILT_IN_COUNTERPARTS[0].id)}
                  disabled={room.starting}
                  aria-busy={room.starting}
                >
                  {room.starting ? 'Opening the room…' : 'Start a live rehearsal'}
                </button>
                {/* The arrow points at the console, which is beside this on a
                    desktop and below it on a phone — so the glyph is drawn in
                    CSS and turns with the layout rather than lying at one of
                    the two widths. */}
                <span className="pl-lp-textnote">Or take a turn, right here</span>
              </div>

              {room.error && (
                <p role="alert" className="pl-lp-hero__error">
                  {room.error}
                </p>
              )}

              <p className="pl-lp-fine" data-reveal style={v({ '--d': '250ms' })}>
                {FREE_REHEARSALS} rehearsals a month, free. No signup, no card.
              </p>
              <p className="pl-lp-hero__more" data-reveal style={v({ '--d': '280ms' })}>
                <Link href="/library" className="pl-lp-hero__morelink">
                  Or pick your own deal from all {scenarios.length}
                </Link>
              </p>
            </div>

            {/* The console. A working slice of the product, in the first
                screenful, because one click on it explains Parley better than
                the rest of this page put together. */}
            <div className="pl-lp-hero__console" data-reveal style={v({ '--d': '300ms' })}>
              <Console reduced={reduced} scenario={hero} />
            </div>
          </div>
        </header>

        {/* ── 2 · The room ─────────────────────────────────────────────── */}
        {/* The actual rehearsal screen, not an impression of one. It is drawn
            inside .pl-room with the product's own atoms — .pl-say, .pl-stamp,
            .pl-index and the same <Redacted> component the live room and the
            debrief mount — so a visitor is looking at the real thing rather
            than at marketing art of it. The two brackets over the columns are
            the only addition: the asymmetry is the product, and a stranger
            should not have to infer it from a layout. */}
        <section
          className="pl-lp-field"
          id="room"
          ref={roomRef}
          data-in={on(roomIn)}
          aria-labelledby="pl-lp-room-h"
        >
          <div className="pl-lp-frame">
            <div className="pl-lp-room__head">
              <div>
                <p className="pl-lp-mark" data-reveal>
                  The room
                </p>
                <h2 className="pl-lp-huge" id="pl-lp-room-h" data-reveal style={v({ '--d': '70ms' })}>
                  Fourteen minutes. No coaching.
                </h2>
              </div>
              <p className="pl-lp-lede" data-reveal style={v({ '--d': '140ms' })}>
                Reading the contract is not practice. Practice is saying the
                number out loud to somebody whose job is to say no, and finding
                out what happens in the four seconds afterwards. Nothing on this
                screen tells you how you are doing, because nothing will on the
                day.
              </p>
            </div>

            <Room scenario={hero} />
          </div>
        </section>

        {/* ── 3 · The debrief ──────────────────────────────────────────── */}
        <section
          className="pl-lp-field pl-lp-field--blush"
          ref={debriefRef}
          data-in={on(debriefIn)}
          aria-labelledby="pl-lp-debrief-h"
        >
          <div className="pl-lp-frame">
            <div className="pl-lp-head">
              <p className="pl-lp-mark pl-lp-mark--citron" data-reveal>
                The debrief
              </p>
              <h2 className="pl-lp-big" id="pl-lp-debrief-h" data-reveal style={v({ '--d': '70ms' })}>
                Same renewal. Two attempts.
              </h2>
              <p className="pl-lp-lede" data-reveal style={v({ '--d': '130ms' })}>
                Every rehearsal is scored on five things you can actually change.
                Here is one moment, played twice.
              </p>
            </div>

            <div className="pl-lp-takes">
              <Take
                variant="one"
                tag="Take one"
                said="— though obviously there is a conversation to have about where that lands."
                why="You moved before they did, and they moved nothing. Eight per cent is now your ceiling rather than your ask, and every remaining minute is subtraction."
                scores={TAKE_ONE}
              />

              {/* Straddles both cards, so the comparison reads as one object
                  rather than two unrelated boxes. Its entrance is its own —
                  see .pl-lp-jump — because the shared reveal would discard the
                  translate that centres it. */}
              <p className="pl-lp-jump">
                One line different <b>+{mean(TAKE_TWO) - mean(TAKE_ONE)}</b>
              </p>

              <Take
                variant="two"
                tag="Take two"
                said="Who else has already taken the twenty-two?"
                why="They could not answer it. That hesitation is the first true thing you know about what they are actually authorised to do, and it cost you nothing."
                scores={TAKE_TWO}
              />
            </div>

            {/* The reveal. The one thing no other tool in the category does:
                when the rehearsal ends, the mandate the counterpart was working
                from is unsealed. The line here is an illustration of the
                moment, not a real scenario's mandate — those stay server-side
                until a rehearsal has ended. */}
            <div className="pl-lp-reveal">
              <div className="pl-lp-reveal__note" data-reveal style={v({ '--d': '120ms' })}>
                <p className="pl-lp-mark pl-lp-mark--citron">When it ends</p>
                <h3 className="pl-lp-reveal__h">Their mandate, unsealed.</h3>
                <p className="pl-lp-reveal__p">
                  A 36 reads differently once you know what they were holding
                  the whole time. Every debrief opens with that, before any
                  score.
                </p>
              </div>
              {/* The two bars under the line used to be decoration — the
                  shape of redaction, holding nothing. They are the ledger now,
                  which is the actual output: the mandate is authored as a
                  closed list of what was on the table, and the debrief reports
                  which of it came out and what the rest would have taken. The
                  rows are an illustration of that shape, not a real scenario's
                  levers; those stay server-side until a rehearsal has ended. */}
              <div className="pl-lp-file" data-reveal style={v({ '--d': '220ms' })}>
                <div className="pl-lp-file__top">
                  <span className="pl-lp-file__tag">What they were holding</span>
                  <span className="pl-lp-file__score">
                    <b>2</b> of 5
                  </span>
                </div>
                <p className="pl-lp-file__line">
                  <mark>They had nine per cent in their pocket from the start.</mark>
                </p>
                <ul className="pl-lp-file__list">
                  <li className="pl-lp-file__row" data-found="true">
                    <span className="pl-lp-file__mark" aria-hidden="true" />
                    <span>
                      <span className="pl-sr-only">Found: </span>
                      Their quarter closes before yours does
                    </span>
                  </li>
                  <li className="pl-lp-file__row" data-free="true">
                    <span className="pl-lp-file__mark" aria-hidden="true" />
                    <span>
                      <span className="pl-sr-only">Missed: </span>
                      A flat renewal, in exchange for a reference call
                      <em className="pl-lp-file__miss">
                        Cost them nothing. You never asked what was available
                        other than price.
                      </em>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4 · Counterparts ─────────────────────────────────────────── */}
        <section
          className="pl-lp-field pl-lp-field--deep"
          ref={castRef}
          data-in={on(castIn)}
          aria-labelledby="pl-lp-cast-h"
        >
          <div className="pl-lp-frame">
            <div className="pl-lp-head">
              <p className="pl-lp-mark pl-lp-mark--steel" data-reveal>
                Who you face
              </p>
              <h2 className="pl-lp-huge" id="pl-lp-cast-h" data-reveal style={v({ '--d': '70ms' })}>
                Five people they might put on the call.
              </h2>
              <p className="pl-lp-lede" data-reveal style={v({ '--d': '130ms' })}>
                Each one breaks a different part of your game, and you do not get
                to pick. Run the same renewal against a second one and the
                second rehearsal is where it starts to stick. Listed with every
                name is their tell.
              </p>
            </div>

            <div className="pl-lp-cast">
              {BUILT_IN_COUNTERPARTS.map((counterpart, i) => (
                <article
                  key={counterpart.id}
                  className="pl-lp-face"
                  data-reveal
                  style={v({ '--d': `${i * 70}ms` })}
                >
                  <div className="pl-lp-face__top">
                    <span className="pl-lp-face__n">0{i + 1}</span>
                    <h3 className="pl-lp-face__name">{counterpart.name}</h3>
                  </div>
                  <p className="pl-lp-face__role">{counterpart.role}</p>
                  <p className="pl-lp-face__tell">{counterpart.tell}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── 5 · The index ────────────────────────────────────────────── */}
        <section
          className="pl-lp-field"
          ref={indexRef}
          data-in={on(indexIn)}
          aria-labelledby="pl-lp-index-h"
        >
          <div className="pl-lp-frame">
            <div className="pl-lp-head">
              <p className="pl-lp-mark" data-reveal>
                The library
              </p>
              <h2 className="pl-lp-big" id="pl-lp-index-h" data-reveal style={v({ '--d': '70ms' })}>
                Start from the deal you are actually in.
              </h2>
              <p className="pl-lp-lede" data-reveal style={v({ '--d': '130ms' })}>
                Every one of them holds a discount authority you are not shown.
              </p>
            </div>

            {/* A ruled index rather than a shelf of cards: six entries, each a
                deal the visitor either recognises or does not, and the
                recognition is the whole job of the section. */}
            <ul className="pl-lp-index" data-reveal style={v({ '--d': '180ms' })}>
              {scenarios.map((scenario, i) => (
                <li key={scenario.slug}>
                  <Link href={`/library/${scenario.slug}`} className="pl-lp-entry">
                    <span className="pl-lp-entry__n" aria-hidden="true">
                      0{i + 1}
                    </span>
                    <span className="pl-lp-entry__cat">{scenario.categoryLabel}</span>
                    <span className="pl-lp-entry__t">{scenario.title}</span>
                    <span className="pl-lp-entry__p">{scenario.premise}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 6 · Close ────────────────────────────────────────────────── */}
        <section
          className="pl-lp-field pl-lp-field--flare pl-lp-close"
          ref={closeRef}
          data-in={on(closeIn)}
          aria-labelledby="pl-lp-close-h"
        >
          <div className="pl-lp-frame pl-lp-close__in">
            <h2 className="pl-lp-mega pl-lp-close__h" id="pl-lp-close-h" data-reveal>
              Have it here first.
            </h2>
            <div className="pl-lp-close__side" data-reveal style={v({ '--d': '120ms' })}>
              <p className="pl-lp-close__p">
                Pick the renewal that is coming, pick who they are likely to put
                on the call, and get it wrong somewhere it does not cost you
                anything.
              </p>
              {/* The same destination as the hero and the nav. Three CTAs
                  pointing at two different doors is the cheapest conversion
                  leak a page can have, and the deal index is the door that
                  reaches a rehearsal in two clicks rather than five. */}
              <Link href="/library" className="pl-lp-btn pl-lp-btn--ink">
                Start a rehearsal
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* The same footer every other page carries.
          This used to be a bespoke signature — the wordmark and two links —
          on the reasoning that the landing had just made its argument and
          needed nothing else. In practice it meant the one page a stranger
          actually arrives on was the one page with no way into the library,
          the pricing, the FAQ or support, and the product had two footers to
          keep in step. Everything the signature carried is in this one. */}
      <Footer />
    </>
  )
}
