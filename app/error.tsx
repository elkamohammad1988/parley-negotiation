'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { PAPER, SIGNAL, FONT, RADIUS } from '@/lib/design'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Parley] Global error:', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAPER.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        fontFamily: FONT.sans,
        color: PAPER.ink,
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: FONT.serif,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          textDecoration: 'none',
          color: PAPER.ink,
          marginBottom: '3rem',
        }}
      >
        Parley<span style={{ color: SIGNAL.clay }}>.</span>
      </Link>

      <h1
        style={{
          fontFamily: FONT.serif,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 10px',
        }}
      >
        Something broke on our side
      </h1>
      <p
        style={{
          fontSize: 15,
          color: PAPER.inkMuted,
          maxWidth: 400,
          lineHeight: 1.65,
          margin: '0 0 30px',
        }}
      >
        Any rehearsal you were in the middle of is saved — transcripts are
        written turn by turn, not at the end.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '11px 22px',
            background: SIGNAL.clay,
            border: 'none',
            // Not '#fff'. White on clay is 3.53:1 and fails AA; SIGNAL.onClay
            // is 5.03:1. The stylesheet's .pl-btn--primary was corrected for
            // this, but the three error surfaces — this, app/not-found and
            // app/components/ErrorBoundary — are inline-styled and were missed,
            // so the rule only held on screens where nothing had gone wrong.
            color: SIGNAL.onClay,
            fontSize: 14.5,
            fontFamily: FONT.sans,
            cursor: 'pointer',
            borderRadius: RADIUS.md,
            fontWeight: 500,
          }}
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          style={{
            padding: '11px 22px',
            background: 'transparent',
            border: `1px solid ${PAPER.lineStrong}`,
            color: PAPER.ink,
            fontSize: 14.5,
            textDecoration: 'none',
            borderRadius: RADIUS.md,
          }}
        >
          Back to dashboard
        </Link>
      </div>

      {error.digest && (
        <div
          className="pl-num"
          style={{ marginTop: '2rem', fontSize: 11, color: PAPER.inkFaint }}
        >
          Error ID: {error.digest}
        </div>
      )}
    </div>
  )
}
