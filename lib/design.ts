// Parley design tokens.
//
// The app renders in two distinct visual registers, and that split is a
// product decision, not a styling accident:
//
//   PAPER  — everything outside a live rehearsal. Light, editorial, calm.
//            You are reading, planning, reviewing. Prep headspace.
//   ROOM   — the live rehearsal only. Dark, close, timer running.
//            Crossing into it should feel like a door closing behind you.
//
// Components pick a register explicitly via PAPER or ROOM below. Anything
// shared between the two (scores, dimension colors) lives in SIGNAL.

export const PAPER = {
  // Cream, not white, and the same cream the landing page is built on — see the
  // --lp-* block in app/landing.css, which this deliberately matches so the
  // marketing surface and the product are visibly one thing. You are working
  // FROM a document, against one you cannot read, and the ground says so.
  bg: '#f7f2e7',
  surface: '#fffdf8',
  surfaceSunken: '#ece4d4',
  ink: '#16181d',
  inkMuted: 'rgba(22,24,29,0.66)',
  // Raised from 0.40, which was 2.48:1 on this ground. See the note on
  // --pl-ink-faint in app/globals.css; inkFaintLine keeps the old value for
  // rules and borders, which are not text and do not have a contrast floor.
  inkFaint: 'rgba(22,24,29,0.62)',
  inkFaintLine: 'rgba(22,24,29,0.40)',
  line: 'rgba(22,24,29,0.14)',
  lineStrong: 'rgba(22,24,29,0.26)',
} as const

export const ROOM = {
  // The room is not "dark mode". It is a different place: a lit table in an
  // unlit room. The ground is the landing page's --lp-steel-deep rather than a
  // neutral black, so crossing into the room reads as going further into the
  // same world rather than flipping a theme.
  bg: '#0d222c',
  surface: '#123040',
  surfaceRaised: '#17394b',
  ink: '#f7f2e7',
  inkMuted: 'rgba(247,242,231,0.66)',
  // Raised from 0.38 for the same reason. The binding ground is not the room's
  // bg but surfaceRaised, the lightest of the three: 0.50 clears 4.5:1 there and
  // 0.38 does not, which tests/contrast.test.ts caught. 0.58 clears all three.
  inkFaint: 'rgba(247,242,231,0.58)',
  inkFaintLine: 'rgba(247,242,231,0.38)',
  line: 'rgba(247,242,231,0.13)',
  lineStrong: 'rgba(247,242,231,0.24)',
} as const

// Clay is the product's one loud color: it marks pressure, the live state,
// and the primary action. Steel is the counterpart's color — it is never
// used for anything the user themselves does, so at a glance in a transcript
// you can tell your side from theirs without reading a word.
export const SIGNAL = {
  // Three colours carry meaning and nothing else is allowed to. These are the
  // landing page's --lp-flare / --lp-steel / --lp-citron, adopted verbatim so
  // the product and the page that sells it share one identity.
  //
  //   CLAY    is you. Your objective, your turns, the primary action, pressure.
  //   STEEL   is them. Their turns, their role, anything they are holding.
  //   CITRON  is a thing you found out. It appears at exactly one moment in the
  //           product — when information the counterpart was holding becomes
  //           visible — which is what stops it becoming decoration.
  //
  // Clay is the signature: a hot orange-red rather than the blue or violet
  // every other tool reaches for.
  //
  // Every -deep is the paired SHADOW tone for its own surface. Shadows in this
  // product are cast in the object's own colour family, never in black, which
  // is what keeps a hard offset edge from looking like a drop-shadow preset.
  clay: '#f0522e',
  clayDeep: '#8c2a13',
  clayBright: '#f0522e',
  claySoft: 'rgba(240,82,46,0.12)',
  /**
   * Text on a clay fill, in either register. White on clay computes to
   * 3.5:1 and fails AA for button text; paper ink on the same clay is 5.0:1,
   * and it is what the landing page's buttons already do. Clay is the same
   * colour on cream and on steel, so this does not flip with the register —
   * which is why it is a literal here and not `PAPER.ink`.
   */
  onClay: '#16181d',

  steel: '#2c4c66',
  steelDeep: '#0d222c',
  steelBright: '#4e8cbc',
  steelSoft: 'rgba(44,76,102,0.10)',

  /**
   * Discovery. Reserved for information the user earned.
   *
   * Never set as text on cream — at #dcf25c it has nowhere near enough contrast.
   * It is a FILL that carries ink on top of it, or a rule. That constraint is
   * why it reads as a highlighter rather than as a colour scheme.
   */
  citron: '#dcf25c',
  citronDeep: '#667319',
  citronSoft: 'rgba(220,242,92,0.22)',

  gain: '#2c6249',
  gainSoft: 'rgba(44,98,73,0.13)',
  warn: '#a8730f',
  warnSoft: 'rgba(168,115,15,0.12)',
  /**
   * Amber as TEXT on a paper surface. `warn` itself is 4.0:1 on cream, which
   * clears AA for a large heading and fails it for the 11px label it is
   * actually used on; this is 6.1:1 and reads as the same amber. Same split as
   * `clay`/`clayDeep` and `citron`/`citronDeep` — the bright one fills, the
   * deep one is written in.
   *
   * Was #8a5f0c. That cleared 4.5:1 on the cream and measured 4.43:1 on the
   * sunken surface the `[configure: …]` marker sits on — so the one token whose
   * whole job is "passes AA as text" did not, on one of its two grounds.
   *
   * The literal is shared with `--pl-warn-deep` in app/globals.css. Two
   * different hexes under one token name is the drift that makes an interface
   * read as assembled rather than designed, so this is the CSS value rather
   * than a second opinion of it.
   */
  warnDeep: '#7a5309',
} as const

