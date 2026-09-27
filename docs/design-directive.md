# Parley — design directive

The reconciled authority for Parley's visual system. Where this disagrees with
an older comment in a component, this wins and the comment should be corrected.

Everything here describes what the code actually does. It is a contract, not an
aspiration — if an entry stops being true, either the code or this file is a
bug, and the file is usually the easier one to check.

Tokens live in `lib/design.ts`, mirrored as CSS variables in `app/globals.css`.
Those two must agree; globals.css says so in its own header.

---

## 1. Identity

**Parley is the rehearsal room.**

A stage before the performance. The user is the actor. The counterpart is the
person across the table. The debrief is the director's notes.

The product is not a chat app, an assistant, a dashboard, or a tool with AI in
it. AI is infrastructure here, the way a database is infrastructure. It is
never the visual identity, never named in the interface, and never illustrated.

**Mood:** composed, quiet, weighty, warm.
**Never:** playful, futuristic, flashy, magical.

The thing the interface has to communicate before any copy is read:

> I am here to practise something that matters.

### What the product is actually about

A rehearsal is an information problem wearing the clothes of a conversation.
The counterpart holds a mandate the user cannot see; the whole skill is
surfacing it before conceding. Every design decision below exists to keep that
asymmetry legible — which is why redaction, not colour, is the product's
central image.

---

## 2. Two registers

The product renders in two visual registers. This is a product decision, not a
theming feature, and the split must not be collapsed.

### PAPER — everything outside a live rehearsal

Light, editorial, tactile. You are reading, planning, choosing, reviewing.
Prep headspace. You are working *from* a document, against one you cannot read,
and the ground says so.

| | |
|---|---|
| Ground | `#f7f2e7` cream — not white |
| Surface | `#fffdf8` |
| Sunken | `#ece4d4` |
| Ink | `#16181d` |
| Character | hard offset shadows, square-ish corners, print physicality |

### ROOM — the live rehearsal only

Dark, close, clock running. Fewer controls, less navigation, one obvious
action.

| | |
|---|---|
| Ground | `#0d222c` steel-deep — **not** a neutral black |
| Surface | `#123040` |
| Raised | `#17394b` |
| Ink | `#f7f2e7` — the same cream, now as text |
| Character | depth from light and surface contrast, not from offset edges |

### The transition is the point

Crossing into the room should feel like a door closing behind you. It is not a
light/dark toggle and must never be exposed as one. There is no theme switch in
this product and there should never be.

The room's ground is the landing page's deepest steel rather than a neutral
black, so entering reads as *going further into the same world* rather than
flipping a theme. `--pl-room-ground` is defined at `:root` because `<body>` sits
behind the room during overscroll and also has to be painted with it.

Scoping is by `.pl-room`, never by `@media (prefers-color-scheme)` and never by
a class the user can set. It is a place you enter, not a preference you hold.

---

## 3. Colour

Three colours carry meaning. Nothing else is allowed to.

| Token | Value | Means |
|---|---|---|
| **Clay** | `#f0522e` | **You.** Your objective, your turns, the primary action, pressure. |
| **Steel** | `#2c4c66` | **Them.** Their turns, their role, anything they are holding. |
| **Citron** | `#dcf25c` | **A thing you found out.** Appears at exactly one moment. |

**Clay is never used for anything the counterpart does.** In a transcript you
can tell your side from theirs without reading a word, and that is the point.

Clay is the signature: a hot orange-red where every other tool in the category
reaches for blue or violet.

Citron appears when information the counterpart was holding becomes visible —
the mandate reveal — and nowhere else. That scarcity is what stops it becoming
decoration. It is a **fill that carries ink on top of it**, or a rule, never
text on cream: at `#dcf25c` it has nowhere near the contrast.

### Clay does two jobs

Clay is both the user's role colour and the primary-action colour. This is
deliberate: in a product about your own leverage, "this is your move" and "this
is the button" are the same statement. There is no separate action accent, and
adding one would mean the product's loudest colour no longer means *you*.

### Semantic colours

`gain` / `warn` and the score bands carry meaning only. They are never
decorative and never used to brighten a layout.

