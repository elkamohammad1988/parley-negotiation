'use client'
import Link from 'next/link'
import { useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS } from '@/lib/design'
import { getUserId } from '@/lib/user-id'

// Data controls.
//
// Two real actions, both immediate, neither hidden behind an email loop or a
// retention offer. The toggles that used to live here — "use your chat history
// to improve AI response quality", "build memory from conversations" — are
// gone because the behaviours they claimed to control do not exist in this
// product. A privacy switch that does not switch anything is worse than no
// switch at all.

export default function PrivacyControlsPage() {
  const [exporting, setExporting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function exportData() {
    if (exporting) return
    setExporting(true)
    setError('')
    try {
      const res = await fetch(`/api/account?userId=${encodeURIComponent(getUserId())}`)
      if (!res.ok) {
        setError('Could not build the export. Try again in a moment.')
        setExporting(false)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `parley-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not reach the server.')
    }
    setExporting(false)
  }

  async function deleteEverything() {
    if (confirmText !== 'DELETE' || deleting) return
    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: getUserId(), confirm: 'DELETE_MY_ACCOUNT' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not complete the deletion.')
        setDeleting(false)
        return
      }
      localStorage.clear()
      sessionStorage.clear()
      window.location.replace('/?deleted=1')
    } catch {
      setError('Could not reach the server.')
      setDeleting(false)
    }
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '44px 24px 40px', fontFamily: FONT.sans }}>
        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: TYPE.h1,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            margin: '0 0 12px',
          }}
        >
          Your data
        </h1>
        <p style={{ fontSize: 16, color: PAPER.inkMuted, lineHeight: 1.65, margin: '0 0 34px' }}>
          Rehearsal transcripts are candid by nature — what you actually plan to
          say, before you have polished it. Both actions below are immediate and
          need no approval from us.
        </p>

        <section
          style={{
            background: PAPER.surface,
            border: `1px solid ${PAPER.line}`,
            borderRadius: RADIUS.lg,
            padding: '24px 26px',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Take a copy</h2>
          <p style={{ fontSize: 14.5, color: PAPER.inkMuted, lineHeight: 1.65, margin: '0 0 18px' }}>
            One JSON file containing every rehearsal with its full transcript,
            every debrief and its scores, your playbook, your custom
            counterparts, and the conversations on your dashboard.
          </p>
          <button
            onClick={exportData}
            disabled={exporting}
            style={{
              padding: '11px 22px',
              background: 'transparent',
              border: `1px solid ${PAPER.lineStrong}`,
              borderRadius: RADIUS.md,
              fontSize: 14.5,
              cursor: exporting ? 'wait' : 'pointer',
              fontFamily: FONT.sans,
              color: PAPER.ink,
            }}
          >
            {exporting ? 'Building your file…' : 'Download everything'}
          </button>
        </section>

        <section
          style={{
            background: SIGNAL.claySoft,
            border: `1px solid ${SIGNAL.clay}`,
            borderRadius: RADIUS.lg,
            padding: '24px 26px',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Delete everything</h2>
          <p style={{ fontSize: 14.5, color: PAPER.inkMuted, lineHeight: 1.65, margin: '0 0 12px' }}>
            Your account, every transcript, every debrief, your playbook and
            your counterparts. This happens straight away and cannot be undone —
            export first if you want a copy.
          </p>
          <p style={{ fontSize: 13, color: PAPER.inkFaint, lineHeight: 1.6, margin: '0 0 18px' }}>
            One exception, stated plainly: if your account has entries in the
            child-safety violation log, those are retained. Keeping them is a
            legal obligation, not a product decision. They hold a hash and a
            short excerpt, not a transcript.
          </p>

          <label
            htmlFor="confirm-delete"
            style={{ display: 'block', fontSize: 13.5, fontWeight: 500, marginBottom: 7 }}
          >
            Type DELETE to confirm
          </label>
          <input
            id="confirm-delete"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="DELETE"
            style={{
              width: '100%',
              maxWidth: 220,
              padding: '10px 13px',
              border: `1px solid ${PAPER.lineStrong}`,
              borderRadius: RADIUS.md,
              fontSize: 14.5,
              fontFamily: FONT.mono,
              background: PAPER.surface,
              color: PAPER.ink,
              outline: 'none',
              marginBottom: 14,
            }}
          />

          <div>
            <button
              onClick={deleteEverything}
              disabled={confirmText !== 'DELETE' || deleting}
              style={{
                padding: '11px 22px',
                background: confirmText === 'DELETE' && !deleting ? SIGNAL.clay : PAPER.surfaceSunken,
                color: confirmText === 'DELETE' && !deleting ? SIGNAL.onClay : PAPER.inkFaint,
                border: 'none',
                borderRadius: RADIUS.md,
                fontSize: 14.5,
                fontWeight: 500,
                cursor: confirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                fontFamily: FONT.sans,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete my account and all my data'}
            </button>
          </div>
        </section>

        {error && (
          <p role="alert" style={{ fontSize: 14, color: SIGNAL.clayDeep, marginTop: 18 }}>
            {error}
          </p>
        )}

        <p style={{ fontSize: 13.5, color: PAPER.inkFaint, marginTop: 26, lineHeight: 1.6 }}>
          What we store and who it reaches is set out on the{' '}
          {/* clayDeep: this sits in 13.5px faint-ink prose, where plain clay
              is 3.2:1.

              .pl-link is what makes it a link rather than a differently
              coloured word. Colour alone does not carry that — clayDeep against
              the faint ink around it is under the 3:1 two colours need to be
              told apart, so a reader who does not separate those hues had
              nothing to go on. The class draws the product's standing 1px rule
              under it, which is the cue that does not depend on seeing a
              colour, and it is the same link the rest of the app's prose
              already uses. */}
          <Link href="/privacy" className="pl-link" style={{ color: SIGNAL.clayDeep }}>
            privacy page
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}
