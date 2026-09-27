'use client'
import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { PAPER, SIGNAL, FONT, RADIUS, SHADOW } from '@/lib/design'

// Floating help.
//
// Answers the questions people actually get stuck on mid-flow, and links to
// the real support form rather than a hardcoded email address that would be
// wrong for any deployment but one.
//
// Hidden inside a live rehearsal: a help bubble floating over the room while
// the clock runs is an invitation to break out of the conversation, which is
// the one thing this product cannot afford to make easy.

const FAQS = [
  {
    q: 'The counterpart will not tell me what they can agree to.',
    a: 'That is deliberate. They hold a mandate you are meant to discover by asking. The whole thing is revealed in the debrief, and how much of it you surfaced is one of the five scores.',
  },
  {
    q: 'Can I take back something I said?',
    a: 'No. Turns are final, because they are final in the real conversation too. End the rehearsal and run it again if you want another attempt.',
  },
  {
    q: 'My debrief failed to generate.',
    a: 'Retry from the same page. Your transcript is saved and nothing needs re-running. A rehearsal shorter than a couple of turns is too short to score.',
  },
  {
    q: 'What counts against my monthly quota?',
    a: 'Opening a room. Length, number of turns and the debrief are all included, so there is never a reason to cut a rehearsal short to save quota.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time from billing. You keep access until the end of the period you have already paid for.',
  },
]

export default function SupportWidget() {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  // usePathname rather than reading window.location once on mount: this
  // component lives in the root layout and is never remounted, so a
  // mount-only check would keep the widget on screen when someone navigates
  // client-side into a room.
  const pathname = usePathname()
  if (pathname?.startsWith('/room/')) return null
  // Not on the landing either. Its answers are for someone mid-flow, which a
  // first-time visitor is not, and on a phone the bubble sat on top of the
  // hero console's clock — the one interactive thing in the first screen.
  // The footer's Support link is still there.
  if (pathname === '/') return null

  return (
    <div
      // Named so the debrief's reveal act can defer it beneath itself — see
      // html[data-pl-act] in globals.css — the way the room suppresses it.
      className="pl-support"
      style={{
        position: 'fixed',
        bottom: 22,
        right: 22,
        zIndex: 800,
        fontFamily: FONT.sans,
      }}
    >
      {open && (
        <div
          className="pl-rise"
          style={{
            position: 'absolute',
            bottom: 52,
            right: 0,
            width: 320,
            maxWidth: 'calc(100vw - 44px)',
            background: PAPER.surface,
            border: `1px solid ${PAPER.line}`,
            borderRadius: RADIUS.lg,
            overflow: 'hidden',
            boxShadow: SHADOW.modal,
          }}
        >
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${PAPER.line}` }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Common questions</div>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ borderBottom: `1px solid ${PAPER.line}` }}>
                <button
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  aria-expanded={expanded === i}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '11px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: PAPER.ink,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: FONT.sans,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{faq.q}</span>
                  <span style={{ color: PAPER.inkFaint, flexShrink: 0 }}>
                    {expanded === i ? '−' : '+'}
                  </span>
                </button>
                {expanded === i && (
                  <p
                    style={{
                      padding: '0 16px 12px',
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: PAPER.inkMuted,
                      margin: 0,
                    }}
                  >
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: '11px 16px', fontSize: 12.5, color: PAPER.inkMuted }}>
            Still stuck?{' '}
            <Link href="/support" style={{ color: SIGNAL.clayDeep, textDecoration: 'none' }}>
              Write to us
            </Link>
            .
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close help' : 'Open help'}
        aria-expanded={open}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: PAPER.surface,
          border: `1px solid ${PAPER.lineStrong}`,
          color: PAPER.ink,
          fontSize: 16,
          cursor: 'pointer',
          boxShadow: SHADOW.raised,
          fontFamily: FONT.sans,
        }}
      >
        {open ? '×' : '?'}
      </button>
    </div>
  )
}