Warn works as a fill and a rule. As small **text** on its own soft ground it
only reaches about 3.6:1, so warn-coloured words use `--pl-warn-deep`
(`#8a5f0c`), which clears 4.5:1.

### Restraint

Most of the interface is quiet. The accent is powerful because it is rare. A
screen where three things are clay has no primary action.

---

## 4. Typography

A closed set. A size that is not on it is a bug, not a judgement call —
14.5px next to 13.5px is the specific thing that makes an interface read as
assembled rather than designed.

| Step | Size | Job |
|---|---|---|
| `display` | clamp 34→60 | landing hero |
| `h1` | clamp 26→40 | page titles |
| `h2` | clamp 19→28 | section titles |
| `h3` | 17 | small headings |
| `lead` | 18 | ledes |
| `prose` | 17 | long-form reading surfaces only |
| `moment` | clamp 22→34 | the mandate at the instant it unseals, and nothing else |
| `body` | 15 | everything in a screen |
| `small` | 13 | secondary |
| `caption` | 12 | metadata |
| `micro` | 11 | **floor** — tracked-caps labels |

`micro` is a floor and is enforced. Every tracked-caps label — a speaker's name
in a transcript, a file tab, a unit beside a figure — is set from that one
token. Nothing in the product is smaller.

`prose` is not a new step; it is `h3`'s 17px under a name that says what it is
for. 15px on a 680px measure is right for a UI label and slightly too small to
read four hundred words in.

### Families

* **Inter** — UI
* **Source Serif** — reading surfaces, page titles, the user's own words
* **IBM Plex Mono** — figures, labels, the room clock; tabular so a running
  timer does not jitter

All three are self-hosted in `app/fonts`, not fetched from Google at build
time. A build should not fail because a CDN is slow.

### Hierarchy over uniformity

The scale is closed; the *composition* is not. Important information gets a
larger step. Never shrink something that matters to preserve a layout — change
the layout.

---

## 5. Surfaces, shadows and depth

Depth is a hierarchy with a small number of steps, not a texture applied
everywhere. A shadow means *this surface is physically elevated*, never *this
is a modern card*.

### PAPER

The **hard offset shadow** is the signature: a solid edge with no blur, the way
a stamped or pasted-on object throws one. It is most of the product's physical
character, and it is why a surface reads as an object sitting on a file rather
than a div floating over a background.

Offsets are cast **in the object's own colour family, never in black** — a clay
panel throws deep clay, a steel one throws deep steel. Black offsets look like
a preset; these look lit.

A slab presses *into* the page under the cursor — the shadow shortens and the
surface moves to meet it — which reads as something you pushed.

### ROOM

Offsets disappear on `#0d222c`, so hierarchy there comes from light, surface
contrast, borders and spacing. The room's hard edge, where used, goes to the
deepest steel in the family rather than to ink.

### Restraint

Not every section needs border + radius + shadow + background. Typography and
whitespace are frequently the correct answer, and removing a box is more often
right than adding one.

---

## 6. Geometry

Radii are small and there are three: 2px, 4px, 7px.

Rounded-everything is the fastest way to look like every other product. Keeping
corners tight lets the deliberately square edges — redaction bars, index rules,
file tabs — read as decisions rather than oversights.

**No pills.** A pill would be the one rounded thing on a page of hard edges.
Chips, badges and toggles are squared and ruled.

---

## 7. The redaction

The product's central image and its one piece of theatre.

A block of redaction bars stands for what the counterpart is holding. It is
**drawn from nothing** — synthetic shapes, no text behind it at any point.
Covering real text with a black rectangle would leave it selectable and
readable in the DOM, which for this particular secret would defeat the product.

At the reveal, the bar does not fade. It **slides off the text** it was
covering. The text is mounted only on the debrief, a screen reachable only once
the rehearsal has ended.

This is the one moment citron appears.

---

## 8. Motion

Short, decelerating, deliberate. The product's claim is that a rehearsal is a
place with a clock running, so movement is never decorative.

| Token | Duration |
|---|---|
| `instant` | 80ms |
| `fast` | 140ms |
| `base` | 200ms |
| `slow` | 320ms |
| `stage` | 560ms — a scene change: the door and the curtain only |