// The three families are loaded and self-hosted by next/font in app/layout.tsx,
// which owns these variables. Referencing them through the variable rather than
// naming the family means a font swap is one line in the layout, and means the
// same token works inside .pl-room without a second definition. The literal
// fallbacks are there for the case where the variable never lands.
export const FONT = {
  sans: 'var(--pl-font-sans, system-ui, -apple-system, sans-serif)',
  serif: 'var(--pl-font-serif, Georgia, serif)',
  mono: 'var(--pl-font-mono, ui-monospace, monospace)',
} as const

// A closed set. Eight steps, and a size that is not one of them is a bug, not
// a judgement call — 14.5px next to 13.5px is the specific thing that makes an
// interface read as assembled rather than designed. The three largest steps are
// fluid because they carry the page; everything below body is fixed, because
// captions that scale with the viewport stop being captions.
export const TYPE = {
  display: 'clamp(34px, 3.6vw + 16px, 60px)',
  h1: 'clamp(26px, 2.4vw + 14px, 40px)',
  h2: 'clamp(19px, 1.4vw + 12px, 28px)',
  h3: '17px',
  lead: '18px',
  /**
   * Long-form reading surfaces only — the about page, the FAQ, the legal
   * pages, a playbook note. Not a new step: it is `h3`'s 17px under a name
   * that says what it is for, because 15px body on a 680px measure is a
   * perfectly good size for a UI label and slightly too small to read four
   * hundred words of prose in. Anything that is a paragraph inside a screen
   * rather than a page of prose still uses `body`.
   */
  prose: '17px',
  /**
   * Moment type. The one step between h2 and h1 that is for a paragraph
   * rather than a title: the mandate at the moment it unseals is three or four
   * sentences of prose that have to carry a whole screen on their own, and h2
   * is too small to be an event while h1 is too large to be read as sentences.
   * Reserved for that reveal and nothing else — a second use is a sign the
   * hierarchy of the screen it is on has gone wrong.
   */
  moment: 'clamp(21px, 1.2vw + 12px, 30px)',
  body: '15px',
  small: '13px',
  caption: '12px',
  micro: '11px',
} as const

// Line heights are paired with the step, not chosen per component. Display type
// sets tight, body sets open enough to read a paragraph of prose in.
export const LEADING = {
  display: 1.08,
  heading: 1.2,
  body: 1.55,
  prose: 1.68,
} as const

export const TRACKING = {
  display: '-0.03em',
  heading: '-0.02em',
  body: '0',
  caps: '0.1em',
} as const

// Small radii, and one square. Rounded-everything is the single most reliable
// way to look like every other product; keeping corners tight lets the few
// deliberately square edges — the redaction bars, the index rules — read as a
// decision rather than an oversight.
export const RADIUS = { none: 0, sm: 2, md: 4, lg: 7 } as const

// Two shadow languages, used for different jobs.
//
//   SOFT   is atmosphere. Something is above the page.
//   HARD   is print. A solid offset with no blur, the way a stamped or
//          pasted-on object throws an edge. It is what makes a surface look
//          like an object sitting ON the file rather than a div floating over
//          a background, and it is most of the product's physical character.
export const SHADOW = {
  raised: '0 1px 2px rgba(20,18,15,0.07), 0 4px 12px rgba(20,18,15,0.06)',
  lifted: '0 2px 4px rgba(20,18,15,0.08), 0 14px 30px rgba(20,18,15,0.10)',
  modal: '0 10px 44px rgba(20,18,15,0.24)',
  /**
   * Offset block shadow. The signature.
   *
   * Cast in the object's own colour family rather than in black — a clay panel
   * throws a deep-clay edge, a steel one throws deep steel. Black offsets look
   * like a preset; these look like the object is lit.
   */
  hard: '4px 4px 0 #16181d',
  hardSm: '2px 2px 0 #16181d',
  hardClay: '4px 4px 0 #8c2a13',
  hardSteel: '4px 4px 0 #0d222c',
  hardCitron: '4px 4px 0 #6e7c1f',
} as const

