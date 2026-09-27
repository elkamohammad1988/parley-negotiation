import { ImageResponse } from 'next/og'
import { PAPER, SIGNAL } from '@/lib/design'

// The share card.
//
// This replaces app/api/og/route.tsx, which was removed on 2026-09-16. That
// route rendered a handsome card and was referenced by nothing: `metadata` in
// app/layout.tsx never set an `images` field, so no page ever pointed at it.
// It also returned `image/svg+xml`, which Facebook, X, LinkedIn and Slack all
// decline to unfurl — so even wiring it up would have produced a blank card
// while `twitter.card: 'summary_large_image'` promised a big one.
//
// The file convention fixes both halves: Next renders this to PNG and injects
// og:image and twitter:image itself, so the tags cannot drift from the artwork
// again. It is a static route, so this runs once at build rather than per
// request.
//
// Satori supports flexbox and a subset of CSS — no grid, no custom serif
// without shipping a font file. Rather than fake the wordmark's serif in a
// system font, the card is built from the parts of the design that survive
// being drawn in one typeface: the paper, the clay rule, and the redaction.
// The redaction is the right image to lead with anyway — lib/design.ts calls
// it the product's one central image, and it states the mechanic before the
// sentence underneath has to.

export const alt =
  'Parley — rehearse a vendor negotiation against a counterpart holding a mandate you cannot see'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** The sealed mandate, as bars. Irregular widths so it reads as redacted prose. */
const BARS = [
  [420, 150, 260],
  [190, 330, 210],
  [300, 240],
]

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: PAPER.bg,
          padding: '72px 80px 64px',
          position: 'relative',
        }}
      >
        {/* The clay hairline the whole product opens on. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: 8,
            backgroundColor: SIGNAL.clay,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 13, height: 13, backgroundColor: SIGNAL.clay }} />
            <div
              style={{
                fontSize: 21,
                letterSpacing: 3.4,
                textTransform: 'uppercase',
                color: 'rgba(22,24,29,0.62)',
              }}
            >
              AI negotiation rehearsal
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: -2.6,
              lineHeight: 1.08,
              color: PAPER.ink,
              marginTop: 34,
              maxWidth: 760,
            }}
          >
            They have rehearsed this conversation.
          </div>

          <div
            style={{
              display: 'flex',
              fontSize: 29,
              lineHeight: 1.45,
              color: 'rgba(22,24,29,0.7)',
              marginTop: 26,
              maxWidth: 720,
            }}
          >
            Practise against a counterpart holding a mandate you cannot see, then
            read what your version of the call cost.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: -1.2,
              color: PAPER.ink,
              display: 'flex',
            }}
          >
            Parley
            <span style={{ color: SIGNAL.clay }}>.</span>
          </div>

          {/* What they are working from, and you are not. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 11 }}>
            <div
              style={{
                fontSize: 17,
                letterSpacing: 2.6,
                textTransform: 'uppercase',
                color: 'rgba(22,24,29,0.5)',
                marginBottom: 4,
              }}
            >
              What they are working from
            </div>
            {BARS.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                {row.map((w, j) => (
                  <div key={j} style={{ width: w, height: 17, backgroundColor: PAPER.ink }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size
  )
}
