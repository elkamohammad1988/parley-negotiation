import { PAPER, SIGNAL, FONT } from '@/lib/design'

export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAPER.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          fontFamily: FONT.serif,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: PAPER.ink,
        }}
      >
        Parley<span style={{ color: SIGNAL.clay }}>.</span>
      </div>
      {/* A single quiet rule rather than a spinner — this flashes on every
          navigation, and animation here reads as slowness. */}
      <div style={{ width: 120, height: 2, background: PAPER.line, overflow: 'hidden' }}>
        <div className="pl-load-bar" style={{ width: '40%', height: '100%', background: SIGNAL.clay }} />
      </div>
      <style>{`
        @keyframes pl-load { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
        .pl-load-bar { animation: pl-load 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