// ── Space, layout and controls ──────────────────────────────────────────────
//
// Everything below exists for the same reason as TYPE: to make the obvious
// choice the consistent one. Reach for a token first; a raw number in a style
// object should be rare enough to be worth a second look in review.

/** 4px base. Vertical rhythm and gaps both come from here. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  section: 48,
  sectionLg: 72,
} as const

/**
 * Container widths. Four, not ten. `reading` is capped where it is because
 * briefs, debriefs and playbook entries are long-form prose and a 1160px
 * measure is unreadable at body size.
 */
export const LAYOUT = {
  page: 1160,
  narrow: 1000,
  reading: 680,
  form: 420,
  gutter: 24,
} as const

/**
 * Control metrics for buttons, inputs and selects. Mirrored by --pl-control-*
 * in globals.css; the two must agree. Sizes are deliberately far apart — the
 * old code had four button paddings within 2px of each other, which reads as
 * noise rather than as hierarchy.
 */
export const CONTROL = {
  sm: { height: 30, padX: 12, font: TYPE.small },
  md: { height: 38, padX: 18, font: TYPE.body },
  lg: { height: 48, padX: 26, font: TYPE.body },
} as const

/**
 * Motion. The product's whole claim is that a rehearsal is a place with a clock
 * running, so movement has to feel deliberate rather than decorative: short
 * durations, a decelerating curve, nothing that bounces. `entrance` is the only
 * curve with overshoot and it is for things arriving, never for hover.
 *
 * globals.css disables all of it under prefers-reduced-motion.
 */
export const MOTION = {
  instant: '80ms',
  fast: '140ms',
  base: '200ms',
  slow: '320ms',
  /**
   * A scene change, not a state change: the door closing over the brief as
   * you enter the room, and the curtain lifting off the reveal to show the
   * debrief. Long enough to read as a place changing, and used for exactly
   * those two crossings — anything inside a screen uses `slow` or faster.
   */
  stage: '560ms',
  out: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  entrance: 'cubic-bezier(0.34, 1.28, 0.64, 1)',
} as const

/** Stacking order, so nothing is ever fixed by trying a bigger number. */
export const Z = {
  base: 0,
  raised: 10,
  sticky: 100,
  overlay: 500,
  modal: 600,
  toast: 700,
} as const

/**
 * Score bands shared by the debrief, the progress charts and the dashboard.
 *
 * Explicitly NOT the room. There is no live meter in a rehearsal and there must
 * not be one — a score moving while you talk trains people to negotiate while
 * watching it, which is not on offer in the real meeting. This comment used to
 * say "and the room's live meter", describing a surface that does not exist and
 * inviting the one change the product is built to refuse.
 *
 * TWO COLOURS, BECAUSE A BAND IS BOTH DRAWN AND WRITTEN.
 *
 *   color      fills and strokes: a bar, a rule, a sparkline, and the figures
 *              on the DARK reveal stage, where the bright tone is the legible
 *              one.
 *   textColor  the same band set as WORDS on paper.
 *
 * They differ because the bright tones do not clear AA as small text on this
 * product's grounds, and the score is the one thing on these screens a user
 * came to read. Measured against cream / surface / sunken: gain is 6.38 / 7.00
 * / 5.63 and needs no deep variant; warn is 3.67 / 4.03 / 3.24 and clay is
 * 3.16 / 3.47 / 2.79, all below the 4.5 a normal-size label requires. Their
 * deep tones clear it comfortably — warnDeep 6.13 / 6.73 / 5.41, clayDeep 7.66
 * / 8.41 / 6.77.
 *
 * This is the same rule the token block above already states — "the bright one
 * fills, the deep one is written in" — applied to the one call site that was
 * still returning a single colour for both jobs. An axe sweep found it on
 * /dashboard, /debrief and /progress: the band label under every score, and the
 * score itself, were being drawn at roughly two-thirds of the required ratio.
 */
export function scoreBand(score: number): { label: string; color: string; textColor: string } {
  if (score >= 75) return { label: 'Strong', color: SIGNAL.gain, textColor: SIGNAL.gain }
  if (score >= 55) return { label: 'Workable', color: SIGNAL.warn, textColor: SIGNAL.warnDeep }
  if (score >= 35) return { label: 'Leaking', color: SIGNAL.clay, textColor: SIGNAL.clayDeep }
  return { label: 'Costly', color: SIGNAL.clay, textColor: SIGNAL.clayDeep }
}
