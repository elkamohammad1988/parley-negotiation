# Parley — product direction

The commercial decision the product is built around, and the reasoning behind
it. Written 2026-09-11. Everything here is either checkable in the codebase or
sourced to a page that was read on that date.

Nothing in this document claims traction, revenue, customers or usage. Parley
has none of those and no surface in the product says otherwise.

---

## 1. Chosen target customer

The person inside a company who owns a software or vendor contract at renewal:

* **Primary user** — procurement / vendor management lead, IT asset manager, or
  the finance-ops person who actually takes the renewal call. At a company too
  small to have a procurement function this is the IT director or the CFO.
* **Economic buyer** — Head of Procurement, VP Finance, or CIO. They already
  hold a budget for software spend management and already measure themselves on
  what renewals cost.

Deliberately **not** the vendor's sales rep. See §3.

---

## 2. Chosen use case

**Rehearsing the vendor negotiation from the buyer's chair**, before the real
call. The six briefs in `lib/negotiation/scenarios.ts` are the spine of it:

| Brief | The move being trained |
| --- | --- |
| A 22% uplift on your largest software renewal | Holding an anchor against a "standard adjustment" that is not standard |
| Testing a "best and final" price | Telling an approval limit apart from a floor |
| Negotiating after the cancellation window closed | Recovering value when you have no legal leverage |
| Untangling an upsell from a renewal | Refusing to price two decisions as one number |
| The vendor went over your head | Taking the commercial conversation back without burning your own exec |
| Using an alternative you could not actually take | Converting a weak BATNA honestly, and what happens when you overstate it |

---

## 3. Why this was selected

### The asymmetry is documented, extreme, and is exactly Parley's mechanic

The Business Negotiation Academy's software-procurement writing states the gap
plainly: the vendor's account executive "will run your category of deal a
hundred and fifty to two hundred times this year" and their employer "puts them
through four to six weeks of paid training annually, and a meaningful share of
that training is specifically about negotiating against procurement." Behind
them sits "a discount matrix, a deal desk, an approval ladder and a quarter-end
clock." The buyer "closes somewhere between forty and sixty deals a year across
dozens of suppliers" with "a spreadsheet and a stakeholder who has already
decided."

That is a preparation gap and an information gap. Parley's entire architecture
is a preparation-and-information-gap machine: `Scenario.hiddenMandate` is
server-side-only until a rehearsal ends, and the Information gain dimension
scores how much of it the user surfaced before they conceded. No repositioning
was needed to make the mechanic fit. The mechanic already *was* the problem.

The same source enumerates the vendor plays — strategic silence, the high
anchor, "that's our best price" (an approval limit, not a floor), the exploding
deadline, deal-desk theatre, scope expansion folded into a renewal, escalation
over the negotiator's head. Each built-in scenario and counterpart tactic in
this repo is drawn from that list rather than invented.

### The problem is frequent, expensive and dated

Renewal volume is structural, not occasional: SaaS portfolios are reported at
118 applications per company on one 2026 measure and 305 on another, growing
30%+ annually, with per-employee SaaS spend up ~22% year over year "driven
almost entirely by AI line items and aggressive price hikes at renewal." Every
one of those contracts has a date on it. Sources disagree on the exact counts —
which is why the product asserts none of these numbers on any marketing
surface.

The ROI arithmetic is the cleanest available in this category: a single
six-figure renewal negotiated a few points better pays for the product many
times over, and the saving lands in a number the buyer already reports on.

### The competition is all pointed the other way

The AI-roleplay category is real and funded — Second Nature raised a $22M
Series B in October 2025; Hyperbound, Outdoo, Kendo, LavenirAI and others
compete alongside it. But their scenario catalogues are seller-side: cold
calls, gatekeepers, discovery, demos, objection handling, and renewal calls
*run by the vendor's own CSM*. Hyperbound's renewal material is explicitly for
"customer success and account management teams."

Competing head-on as another AI sales-roleplay tool would be the weakest
available position. Training the other side of the same call is an open lane,
and it is the lane this codebase was already built for.

### It scores well against every criterion that was set

Frequency: high — dozens of renewals a year per company. Financial impact:
direct and measurable. Urgency: renewal dates are hard deadlines. Repeatability:
every cycle. Willingness to pay: the buyer already funds spend-management tools.
Ease of explanation: one sentence. Demo-ability: one brief and one room. Fit
with the existing architecture: total — the change was content and copy, not
engineering.

### What was considered and rejected

* **Seller-side sales negotiation training.** Larger budget category, but
  crowded with funded incumbents, muddier attribution, and it would have made
  Parley the fifth-best version of something rather than the only version of
  something.
