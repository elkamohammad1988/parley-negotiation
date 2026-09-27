'use client'
import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS } from '@/lib/design'
import { PLAN_NAMES, planFeatures, formatLimit, type Plan } from '@/lib/plans'
import { BUILT_IN_COUNTERPARTS } from '@/lib/negotiation/counterparts'
import { useUserId } from '@/lib/hooks/useUserId'

// Settings, organised by what a user actually comes here to change.
//
// Settings are short on purpose: a name, the plan, and the two choices that
// change how the room behaves. Nothing here exists to bring someone back daily.
//
// There was a Reminders section here until 2026-09-16, offering "a week
// before", "the day before" and "when a debrief is ready", with the second one
// switched on by default. All three wrote to localStorage and nothing ever
// read it: no scheduler exists, lib/notificationTriggers.ts was called from
// nowhere, and the `web-push` dependency was imported by no file in the repo.
// So the page promised a message that could not be sent, and defaulted the
// promise to on. The date the user gave onboarding is real and it is still
// shown, with the days remaining, on the dashboard — which is the honest place
// for that urgency to live until something can actually deliver it. See
// ROADMAP.md.

interface StoredSettings {
  displayName: string
  email: string
  defaultCounterpart: string
  briefOpenByDefault: boolean
}

const EMPTY_SETTINGS: StoredSettings = {
  displayName: '',
  email: '',
  defaultCounterpart: '',
  briefOpenByDefault: true,
}

// Everything on this page that lives in localStorage, read in one go. It is a
// browser-only value read once on mount, so it is read as an external store
// rather than copied into state inside an effect — same pattern as
// lib/hooks/useUserId. The snapshot is serialised so React's equality check
// sees a stable value; the server snapshot is empty, matching what the browser
// renders before hydration, and storage does not change while the page is
// open, so the subscription is a no-op.
function subscribeNever(): () => void {
  return () => {}
}

function readStoredSettings(): string {
  return JSON.stringify({
    displayName: localStorage.getItem('parley_display_name') || '',
    email: localStorage.getItem('parley_email') || '',
    defaultCounterpart: localStorage.getItem('parley_default_counterpart') || '',
    briefOpenByDefault: localStorage.getItem('parley_brief_open') !== 'off',
  } satisfies StoredSettings)
}

export default function SettingsPage() {
  const stored = useSyncExternalStore(subscribeNever, readStoredSettings, () => '')
  // The form seeds its editable state from the stored values once. Keying on
  // whether they have been read remounts it exactly once, right after
  // hydration, with the real values — the same single re-render the old mount
  // effect caused, without setting state inside an effect.
  return (
    <SettingsForm
      key={stored ? 'stored' : 'empty'}
      initial={stored ? (JSON.parse(stored) as StoredSettings) : EMPTY_SETTINGS}
    />
  )
}

