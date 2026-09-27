'use client'
import { Component, ReactNode, ErrorInfo } from 'react'
import { PAPER, ROOM, SIGNAL, FONT, RADIUS } from '@/lib/design'

interface Props {
  children: ReactNode
  /**
   * Set on the rehearsal room so the fallback renders in the dark register
   * and says the one thing that actually matters there: the transcript is
   * already saved.
   */
  inRoom?: boolean
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Parley] Error:', error, info)
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {}) // silent — logging must never itself throw
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const t = this.props.inRoom ? ROOM : PAPER

    return (
      <div
        style={{
          minHeight: '100vh',
          background: t.bg,
          color: t.ink,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: 24,
          fontFamily: FONT.sans,
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontFamily: FONT.serif,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Something went wrong
        </h2>
        <p style={{ fontSize: 15, color: t.inkMuted, margin: 0, maxWidth: 360, lineHeight: 1.6 }}>
          {this.props.inRoom
            ? 'Your transcript is saved up to this point. Turns are written as they happen, not at the end.'
            : 'Nothing you had saved is affected.'}
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '11px 22px',
              background: SIGNAL.clay,
              border: 'none',
              borderRadius: RADIUS.md,
              // 5.03:1 rather than white's 3.53:1 — see app/error.tsx.
              color: SIGNAL.onClay,
              fontSize: 14.5,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: FONT.sans,
            }}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            style={{
              padding: '11px 22px',
              border: `1px solid ${t.lineStrong}`,
              borderRadius: RADIUS.md,
              color: t.ink,
              fontSize: 14.5,
              textDecoration: 'none',
            }}
          >
            Back to dashboard
          </a>
        </div>
      </div>
    )
  }
}