* **Salary and promotion conversations.** Consumer willingness to pay, no
  repeat purchase, no institutional buyer. The original library leaned here.
* **Leadership / difficult-news / HR conversations.** Real problem, but the
  outcome is unmeasurable, which removes the ROI argument that makes the buy
  easy.
* **Everything at once.** Explicitly rejected. A library spanning pay,
  fundraising, clients, vendors and internal politics describes a general
  "conversation practice" tool, and general tools are what an AI demo looks
  like.

### Evidence

* Business Negotiation Academy — *Software Negotiation Asymmetry* and *Twelve
  Moves Your Software Vendor Has Already Rehearsed* (negotiationacademy.com),
  read 2026-09-11. Source of the 150–200 vs 40–60 deal counts, the training
  figures, and the vendor tactic list.
* Second Nature $22M Series B, October 2025 (finance.yahoo.com).
* Hyperbound product pages on cold call / discovery / post-sales roleplay
  (hyperbound.ai), read 2026-09-11.
* SaaS portfolio and spend figures: Zylo and CloudZero 2026 statistics
  round-ups, read 2026-09-11. Cited here as background only; not asserted in
  the product.

---

## 4. Product positioning

> Parley is where the person who owns a software renewal rehearses the call
> before the vendor's rep runs it on them for the two hundredth time.

Answering the five questions directly:

* **Who** — procurement, IT and finance-ops leads who own vendor contracts.
* **What conversation** — the renewal, the uplift, the "best and final", the
  escalation, the exit that is not really available.
* **Why existing preparation is insufficient** — benchmark data tells you what
  a fair price is. It does not tell you what happens in your own mouth nine
  seconds after they go quiet.
* **What Parley lets them practise** — finding the vendor's real authority
  before conceding, holding an anchor, trading rather than donating
  concessions, and closing on a number, an owner and a date.
* **What they get** — a scored debrief on five dimensions, the moments that
  cost them, a concrete better line for each, and the vendor's actual mandate
  revealed at the end as a ledger: how many of the things on the table they
  surfaced, which ones they missed, and the question that would have opened
  each miss.

---

## 5. Core user journey

```text
Brief          The quote, your objective, your real constraints — and a sealed
               block where the vendor's mandate is, with one bar per thing
               behind it. The count is stated; the contents are not.
Room           They open. The clock runs. Nothing on screen scores you, because
               nothing will on the day.
Debrief        Mandate unsealed as a ledger — two of five found, three missed,
               and what each miss would have taken. Then five scores, key
               moments, one change to make.
Again          Same deal, different person on the call.
```

The loop is the product. `Again` is a first-class action on the debrief, the
brief page counts prior attempts, and the counterpart bench exists so the second
run is genuinely different rather than a retry.

---

## 6. Design principles

Defined in `lib/design.ts` and `app/globals.css`; the reasoning lives beside the
tokens there. In short:

1. **Two registers.** PAPER for everything outside a live rehearsal — light,
   editorial, calm. ROOM for the rehearsal itself — dark, close, timer running.
   Crossing between them should feel like a door closing.
2. **Colour carries exactly three meanings.** Clay is you. Steel is them.
   Citron is a thing you found out, and appears at precisely one moment in the
   product. Nothing else is allowed to mean anything.
3. **Objects, not cards.** Hard offset shadows cast in the object's own colour,
   tight radii, squared edges. A surface should look like something sitting on
   a file, not a div floating over a background.
4. **The redaction is the one central image.** It states the mechanic before a
   word of copy does.
5. **Closed sets.** Eight type steps, four container widths, three control
   sizes, four shadows. A value outside them is a bug, not a judgement call.
6. **No live feedback in the room.** A meter during the rehearsal would train
   people to negotiate while watching a meter, which is not available on the
   day.

---

## 7. What was intentionally NOT built

* **No pricing was invented.** `lib/plans.ts` prices remain placeholder
  configuration and are marked as such in the file. No marketing surface
  asserts them.
* **No business facts were invented.** Legal entity, addresses, contacts and
  effective dates still render the visible `Configure` marker from
  `app/components/ContentPage.tsx` rather than a plausible-looking placeholder.
* **No social proof.** No logos, testimonials, case studies, customer counts,
  usage figures, funding claims or certifications. The product has none of
  these and will not display any until it does.
* **No market statistics on any marketing surface.** The research figures in §3
  live in this document and nowhere else, because they come from secondary
  sources that disagree with each other.
* **No sixth dimension.** The five in `lib/negotiation/dimensions.ts` are the
  spine of the debrief, the progress trend and the playbook. Adding one is a
  product decision, not a config change.
