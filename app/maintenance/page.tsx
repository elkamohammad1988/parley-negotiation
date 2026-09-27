import Link from 'next/link'
import { PAPER, SIGNAL, FONT, RADIUS } from '@/lib/design'

export default function MaintenancePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAPER.bg,
        color: PAPER.ink,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          fontFamily: FONT.serif,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          marginBottom: '2.5rem',
        }}
      >
        Parley<span style={{ color: SIGNAL.clay }}>.</span>
      </div>

      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          padding: '5px 13px',
          background: SIGNAL.warnSoft,
          border: `1px solid ${SIGNAL.warn}`,
          color: SIGNAL.warn,
          borderRadius: 20,
          marginBottom: '1.75rem',
        }}
      >
        <span style={{ width: 6, height: 6, background: SIGNAL.warn, borderRadius: '50%' }} />
        Maintenance in progress
      </div>

      <h1
        style={{
          fontFamily: FONT.serif,
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          margin: '0 0 12px',
        }}
      >
        Back shortly
      </h1>
      <p
        style={{
          fontSize: 15.5,
          color: PAPER.inkMuted,
          maxWidth: 420,
          lineHeight: 1.65,
          margin: '0 0 30px',
        }}
      >
        Rehearsals are paused while we ship a change. Every transcript and
        debrief already saved is untouched and will be exactly where you left
        it.
      </p>

      <Link
        href="/status"
        style={{
          padding: '10px 20px',
          border: `1px solid ${PAPER.lineStrong}`,
          borderRadius: RADIUS.md,
          fontSize: 14,
          textDecoration: 'none',
          color: PAPER.ink,
        }}
      >
        Check the status page
      </Link>
    </div>
  )
}
