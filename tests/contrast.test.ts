import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PAPER, ROOM, SIGNAL, scoreBand } from '@/lib/design'

// Contrast, computed from the tokens rather than trusted from their comments.
//
// WHY THIS FILE EXISTS. An axe sweep of twenty routes on 2026-09-16 returned
// colour-contrast failures on eighteen of them, from a single cause:
// `inkFaint` was rgba(22,24,29,0.40), which composites to 2.48:1 on the cream.
// It was not decoration — 53 of its 59 uses in globals.css are `color:` — so
// the quietest tier of the type scale was setting the nav's quiet links, every
// section's eyebrow heading, the footer, "last updated" on the legal pages and
// the helper lines under the sign-up form, at less than half the required
// ratio. Two more tokens were a few hundredths under: `citronDeep` on its own
// soft ground, and `warnDeep` on the sunken surface — the latter being the
// token whose entire documented purpose is to clear 4.5:1.
//
// A comment claiming a ratio is not a ratio. These compute it.
//
// WHAT THIS DOES NOT COVER. It checks the TOKENS, not every place they are
// used: a component that puts a token on a ground it was never meant for is
// still a bug this file cannot see, and a real sweep of the rendered pages is
// still the thing that finds those. What it does guarantee is that the pairs
// the design system says are legible actually are, so the fix above cannot be
// undone by a later eyedropper.

type Rgb = [number, number, number]

function parse(colour: string): { rgb: Rgb; alpha: number } {
  const hex = colour.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 }
  }
  const rgba = colour.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  throw new Error(`Cannot parse colour: ${colour}`)
}

/** Flattens a translucent foreground onto an opaque ground. */
function composite(foreground: string, background: string): Rgb {
  const fg = parse(foreground)
  const bg = parse(background)
  if (bg.alpha !== 1) throw new Error(`A background must be opaque: ${background}`)
  return fg.rgb.map((c, i) => bg.rgb[i] + (c - bg.rgb[i]) * fg.alpha) as Rgb
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, rounded the way a reporting tool rounds it. */
export function contrast(foreground: string, background: string): number {
  const a = luminance(composite(foreground, background))
  const b = luminance(parse(background).rgb)
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  return Math.round(ratio * 100) / 100
}

const AA_NORMAL = 4.5
const AA_LARGE = 3

describe('the contrast maths', () => {
  it('agrees with the reference pairs', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21)
    expect(contrast('#ffffff', '#ffffff')).toBe(1)
    // What axe measured for the old inkFaint on the cream, to the hundredth.
    expect(contrast('rgba(22,24,29,0.40)', PAPER.bg)).toBeCloseTo(2.48, 1)
  })

  it('flattens a translucent foreground before measuring it', () => {
    // Fully transparent ink is the background, so the ratio is 1.
    expect(contrast('rgba(22,24,29,0)', PAPER.bg)).toBe(1)
    expect(contrast('rgba(22,24,29,1)', PAPER.bg)).toBe(contrast(PAPER.ink, PAPER.bg))
  })
})

// Every token below is used as TEXT somewhere, on the ground it is paired with.
const TEXT_ON_PAPER: [string, string, string][] = [
  ['ink on the page', PAPER.ink, PAPER.bg],
  ['ink on a surface', PAPER.ink, PAPER.surface],
  ['muted on the page', PAPER.inkMuted, PAPER.bg],
  ['muted on a surface', PAPER.inkMuted, PAPER.surface],
  ['faint on the page', PAPER.inkFaint, PAPER.bg],
  ['faint on a surface', PAPER.inkFaint, PAPER.surface],
  ['faint on a sunken surface', PAPER.inkFaint, PAPER.surfaceSunken],
  ['ink on a clay fill', SIGNAL.onClay, SIGNAL.clay],
  ['clayDeep on the page', SIGNAL.clayDeep, PAPER.bg],
  ['clayDeep on a surface', SIGNAL.clayDeep, PAPER.surface],
  ['gain on the page', SIGNAL.gain, PAPER.bg],
  ['gain on a surface', SIGNAL.gain, PAPER.surface],
  ['warnDeep on the page', SIGNAL.warnDeep, PAPER.bg],
  ['warnDeep on a sunken surface', SIGNAL.warnDeep, PAPER.surfaceSunken],
  ['steel on the page', SIGNAL.steel, PAPER.bg],
  ['steel on a surface', SIGNAL.steel, PAPER.surface],
]

