'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import Redacted from '@/app/components/Redacted'
import { BUILT_IN_COUNTERPARTS } from '@/lib/negotiation/counterparts'
import { useUserId } from '@/lib/hooks/useUserId'
import { useOpenRoom } from '@/lib/hooks/useOpenRoom'
import type { Counterpart } from '@/lib/negotiation/types'

// The brief: the last screen before the room.
//
// It exists to do one thing the old "start a chat" flow never did — make the
// user commit to an objective before the pressure starts. Reading your own
// constraints on a calm screen and then discovering you abandoned them under
// pressure is the lesson; without this page the debrief has nothing to hold
// them to.
//
// It ends on the door. The last block of the page is drawn in the room's own
// register — the only dark object on any paper surface — and pressing the
// button closes it over the viewport before the room arrives, so entering
// reads as crossing into a place rather than as a page changing.
//
// Styling lives in the .pl-brief__* and .pl-door blocks in app/globals.css
// rather than in this file. It used to be ~200 lines of inline style objects,
// which is how a screen this important drifted out of the product's visual
// language while still working perfectly.

/** The door takes this long to close. Mirrors --pl-stage. */
const STAGE_MS = 560

interface ScenarioBrief {
  slug: string
  title: string
  premise: string
  situation: string
  objective: string
  constraints: string[]
  counterpartRole: string
  estimatedMinutes: number
  /** How many things are on their side of the table. Never which. */
  leverCount: number
  categoryLabel: string
  difficultyLabel: string
}