Easing: `cubic-bezier(0.22, 0.61, 0.36, 1)` for most things. One entrance curve
with overshoot exists and is for things *arriving*, never for hover.

Motion should say **the room changed**, not *look at this animation*.

**Never:** infinite loops, floating elements, parallax, bouncing cards, spring
physics, glowing pulses, spinners where a determinate sweep would tell the
truth.

`prefers-reduced-motion: reduce` is honoured last in the stylesheet so it wins
over every transition declared above it.

---

## 9. Prohibitions

Non-negotiable, and mostly about not looking like the 500 products this one
sits beside in a search result.

**Never:**

* sparkles, wands, stars, robots, neural graphics, "AI-powered" anything
* glassmorphism, glowing borders, animated gradients, mesh blobs
* generic chat bubbles with assistant avatars
* emoji as UI icons
* fake testimonials, logos, metrics, customers, urgency or scarcity
* a rainbow of accent colours
* the same shadow on every card
* decorative charts that communicate nothing
* startup language: "unlock", "revolutionise", "next-generation", "transform
  your conversations", "the future of"

**Business facts** — legal entity, address, support email, domain, payment
descriptor, prices asserted as real — must never be invented. Where a page
needs one, render the `Configure` marker instead, so an unconfigured value
cannot be mistaken for a real one.

---

## 10. Per-screen intent

What each screen is for, what the user should notice first, and what should
follow. Compositions are judged against these.

| Screen | Job | Notice first | Then |
|---|---|---|---|
| **Landing** | Make the asymmetry legible in one viewport | The rep has rehearsed this; you have not | Open the library |
| **Library** | Choose the deal closest to yours | Which conversation this is | Open a brief |
| **Brief** | Build tension; separate known from unknown | What you are walking into | Enter the room |
| **Room** | Make instincts show up under pressure | What they just said, and the clock | Answer |
| **Debrief** | Reframe, then score | What they were actually holding | Run it again |
| **Progress** | Am I getting better, and at what | The dimension that is stuck | Rehearse that |
| **Playbook** | What I know about my own negotiating | Your own sentences | Read before walking in |
| **Dashboard** | Readiness for a dated conversation | The date that is coming | Rehearse it |
| **Pricing** | Make the trade legible | What is in each | Start free |

### The room gives no feedback

No score ticking up, no hints, no praise, no acknowledgement that it is a
simulation. Live feedback would train people to negotiate while watching a
meter, which is not available in the real meeting. All feedback belongs in the
debrief.

The phase strip is not an exception: it reports how much of the expected length
is gone, which is what a clock on a wall tells you, and says nothing about how
the user is doing.

### The debrief leads with the reveal

Reading order is deliberately the opposite of a dashboard's: the mandate reveal
comes **first, before any score**. Learning what was actually available reframes
everything under it — a 61 reads very differently once you know they had nine
per cent in their pocket the whole time. Leading with the number turns the page
into a grade.

### The loop is the product

Rehearse → debrief → learn → rehearse again. The second rehearsal is where
Parley becomes valuable, so "run it again" is a designed conclusion, not a
trailing button.

---

## 11. Scoring

Five dimensions, 0–100, and both of those numbers are fixed.

Anchoring · Concession pace · Information gain · Composure · Close.

A sixth dimension is a real product decision, not a config change — the debrief
prompt, the charts and the history all assume exactly five. A 0–10 scale is not
a design variant; `scoreBand()` bands at 75 / 55 / 35 and the progress trend
depends on it.

**Information gain** is the strongest concept in the product and should read as
a negotiation insight, never as a game score. It is the measure of how much of
the mandate the user surfaced before conceding — the thing the whole
architecture exists to make possible.

---

## 12. Interaction and accessibility

Not a separate pass. Part of the design.

* Every interactive thing has hover, focus, active and disabled states.
  Disabled is **drawn, not dimmed** — fading clay to 40% produces mud.
* `:focus-visible` is always visible and never removed for aesthetics.
* Minimum touch target 24px; controls are sized far enough apart to read as
  hierarchy rather than noise.
