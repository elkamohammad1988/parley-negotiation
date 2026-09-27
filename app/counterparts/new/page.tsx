'use client'
import Link from 'next/link'
import { useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS } from '@/lib/design'
import { getUserId } from '@/lib/user-id'

// The counterpart builder.
//
// The fields are chosen so that someone describing a real colleague produces a
// usable opponent without being asked to write a prompt. "How do they behave
// when pushed" gets a better answer than "personality", and "their tell" is
// the question that makes people realise they already know the answer.

const MAX = { name: 60, role: 120, disposition: 600, tactic: 200, tell: 300 }

export default function NewCounterpartPage() {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [disposition, setDisposition] = useState('')
  const [tactics, setTactics] = useState<string[]>(['', ''])
  const [tell, setTell] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ready = name.trim() && role.trim() && disposition.trim()

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/counterparts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: getUserId(),
          name: name.trim(),
          role: role.trim(),
          disposition: disposition.trim(),
          tactics: tactics.map(t => t.trim()).filter(Boolean),
          tell: tell.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not save that counterpart.')
        setSaving(false)
        return
      }
      // Full reload so the list re-fetches the counterpart just created. As in
      // app/onboarding, router.push() here is a behaviour change rather than a
      // lint fix, so it is not made silently.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/counterparts'
    } catch {
      setError('Could not reach the server.')
      setSaving(false)
    }
  }

  return (
    <>
      <Nav activePath="/counterparts" />
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px 40px', fontFamily: FONT.sans }}>
        <Link href="/counterparts" style={{ fontSize: 13, color: PAPER.inkMuted, textDecoration: 'none' }}>
          Back to counterparts
        </Link>

        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: TYPE.h1,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            margin: '16px 0 10px',
          }}
        >
          Build a counterpart
        </h1>
        <p style={{ fontSize: 15.5, color: PAPER.inkMuted, margin: '0 0 32px', lineHeight: 1.65 }}>
          Describe the person you are actually going to face. Do not write a
          character — write what they do when someone pushes back on them.
        </p>

        <Field
          label="What do you call them?"
          hint="A name or a role. It is what appears above their turns in the transcript."
        >
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={MAX.name}
            placeholder="Dana, or The Regional Director"
            style={input}
          />
        </Field>

        <Field label="Their position" hint="Where they sit relative to you.">
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            maxLength={MAX.role}
            placeholder="My skip-level, controls the budget line"
            style={input}
          />
        </Field>

        <Field
          label="How do they behave when pushed?"
          hint="The most important field. What actually happens when you disagree with them."
        >
          <textarea
            value={disposition}
            onChange={e => setDisposition(e.target.value)}
            maxLength={MAX.disposition}
            rows={4}
            placeholder="Agrees with everything in the room, then nothing changes. Never says no directly — always frames it as someone else's decision. Gets noticeably shorter when a number is mentioned."
            style={{ ...input, resize: 'vertical', lineHeight: 1.55 }}
          />
          <Counter value={disposition.length} max={MAX.disposition} />
        </Field>

        <Field
          label="Their moves"
          hint="Up to four specific habits. Optional, but they are what make a counterpart feel like a person."
        >
          {tactics.map((t, i) => (
            <input
              key={i}
              value={t}
              onChange={e => {
                const next = [...tactics]
                next[i] = e.target.value
                setTactics(next)
              }}
              maxLength={MAX.tactic}
              placeholder={i === 0 ? 'Brings up headcount whenever I mention scope' : 'Another habit'}
              style={{ ...input, marginBottom: 8 }}
            />
          ))}
          {tactics.length < 4 && (
            <button
              onClick={() => setTactics([...tactics, ''])}
              style={{
                background: 'none',
                border: 'none',
                color: SIGNAL.clayDeep,
                fontSize: 13.5,
                cursor: 'pointer',
                padding: 0,
                fontFamily: FONT.sans,
              }}
            >
              + Add another
            </button>
          )}
        </Field>

        <Field
          label="Their tell"
          hint="What changes in how they talk when they are closer to yes than they are letting on? You probably already know this."
        >
          <input
            value={tell}
            onChange={e => setTell(e.target.value)}
            maxLength={MAX.tell}
            placeholder="Starts asking about timing instead of arguing about the number"
            style={input}
          />
        </Field>

        {error && (
          <div
            role="alert"
            style={{
              background: SIGNAL.claySoft,
              border: `1px solid ${SIGNAL.clay}`,
              borderRadius: RADIUS.md,
              padding: '12px 15px',
              fontSize: 14,
              marginBottom: 18,
            }}
          >
            {error}
            {error.includes('Practitioner') && (
              <>
                {' '}
                <Link href="/pricing" style={{ color: SIGNAL.clayDeep, fontWeight: 500 }}>
                  See plans
                </Link>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 8 }}>
          <button
            onClick={save}
            disabled={!ready || saving}
            style={{
              padding: '13px 26px',
              background: ready && !saving ? SIGNAL.clay : PAPER.surfaceSunken,
              color: ready && !saving ? SIGNAL.onClay : PAPER.inkFaint,
              border: 'none',
              borderRadius: RADIUS.md,
              fontSize: 15,
              fontWeight: 500,
              cursor: ready && !saving ? 'pointer' : 'not-allowed',
              fontFamily: FONT.sans,
            }}
          >
            {saving ? 'Saving…' : 'Save counterpart'}
          </button>
          <Link href="/counterparts" style={{ fontSize: 14, color: PAPER.inkFaint, textDecoration: 'none' }}>
            Cancel
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: `1px solid ${PAPER.lineStrong}`,
  borderRadius: RADIUS.md,
  fontSize: 15,
  fontFamily: FONT.sans,
  background: PAPER.surface,
  color: PAPER.ink,
  outline: 'none',
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 26 }}>
      <label
        style={{
          display: 'block',
          fontSize: 14.5,
          fontWeight: 600,
          marginBottom: hint ? 4 : 9,
        }}
      >
        {label}
      </label>
      {hint && (
        <p style={{ fontSize: 13, color: PAPER.inkFaint, margin: '0 0 10px', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <div
      className="pl-num"
      style={{
        fontSize: 11,
        color: value > max * 0.9 ? SIGNAL.warn : PAPER.inkFaint,
        textAlign: 'right',
        marginTop: 5,
      }}
    >
      {value} / {max}
    </div>
  )
}