export default function BriefClient({ scenario }: { scenario: ScenarioBrief }) {
  const userId = useUserId()
  const [custom, setCustom] = useState<Counterpart[]>([])
  const [selected, setSelected] = useState(BUILT_IN_COUNTERPARTS[0].id)
  const { open, starting, error } = useOpenRoom(userId)
  const [priorAttempts, setPriorAttempts] = useState(0)

  useEffect(() => {
    // useUserId is empty during SSR and the first paint; both fetches below
    // are per-user, so there is nothing worth asking for until it resolves.
    if (!userId) return
    const uid = userId

    fetch(`/api/counterparts?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.custom) setCustom(d.custom) })
      .catch(() => {})

    // Showing the attempt count turns a repeat into a deliberate act rather
    // than an accident, and repeating a scenario is the behaviour the product
    // most wants to encourage.
    fetch(`/api/rehearsal/session?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.rehearsals) return
        setPriorAttempts(
          d.rehearsals.filter((r: { scenarioSlug: string }) => r.scenarioSlug === scenario.slug).length
        )
      })
      .catch(() => {})
  }, [scenario.slug, userId])

  const all: Counterpart[] = [...BUILT_IN_COUNTERPARTS, ...custom]
  const chosen = all.find(c => c.id === selected) ?? BUILT_IN_COUNTERPARTS[0]

  // The door starts closing on the press, not on the response: the room is
  // being opened on the server while it closes, and the two finish together.
  // A refusal — quota, a bad request — opens it again and says why. The move
  // into the room is a client-side transition so the dark of the door runs
  // straight into the dark of the room with no page load between them.
  function start() {
    open(scenario.slug, selected, STAGE_MS)
  }

  return (
    <>
      <Nav activePath="/library" />
      <main className="pl-container pl-container--narrow pl-page" style={{ maxWidth: 860 }}>
        <p style={{ paddingTop: 32, margin: 0 }}>
          <Link href="/library" className="pl-tap pl-link" style={{ fontSize: 13 }}>
            Back to the library
          </Link>
        </p>

        <div className="pl-brief__meta">
          <span className="pl-brief__cat">{scenario.categoryLabel}</span>
          <span className="pl-brief__diff">{scenario.difficultyLabel}</span>
          <span className="pl-num pl-brief__time">~{scenario.estimatedMinutes} min</span>
        </div>

        <h1 className="pl-brief__title">{scenario.title}</h1>

        {priorAttempts > 0 && (
          <div className="pl-brief__again">
            You have run this {priorAttempts === 1 ? 'once' : `${priorAttempts} times`} before.
            Try a different counterpart — the same deal against someone else is a
            different call, and on the real one you do not get to pick.
          </div>
        )}

        <Section title="The situation">
          <p className="pl-brief__situation">{scenario.situation}</p>
        </Section>

        <div className="pl-brief__cols">
          <div className="pl-brief__win">
            <h2 className="pl-stamp pl-stamp--clay">What a win looks like</h2>
            <p>{scenario.objective}</p>
          </div>

          <div className="pl-brief__limits">
            <h2 className="pl-stamp">What you cannot do</h2>
            <ul className="pl-brief__list">
              {scenario.constraints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* The mechanic, stated as plainly as it can be stated. A user who does
            not understand that the mandate is hidden reads their own debrief as
            an accusation rather than as a finding. */}
        <div className="pl-brief__sealed">
          <h2 className="pl-stamp pl-stamp--steel">What you are not told</h2>
          <p>
            {scenario.counterpartRole} is working from a mandate — a discount
            they are authorised to approve, an approval ladder above them, a
            quarter of their own, and something they will never concede. You do
            not see it until the debrief. Asking is how you find it.
          </p>
          {/* The count, and only the count.
              A black rectangle is a mood; a number is a target. This is the
              same denominator the debrief settles against, stated at the other
              end of the rehearsal — and knowing there are five discloses none
              of them, while a buyer who keeps asking until they have five is
              doing the exact thing this is meant to teach. */}
          {scenario.leverCount > 0 && (
            <p className="pl-brief__sealed-count">
              <strong>{scenario.leverCount} things are on their side of this table.</strong>{' '}
              The debrief will tell you how many of them you got out, and what the
              ones you missed would have taken.
            </p>
          )}
        </div>

        <Section title="Who they put on the call">
          <div className="pl-brief__cast">
            {all.map(c => (
              <button
                key={c.id}
                type="button"
                className="pl-brief__who"
                aria-pressed={c.id === selected}
                onClick={() => setSelected(c.id)}
              >
                <span className="pl-brief__who-name">
                  {c.name}
                  {!c.builtIn && <span className="pl-brief__who-mine">Yours</span>}
                </span>
                <span className="pl-brief__who-role">{c.role}</span>
                <span className="pl-brief__who-note">{c.disposition}</span>
              </button>
            ))}
          </div>

          {chosen.tactics.length > 0 && (
            <div className="pl-brief__expect">
              <h3 className="pl-stamp">Expect {chosen.name} to</h3>
              <ul className="pl-brief__list">
                {chosen.tactics.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {error && (
          <div role="alert" className="pl-room-notice pl-room-notice--error" style={{ marginBottom: 18 }}>
            {error}{' '}
            {error.includes('Upgrade') && (
              <Link href="/pricing" className="pl-link" style={{ fontWeight: 500 }}>
                See plans
              </Link>
            )}
          </div>
        )}

        {/* The door. The one dark object on a paper page, drawn in the room's
            register so the last thing on the brief is a piece of where you are
            about to go. The sealed block on it is the same one that waits
            inside: what they are working from, and what you are walking in
            not knowing. */}
        <section className="pl-room pl-door" aria-labelledby="pl-door-h">
          <div className="pl-door__in">
            <p className="pl-stamp pl-stamp--steel">The room</p>
            <h2 className="pl-door__title" id="pl-door-h">
              Enter with {chosen.name}.
            </h2>
            <p className="pl-door__note">
              They speak first. The clock starts immediately, and nothing on
              screen tells you how you are doing — because nothing will on the
              day.
            </p>
            <div className="pl-door__go">
              <button
                type="button"
                onClick={start}
                disabled={starting || !userId}
                className="pl-btn pl-btn--primary pl-btn--lg"
              >
                {starting ? 'Opening the room' : 'Enter the room'}
              </button>
              <span className="pl-index pl-door__time">~{scenario.estimatedMinutes} min</span>
            </div>
          </div>
          <div className="pl-door__seal">
            <p className="pl-stamp pl-stamp--steel">What they are working from</p>
            {/* One bar per thing they are holding, so the image is a count
                rather than a texture. */}
            <Redacted
              lines={scenario.leverCount || 4}
              label={`${scenario.leverCount || 'Several'} things, sealed until the rehearsal ends.`}
            />
          </div>
        </section>
      </main>
      <Footer />

      {/* The door closing. Rises from the bottom edge over everything, and the
          room is what is behind it. */}
      {starting && <div className="pl-room pl-door-close" aria-hidden="true" />}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 className="pl-stamp">{title}</h2>
      {children}
    </section>
  )
}