const TEXT_IN_ROOM: [string, string, string][] = [
  ['ink on the room ground', ROOM.ink, ROOM.bg],
  ['ink on a room surface', ROOM.ink, ROOM.surface],
  ['muted on the room ground', ROOM.inkMuted, ROOM.bg],
  ['muted on a room surface', ROOM.inkMuted, ROOM.surface],
  ['faint on the room ground', ROOM.inkFaint, ROOM.bg],
  ['faint on a room surface', ROOM.inkFaint, ROOM.surface],
  // The lightest ground in the room, and therefore the binding one. It is the
  // pair that caught the first fix being half a fix: 0.50 cleared 4.5:1 on the
  // room's own dark ground and read 3.96:1 here.
  ['faint on a raised room surface', ROOM.inkFaint, ROOM.surfaceRaised],
  ['muted on a raised room surface', ROOM.inkMuted, ROOM.surfaceRaised],
  ['ink on a raised room surface', ROOM.ink, ROOM.surfaceRaised],
  ['citron on the room ground', SIGNAL.citron, ROOM.bg],
  ['steelBright on the room ground', SIGNAL.steelBright, ROOM.bg],
]

describe('text tokens clear WCAG AA for normal text', () => {
  it.each(TEXT_ON_PAPER)('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it.each(TEXT_IN_ROOM)('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('the tokens that are fills, and the one that is display type', () => {
  it('citron is never legible as text on the cream, which is the point', () => {
    // Pinned as a REFUSAL, not an aspiration: the comment on SIGNAL.citron says
    // it is a fill that carries ink on top of it, and a future edit that made
    // it dark enough to write with would have quietly changed what it means.
    expect(contrast(SIGNAL.citron, PAPER.bg)).toBeLessThan(AA_NORMAL)
    expect(contrast(PAPER.ink, SIGNAL.citron)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('clay is display type only', () => {
    // The wordmark's full stop, and nothing smaller. Everything else that sets
    // clay-coloured words uses clayDeep — six call sites moved on 2026-09-16
    // because they did not.
    expect(contrast(SIGNAL.clay, PAPER.bg)).toBeGreaterThanOrEqual(AA_LARGE)
    expect(contrast(SIGNAL.clay, PAPER.bg)).toBeLessThan(AA_NORMAL)
  })

  it('warn fills and warnDeep is written in', () => {
    expect(contrast(SIGNAL.warn, PAPER.bg)).toBeLessThan(AA_NORMAL)
    expect(contrast(SIGNAL.warnDeep, PAPER.bg)).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

// The stylesheet declares the same palette a second time, as custom properties,
// because CSS cannot import a TypeScript object. Two declarations of one palette
// is a drift waiting to happen — and it has happened here before, which is why
// SIGNAL.warnDeep's own comment insists on carrying the CSS literal.
describe('globals.css and lib/design.ts declare the same palette', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

  /** The value of a custom property from the `:root` block. */
  function rootToken(name: string): string {
    const block = css.slice(css.indexOf(':root {'), css.indexOf('.pl-room {'))
    const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
    if (!match) throw new Error(`--${name} is not declared in :root`)
    return match[1].trim()
  }

  const PAIRS: [string, string][] = [
    ['pl-bg', PAPER.bg],
    ['pl-surface', PAPER.surface],
    ['pl-surface-sunken', PAPER.surfaceSunken],
    ['pl-ink', PAPER.ink],
    ['pl-clay', SIGNAL.clay],
    ['pl-clay-deep', SIGNAL.clayDeep],
    ['pl-on-clay', SIGNAL.onClay],
    ['pl-steel', SIGNAL.steel],
    ['pl-citron', SIGNAL.citron],
    ['pl-citron-deep', SIGNAL.citronDeep],
    ['pl-gain', SIGNAL.gain],
    ['pl-warn', SIGNAL.warn],
    ['pl-warn-deep', SIGNAL.warnDeep],
  ]

  it.each(PAIRS)('--%s matches its TypeScript token', (name, value) => {
    expect(rootToken(name).replace(/\s+/g, '')).toBe(value.replace(/\s+/g, ''))
  })
})

// ── Score bands ─────────────────────────────────────────────────────────────
//
// scoreBand() returns the colour for a score on /dashboard, /debrief and
// /progress. It used to return ONE colour for two jobs — filling a bar and
// writing a label — and the bright tones do not clear AA as text: an axe sweep
// found the band label under every score, and the score itself, at roughly
// two-thirds of the required ratio on all three surfaces.
//
// `textColor` is the AA-safe tone for the same band. These assert the property
// directly, at every band boundary, so the split cannot be collapsed back into
// a single field by someone who reads the two as redundant.
describe('score bands are legible as text', () => {
  // One score inside each band, including the boundaries themselves.
  const SCORES = [0, 34, 35, 54, 55, 74, 75, 100]
  const PAPER_GROUNDS: [string, string][] = [
    ['the page', PAPER.bg],
    ['a surface', PAPER.surface],
    ['a sunken surface', PAPER.surfaceSunken],
  ]

  for (const [groundName, ground] of PAPER_GROUNDS) {
    it.each(SCORES)(`a score of %i has a label readable on ${groundName}`, score => {
      expect(contrast(scoreBand(score).textColor, ground)).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }

  it('keeps the bright tone available for fills and the dark stage', () => {
    // .pl-db-dim__fill paints with `color`, and .pl-act__surfaced-n writes with
    // it on the dark reveal ground where the deep tones would be unreadable.
    // Both must keep getting the bright value, so the two fields stay distinct.
    expect(scoreBand(20).color).toBe(SIGNAL.clay)
    expect(scoreBand(60).color).toBe(SIGNAL.warn)
    expect(contrast(scoreBand(20).color, ROOM.bg)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('uses a deep tone only where the bright one actually fails', () => {
    // gain already clears AA, so 'Strong' keeps one colour for both jobs —
    // a deep variant there would be a change with no reading behind it.
    expect(scoreBand(80).textColor).toBe(scoreBand(80).color)
    expect(scoreBand(60).textColor).not.toBe(scoreBand(60).color)
    expect(scoreBand(20).textColor).not.toBe(scoreBand(20).color)
  })
})

// ── Signal colours at the places they are actually written ──────────────────
//
// The note at the top of this file says what it does not cover: "a component
// that puts a token on a ground it was never meant for is still a bug this file
// cannot see". An axe sweep of 24 routes on 2026-09-18 found five of exactly
// that, all of them a signal colour used as a WORD where the design system
// intends it as a FILL:
//
//   white on clay        the error screen, the 404 and the error boundary's
//                        "Try again" — 3.53:1. .pl-btn--primary had already
//                        been corrected for this; these three are inline-styled
//                        and were missed, so the rule only held on screens
//                        where nothing had gone wrong.
//   ink at 0.78 on clay  the landing page's closing paragraph, the last thing
//                        read before the final CTA — 3.86:1 settled. Alpha
//                        mutes toward the ground, and on a clay ground that is
//                        the wrong direction.
//   clay as text         the /progress movement figure and the /debrief moment
//                        labels — 3.13:1 on the cream.
//
// So these assert the SITES, not just the tokens. They are deliberately closer
// to a grep than the rest of the file: the failures above were never wrong
// arithmetic, they were a correct colour in the wrong job, and the only thing
// that catches that is looking at where it was written.

describe('signal colours are legible where they are written', () => {
  const appFile = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')

  /**
   * The declaration block for one rule, found by its literal selector.
   *
   * By indexOf rather than a built regex: these selectors carry dots, double
   * underscores and `--` modifiers, every one of which means something else to
   * a regex, and the selector names also appear in the prose above their own
   * rules. Searching for `<selector> {` is unambiguous and needs no escaping.
   */
  function rule(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`)
    if (at === -1) throw new Error(`No rule for ${selector}`)
    return css.slice(at, css.indexOf('}', at) + 1)
  }

  it('white is never a text colour, because white on clay fails AA', () => {
    // The reading that makes the rule: white is below AA on clay, onClay is not.
    expect(contrast('#ffffff', SIGNAL.clay)).toBeLessThan(AA_NORMAL)
    expect(contrast(SIGNAL.onClay, SIGNAL.clay)).toBeGreaterThanOrEqual(AA_NORMAL)

    // Clay is the only fill in this product a caller would reach for white on,
    // so no `color` in any page or component may be white at all. Five sites
    // were, on the three screens a user sees when something has broken.
    const sources = [
      'error.tsx',
      'not-found.tsx',
      'components/ErrorBoundary.tsx',
      'admin/page.tsx',
      'components/SkipLink.tsx',
    ]
    for (const path of sources) {
      const withoutComments = appFile(path).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(withoutComments, `${path} writes white as a colour`).not.toMatch(
        /color:\s*['"]#(fff|ffffff)['"]/i
      )
    }
  })

  it('the landing page writes full-strength ink on its clay field', () => {
    const css = readFileSync(new URL('../app/landing.css', import.meta.url), 'utf8')
    const flare = css.match(/--lp-flare:\s*([^;]+);/)![1].trim()
    const ink = css.match(/--lp-ink:\s*([^;]+);/)![1].trim()

    // The ground is clay and the token is the product's clay.
    expect(flare).toBe(SIGNAL.clay)
    expect(contrast(ink, flare)).toBeGreaterThanOrEqual(AA_NORMAL)

    // Neither rule on that field may reintroduce an alpha. Any value below 1
    // composites towards the clay and drops under AA — 0.78 measured 3.86:1 and
    // 0.72 measured 3.51:1, which is what these two rules used to carry.
    for (const selector of ['.pl-lp-close__p', '.pl-lp-field--flare .pl-lp-fine']) {
      const colour = rule(css, selector).match(/color:\s*([^;]+);/)![1].trim()
      expect(colour, `${selector} mutes its ink with alpha on a clay ground`).not.toMatch(/rgba/i)
    }
    expect(contrast('rgba(22, 24, 29, 0.78)', flare)).toBeLessThan(AA_NORMAL)
  })

  it('a moment is drawn in the bright tone and written in the deep one', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

    // Cost needs the split; gain does not, and saying so keeps a later edit
    // from inventing a --pl-gain-deep with no reading behind it.
    expect(contrast(SIGNAL.clay, PAPER.surface)).toBeLessThan(AA_NORMAL)
    expect(contrast(SIGNAL.clayDeep, PAPER.surface)).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrast(SIGNAL.gain, PAPER.surface)).toBeGreaterThanOrEqual(AA_NORMAL)

    // The two labels are the only `color:` consumers of the moment variable,
    // and both must read the ink half.
    for (const selector of ['.pl-db-moment__kind', '.pl-db-turn__note-kind']) {
      expect(rule(css, selector), `${selector} writes the fill tone`).toMatch(
        /color:\s*var\(--pl-moment-ink/
      )
    }
    // And the fills must keep the bright one.
    expect(rule(css, '.pl-db-turn[data-mark]::before')).toMatch(/background:\s*var\(--pl-moment,/)
    expect(rule(css, '.pl-db-turn[data-mark="cost"]')).toMatch(/--pl-moment-ink:\s*var\(--pl-clay-deep\)/)
  })

  it('the progress trend figure is written in a tone that clears AA', () => {
    const page = appFile('progress/page.tsx')
    const move = page.match(/pl-trend-overall__move[\s\S]{0,400}?color:\s*([^\n]+)/)![1]
    expect(move, 'the movement figure is written in bright clay').not.toMatch(/SIGNAL\.clay\b/)
    expect(move).toMatch(/SIGNAL\.clayDeep/)
    // The sparkline beside it is a stroke, so it keeps the bright tone.
    expect(page).toMatch(/<Sparkline[\s\S]*?color=\{SIGNAL\.clay\}/)
  })
})