function SettingsForm({ initial }: { initial: StoredSettings }) {
  const userId = useUserId()
  const [displayName, setDisplayName] = useState(initial.displayName)
  const email = initial.email
  const [plan, setPlan] = useState<Plan>('free')
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)

  const [defaultCounterpart, setDefaultCounterpart] = useState(initial.defaultCounterpart)
  const [briefOpenByDefault, setBriefOpenByDefault] = useState(initial.briefOpenByDefault)

  // Three states, not two. 'failed' exists because the display name is the one
  // thing on this page that lives on the server as well as in localStorage, and
  // the server can refuse it.
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  useEffect(() => {
    // useUserId returns an empty string during SSR and the first
    // paint; there is nothing to fetch until it resolves.
    if (!userId) return
    const uid = userId

    fetch(`/api/rehearsal/session?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.plan) setPlan(d.plan)
        if (d?.quota) setQuota({ used: d.quota.used, limit: d.quota.limit })
      })
      .catch(() => {})
  }, [userId])

  // The two preferences below are browser-local and cannot fail. The display
  // name is not: it is written to the account as well, and that write is now
  // awaited and read.
  //
  // It used to be fired and discarded — `.catch(() => {})` — with "Saved"
  // shown unconditionally a line later. So a refused or dropped write looked
  // exactly like a successful one, and the name reverted the next time the
  // page was opened on another device with no explanation.
  async function save() {
    localStorage.setItem('parley_display_name', displayName.trim())
    localStorage.setItem('parley_default_counterpart', defaultCounterpart)
    localStorage.setItem('parley_brief_open', briefOpenByDefault ? 'on' : 'off')

    if (userId && displayName.trim()) {
      try {
        const res = await fetch('/api/user/update-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, displayName: displayName.trim() }),
        })
        if (!res.ok) {
          setSaveState('failed')
          return
        }
      } catch {
        setSaveState('failed')
        return
      }
    }

    setSaveState('saved')
    setTimeout(() => setSaveState(current => (current === 'saved' ? 'idle' : current)), 2400)
  }

  async function signOut() {
    try {
      // supabase-client, not the former lib/supabase: the session this app
      // actually holds is stored under 'parley-auth-session', and signing out
      // of a client configured with the default key ended a session that was
      // never there. It looked like it worked only because localStorage.clear()
      // below removes the real one too.
      const { supabase } = await import('@/lib/supabase-client')
      await supabase.auth.signOut()
    } catch {
      // Local state is cleared regardless below.
    }
    // Cookie consent survives the wipe — it is a device-level compliance flag,
    // not account data, and re-prompting on every sign-out is just noise.
    const consent = localStorage.getItem('parley_cookie_consent')
    localStorage.clear()
    if (consent) localStorage.setItem('parley_cookie_consent', consent)
    sessionStorage.clear()
    window.location.replace('/?signedout=1')
  }

  const features = planFeatures(plan)

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '44px 24px 40px', fontFamily: FONT.sans }}>
        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: TYPE.h1,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            margin: '0 0 34px',
          }}
        >
          Settings
        </h1>

        <Section title="You">
          <Field label="Display name" htmlFor="display-name">
            <input
              id="display-name"
              className="pl-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder="What should we call you?"
            />
          </Field>
          {email && (
            <Field label="Email">
              <div style={{ fontSize: 14.5, color: PAPER.inkMuted, padding: '4px 0' }}>{email}</div>
            </Field>
          )}
        </Section>

        <Section title="Plan">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
              padding: '14px 16px',
              background: PAPER.surfaceSunken,
              borderRadius: RADIUS.md,
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 3 }}>{PLAN_NAMES[plan]}</div>
              <div style={{ fontSize: 13, color: PAPER.inkMuted }}>
                {features.monthlyRehearsals === -1
                  ? 'Unlimited rehearsals'
                  : quota
                    ? `${quota.used} of ${formatLimit(features.monthlyRehearsals)} rehearsals used this month`
                    : `${formatLimit(features.monthlyRehearsals)} rehearsals a month`}
              </div>
            </div>
            <a
              href={plan === 'free' ? '/pricing' : '/billing'}
              style={{
                fontSize: 13.5,
                padding: '8px 15px',
                borderRadius: RADIUS.sm,
                textDecoration: 'none',
                background: plan === 'free' ? SIGNAL.clay : 'transparent',
                color: plan === 'free' ? SIGNAL.onClay : PAPER.ink,
                border: plan === 'free' ? 'none' : `1px solid ${PAPER.lineStrong}`,
              }}
            >
              {plan === 'free' ? 'See plans' : 'Manage billing'}
            </a>
          </div>
        </Section>

        <Section title="The room">
          <Field
            label="Counterpart to pre-select"
            hint="Which one is highlighted when you open a scenario brief."
            htmlFor="default-counterpart"
          >
            <select
              id="default-counterpart"
              className="pl-select"
              value={defaultCounterpart}
              onChange={e => setDefaultCounterpart(e.target.value)}
            >
              <option value="">No preference</option>
              {BUILT_IN_COUNTERPARTS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.role}
                </option>
              ))}
            </select>
          </Field>

          <Toggle
            label="Keep the brief open during a rehearsal"
            hint="Your objective and constraints stay pinned beside the transcript. Turn it off for a harder run."
            checked={briefOpenByDefault}
            onChange={setBriefOpenByDefault}
          />
        </Section>

        <Section
          title="Your data"
          note="Rehearsal transcripts are candid by nature. They are private to your account and are not used to train models."
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href="/privacy-controls"
              style={{
                fontSize: 13.5,
                padding: '9px 16px',
                border: `1px solid ${PAPER.lineStrong}`,
                borderRadius: RADIUS.sm,
                textDecoration: 'none',
                color: PAPER.ink,
              }}
            >
              Export or delete everything
            </Link>
          </div>
        </Section>

        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            paddingTop: 12,
            borderTop: `1px solid ${PAPER.line}`,
            flexWrap: 'wrap',
          }}
        >
          <button type="button" onClick={save} className="pl-btn pl-btn--primary">
            Save changes
          </button>
          {saveState === 'saved' && (
            <span className="pl-saved" role="status">
              Saved
            </span>
          )}
          {saveState === 'failed' && (
            <span className="pl-saved pl-saved--failed" role="status">
              Your preferences are saved on this device, but the name could not
              be saved to your account. Try again in a moment.
            </span>
          )}

          <button
            type="button"
            onClick={() => setConfirmSignOut(true)}
            className="pl-btn pl-btn--ghost pl-btn--sm"
            style={{ marginLeft: 'auto' }}
          >
            Sign out
          </button>
        </div>

        {confirmSignOut && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(21,23,28,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
              zIndex: 300,
            }}
            onClick={() => setConfirmSignOut(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: PAPER.surface,
                borderRadius: RADIUS.lg,
                padding: '26px 26px 22px',
                maxWidth: 400,
                width: '100%',
              }}
            >
              <h2 style={{ fontFamily: FONT.serif, fontSize: 19, margin: '0 0 10px', fontWeight: 600 }}>
                Sign out?
              </h2>
              <p style={{ fontSize: 14, color: PAPER.inkMuted, lineHeight: 1.6, margin: '0 0 20px' }}>
                Your rehearsals and playbook stay on your account. This device
                will forget you.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setConfirmSignOut(false)}
                  style={{
                    padding: '9px 16px',
                    background: 'transparent',
                    border: `1px solid ${PAPER.lineStrong}`,
                    borderRadius: RADIUS.sm,
                    fontSize: 14,
                    cursor: 'pointer',
                    fontFamily: FONT.sans,
                    color: PAPER.ink,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={signOut}
                  style={{
                    padding: '9px 18px',
                    background: SIGNAL.clay,
                    border: 'none',
                    color: SIGNAL.onClay,
                    borderRadius: RADIUS.sm,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: FONT.sans,
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="pl-set__section">
      <h2 className="pl-stamp">{title}</h2>
      {note && (
        <p style={{ fontSize: 13.5, color: PAPER.inkMuted, lineHeight: 1.6, margin: '0 0 14px' }}>
          {note}
        </p>
      )}
      {children}
    </section>
  )
}

// `htmlFor` is optional because several Fields wrap read-only text rather than
// a control — an email address, a plan name — and a label pointing at nothing
// is worse than no label. Where there IS a control, passing it together with a
// matching id is what makes the visible label the accessible name; without it
// the association was purely visual and a screen reader announced the field as
// unlabelled.
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        htmlFor={htmlFor}
        style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: hint ? 3 : 7 }}
      >
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 12.5, color: PAPER.inkFaint, margin: '0 0 8px', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '11px 0',
        borderTop: `1px solid ${PAPER.line}`,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: SIGNAL.clay, width: 16, height: 16, cursor: 'pointer' }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 12.5, color: PAPER.inkFaint, marginTop: 2, lineHeight: 1.5 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}
