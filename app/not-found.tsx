import Link from 'next/link'
import { PAPER, SIGNAL, FONT, RADIUS } from '@/lib/design'

export default function NotFound() {
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
          marginBottom: '2.5rem',
        }}
      >
        Parley<span style={{ color: SIGNAL.clay }}>.</span>
      </Link>

      <div
        className="pl-num"
        style={{ fontSize: 64, color: PAPER.inkFaint, lineHeight: 1, marginBottom: 18 }}
      >
        404
      </div>

      <h1
        style={{
          fontFamily: FONT.serif,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 10px',
        }}
      >
        Nothing at this address
      </h1>
      <p
        style={{
          fontSize: 15,
          color: PAPER.inkMuted,
          maxWidth: 380,
          lineHeight: 1.65,
          margin: '0 0 30px',
        }}
      >
        The page you were after does not exist. The library is the usual place
        to start.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/library"
          style={{
            padding: '11px 22px',
            background: SIGNAL.clay,
            // 5.03:1 rather than white's 3.53:1 — see app/error.tsx.
            color: SIGNAL.onClay,
            fontSize: 14.5,
            fontWeight: 500,
            textDecoration: 'none',
            borderRadius: RADIUS.md,
          }}
        >
          Open the library
        </Link>
        <Link
          href="/"
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
          Home
        </Link>
      </div>
    </div>
  )
}