* Semantic headings, real labels on every field, `scope` on table headers.
* A link inside a sentence carries a resting underline. Colour cannot do this
  job alone — clay against muted ink is about 1.2:1.
* Contrast is checked, not eyeballed, and the figures are written down where
  they were hard-won.
* Horizontal overflow is a bug at every width. Tables may scroll inside their
  own container; the page body may not.

---

## 13. How to judge a screen

Token compliance is the floor, not the goal. A consistent product can still
look ordinary. Ask, in this order:

1. What is the user's job here?
2. What should they notice first — and do they?
3. Is the hierarchy readable in three seconds?
4. Is there one dominant action, or ten equal ones?
5. Is anything important small to preserve a layout?
6. Is anything shouting without earning it?
7. Could this section appear unchanged in someone else's product?

The last question is the sharpest. If the answer is yes, it is not finished.

---

## 14. The three states, and the two crossings

The product is designed around what the user is feeling, in order, and each
state has its own register.

| State | Where | Feeling | Register |
|---|---|---|---|
| **Threshold** | landing, library, brief | anticipation, composure, slight tension | PAPER |
| **Room** | the live rehearsal | presence, uncertainty, consequence | ROOM |
| **Reveal** | the first act of the debrief | release, then discovery | ROOM, lifting to PAPER |

The states are joined by two crossings, and both are staged rather than
navigated. Each is a client-side transition with a dark route fallback under
it (`app/room/[id]/loading.tsx`, `app/debrief/[id]/loading.tsx`) so cream
never flashes between two dark surfaces.

### The door — brief → room

The brief ends on the door: the last block of the page is drawn in the room's
register (`.pl-door`, the `.pl-room` scope on a paper page), carrying the same
sealed block that waits inside. Pressing it closes a plane in the room's
ground over the viewport (`.pl-door-close`, `stage` duration, rising from the
bottom edge) while the room is opened on the server. The two finish together.
A refusal opens the door again and says why.

### The room, briefly

* **Two voices, not two columns of bubbles.** Theirs in the serif at `prose`,
  inset and ruled in steel; yours in the sans at `body`, flush and ruled in
  clay. Tell the sides apart in a thumbnail.
* **The composer is the transcript's next line.** Your label, a rule down the
  left, the words after it. No box, no resize handle; it grows with the
  sentence. The rule goes from faint to solid clay under focus — that is the
  focus indicator, and it is three pixels so it cannot be missed.
* **Presence, not typing dots.** Before a reply, the counterpart's name is on
  the page and a single steel rule breathes where their words will go. When
  the first token lands the label stays and the rule becomes the sentence.
* **Ending is a still beat.** The dialog closes, the composer drops away, the
  transcript recedes, the live mark stops, and nothing happens for `stage`
  before the debrief opens. The pause is what lets the reveal land.

### The curtain — room → reveal → debrief

The debrief opens in the room's register, as a plane over the viewport
(`.pl-act`). While the transcript is scored it holds the sealed block from the
room. When the debrief lands, each sentence of the mandate mounts under its
own bar and the bars slide off in order, top to bottom, in `moment` type;
what you surfaced settles in under them; then the way out. Continuing lifts
the plane upward off the page and the paper debrief is what was underneath.

The reveal plays **once**: the room leaves a note as it ends
(`lib/revealHandoff.ts`), the debrief takes it. Reopened from the dashboard,
a debrief is a record, and a record does not re-stage its own unsealing — the
paper copy of the mandate lifts its bar there instead, and only there. The
note carries no mandate content; the text still arrives only from
`/api/debrief` for an ended rehearsal.

### The scorecard is a ledger

Five ruled rows on the paper, not five cells in a box: the index in the
gutter, the dimension and the question it asks, the figure at `lg` with its
band under it and a bar as the reading of it, and the note that cites the
transcript. Scan down the figure column; read across the row.

### The transcript is annotated

Lines the scorer named carry a mark in the gutter and the note in the margin.
Every other line is left alone, which is what lets the marked ones read.

### The archive

The dashboard's record is a dated list: when, which deal, against whom, what
it came to, and the way to run it again. The whole row opens the record; the
repeat action is its own target.