* **No engine changes.** The streaming counterpart, the leak guard, the
  lifecycle state machine, the quota enforcement and the scoring prompt were
  not touched by this repositioning. Only content, copy and presentation moved.
* **No custom scenario editor, no team workspace.** Neither exists. Both were
  advertised as plan entitlements until 2026-09-13, when the entitlements were
  removed from `lib/plans.ts`, the pricing page and the Stripe product
  descriptions so the product no longer sells them. See `ROADMAP.md`.

---

## 8. Remaining launch blockers

These are real and none of them are cosmetic.

1. **Prices are not reconciled with Stripe.** `PLAN_PRICES` is placeholder
   configuration. The live products must be created and the price ids copied
   into the environment before any public pricing is shown.
2. **Two advertised entitlements did not exist.** Resolved 2026-09-13 by
   removal: `customScenarios` and `teamWorkspace` are no longer defined,
   displayed or sent to Stripe. What remains is the retention figure
   (`historyDays`), which is displayed but not enforced — see `ROADMAP.md`.
3. **Business configuration is unfilled by design.** Every `Configure` marker
   is a launch blocker on a legal page.
4. **Rate limiting is per-instance.** `lib/rateLimit.ts` is in-memory, so limits
   are per serverless instance rather than global.
5. **The device-token auth fallback still exists.** `lib/ownership.ts` is honest
   that it is a soft check. `requireAuthenticated` refuses it for destructive
   and financial actions, but removing it entirely needs token-refresh handling
   in the room first.
6. **Reminder delivery was removed rather than scheduled.** Resolved
   2026-09-16. Settings offered "a week before", "the day before" and "when a
   debrief is ready", with the second switched on by default, and none of the
   three could ever fire: no scheduler existed, `notifyUpcomingConversation`
   was called from nowhere, `web-push` was imported by no file, and the toggles
   wrote to localStorage nothing read. The whole subsystem is gone — toggles,
   the unlinked `/notifications` page, `/api/notifications`, `/api/push`, the
   trigger module, the service-worker handlers, the dependency and both tables.
   The dated conversation the user gives onboarding is real and still counts
   down on the dashboard. See `ROADMAP.md` for what re-opening it would take.

   Two broken auth flows were found and fixed in the same pass. "Forgot your
   password?" on the sign-in page led to `/reset-password`, which rendered only
   a set-a-new-password form — a call that needs a recovery session nobody
   arriving that way has — and told the user the link "may have expired,
   request a new one" with nowhere in the product to request one. The route
   that sends the link, `/api/send-reset`, was already written, rate limited
   and pointed back at that page, and was called from nothing. The page now
   serves both halves. Separately, it was the only importer of `lib/supabase.ts`,
   a second browser client with a different `storageKey` from the
   `lib/supabase-client.ts` every other auth surface uses — so it read a
   different session store than the app it belonged to, and Settings' sign-out
   ended a session in the wrong one. That file is deleted.
7. **The counterpart's prompt has never been run against a model.** This is
   the largest real gap in the product, and it got larger on 2026-09-15: the
   system prompt now hands the counterpart its mandate as an itemised inventory
   with "never raise this first" over the free levers and "do not give the same
   ground twice" over the movable ones. CLAUDE.md requires `evals/run.ts` after
   a prompt change of that size. It has not been run — no provider credential
   has ever existed on this machine — so what is claimed about counterpart
   behaviour is what the prompt instructs and what the deterministic guard
   enforces, never what a model was observed to do.

   It grew again later the same day, for a reason worth stating plainly: the
   counterpart's `tell` — authored on all five built-ins, collected on every
   custom one, and rendered on the landing page and the bench as the thing you
   learn to read — was never sent to the model at all. The product described a
   behaviour it did not ask for. It is now a conditional section of the prompt,
   written so the tell appears only when the counterpart is genuinely closer to
   moving than it has said, and never as a claim about its own authority.

   What was done instead of a run, in both cases: eval categories that measure
   the specific new failure, with assertions tested in both directions in
   `tests/eval-harness.test.ts`, so a run measures the right thing when it
   happens. `unprompted_free_lever` covers the free lever being volunteered;
   `tell_discipline` covers the counterpart announcing its own position rather
   than showing it. Writing the first pair caught two bugs in the assertion
   itself that a passing run would have hidden. A third test now fails if a
   category is added to `evals/prompts.json` with no arm in the checker — the
   failure that would otherwise report PASS for probes that tested nothing.

   The suite also still covers one scenario and one counterpart per run, which
   matters more now than it did: the tell is per-counterpart, and a run against
   the Closer says nothing about the other four.
