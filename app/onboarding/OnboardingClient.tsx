'use client'
import Link from 'next/link'
import { useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS, SHADOW } from '@/lib/design'
import type { CatalogueScenario } from '@/lib/negotiation/redact'
import { getUserId } from '@/lib/user-id'

// Onboarding.
//
// Three questions, and the first one is not about the product — it is "which
// deal is coming?". Everything else follows from the answer.
//
// The design decision worth defending: onboarding does NOT ask about goals,
// experience level, industry, or how much the user spends on software. None of
// that changes anything the product does, and every extra question is a chance
// to lose someone who came here with a renewal call on Thursday. It ends by
// putting them in a brief, not on a tour.

const STEPS = ['The deal', 'When', 'Closest match'] as const

export default function OnboardingClient({ scenarios }: { scenarios: CatalogueScenario[] }) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [happensOn, setHappensOn] = useState('')
  const [scenarioSlug, setScenarioSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const today = new Date().toISOString().slice(0, 10)

  async function finish(slug: string) {
    if (saving) return
    setSaving(true)
    setError('')

    const userId = getUserId()

    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          title: title.trim(),
          happensOn: happensOn || null,
          scenarioSlug: slug,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not save that.')
        setSaving(false)
        return
      }
    } catch {
      // Non-fatal. The dashboard row is a convenience; not being able to save
      // it should not stop someone getting into their first rehearsal, which
      // is the only thing that matters in this flow.
    }

    // Full reload after a write the destination reads on mount. Swapping this
    // for router.push() is a behaviour change — a cached router entry can serve
    // the pre-write view — not a lint fix, so it is left to a deliberate call
    // rather than made silently. Matches the sign-up path above it.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/library/${slug}`
  }

  // The site's chrome, for the same reason sign-up carries it: this is a step
  // someone can arrive at, stall on, and want out of. The bare wordmark that
  // used to sit here went home and nowhere else. A flex column rather than a
  // 100vh main, so the card stays centred between the nav and the footer
  // instead of forcing a viewport of its own.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: PAPER.bg }}>
      <Nav />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          fontFamily: FONT.sans,
        }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: PAPER.surface,
          border: `1px solid ${PAPER.line}`,
          borderRadius: RADIUS.lg,
          padding: '34px 34px 30px',
          boxShadow: SHADOW.raised,
        }}
        className="pl-rise"
      >
        {/* Step markers double as a promise about length: three, and you are
            in. There were two of these drawn at once — a row of inline-styled
            pills above the card and this one inside it — which read as an
            interface that had been assembled twice. The design system's own
            `.pl-steps` is the one that stays; it is what the rest of the
            product uses, and it is the one inside the card the steps are
            actually happening in.

            STEPS is what says how many cells there are, so the marker cannot
            fall out of step with the questions. Its names are not printed —
            three cells are a better promise about length than three words that
            have to be re-read at every step — which is why the strip is
            aria-hidden and the live region below is what announces progress. */}
        <div className="pl-steps" aria-hidden="true">
          {STEPS.map((label, i) => (
            <span key={label} className="pl-steps__cell" data-on={i <= step ? 'true' : undefined} />
          ))}
        </div>
        <p className="pl-sr-only" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>

        {step === 0 && (
          <>
            <h1
              style={{
                fontFamily: FONT.serif,
                fontSize: TYPE.h2,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '0 0 10px',
              }}
            >
              Which negotiation is coming?
            </h1>
            <p style={{ fontSize: 15, color: PAPER.inkMuted, margin: '0 0 22px', lineHeight: 1.6 }}>
              In your own words — the vendor, the deal, whatever you call it
              internally. This stays private to your account and is only used to
              organise your own dashboard.
            </p>

            <input
              className="pl-input"
              autoFocus
              // The step's heading carries the question; there is no visible
              // label to point at, so the accessible name is stated here.
              aria-label="Which negotiation is coming?"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && title.trim() && setStep(1)}
              placeholder="Datadog renewal — they came back at +22%"
              maxLength={200}
              style={inputStyle}
            />

            <button
              type="button"
              onClick={() => title.trim() && setStep(1)}
              disabled={!title.trim()}
              className="pl-btn pl-btn--primary pl-btn--lg pl-btn--block"
            >
              Next
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h1
              style={{
                fontFamily: FONT.serif,
                fontSize: TYPE.h2,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '0 0 10px',
              }}
            >
              When is the call?
            </h1>
            <p style={{ fontSize: 15, color: PAPER.inkMuted, margin: '0 0 22px', lineHeight: 1.6 }}>
              A date puts a countdown on your dashboard. Plenty of renewals do
              not have one booked yet, and that is a fine answer.
            </p>

            <input
              className="pl-input"
              type="date"
              aria-label="When does it happen?"
              value={happensOn}
              min={today}
              onChange={e => setHappensOn(e.target.value)}
              style={inputStyle}
            />

            <button type="button" onClick={() => setStep(2)} className="pl-btn pl-btn--primary pl-btn--lg pl-btn--block">
              {happensOn ? 'Next' : 'No date yet'}
            </button>

            <button type="button" onClick={() => setStep(0)} className="pl-btn pl-btn--ghost pl-btn--block" style={{ marginTop: 8 }}>
              Back
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1
              style={{
                fontFamily: FONT.serif,
                fontSize: TYPE.h2,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '0 0 10px',
              }}
            >
              Which of these is closest?
            </h1>
            <p style={{ fontSize: 15, color: PAPER.inkMuted, margin: '0 0 22px', lineHeight: 1.6 }}>
              It does not have to be exact. Who they put on the call is what
              makes it feel like yours.
            </p>

            <div className="pl-pick" style={{ marginBottom: 20 }}>
              {scenarios.map(s => (
                <button
                  key={s.slug}
                  type="button"
                  className="pl-pick__opt"
                  aria-pressed={scenarioSlug === s.slug}
                  onClick={() => setScenarioSlug(s.slug)}
                >
                  <span className="pl-pick__eyebrow">{s.categoryLabel}</span>
                  <span className="pl-pick__title">{s.title}</span>
                  <span className="pl-pick__body">{s.premise}</span>
                </button>
              ))}
            </div>

            {error && (
              <p style={{ fontSize: 13.5, color: SIGNAL.clayDeep, margin: '0 0 12px' }}>{error}</p>
            )}

            <button
              onClick={() => scenarioSlug && finish(scenarioSlug)}
              disabled={!scenarioSlug || saving}
              className="pl-btn pl-btn--primary pl-btn--lg pl-btn--block"
            >
              {saving ? 'Setting it up…' : 'Read the brief'}
            </button>

            <button type="button" onClick={() => setStep(1)} className="pl-btn pl-btn--ghost pl-btn--block" style={{ marginTop: 8 }}>
              Back
            </button>
          </>
        )}
      </div>

        <Link
          href="/library"
          className="pl-tap pl-link"
          style={{ marginTop: 20, fontSize: 13, color: PAPER.inkFaint }}
        >
          Skip. Just show me the library
        </Link>
      </main>
      <Footer />
    </div>
  )
}

// 16px, deliberately: anything smaller makes iOS Safari zoom the viewport on
// focus, which throws the user out of the layout mid-answer.
const inputStyle: React.CSSProperties = { fontSize: 16, marginBottom: 20 }




