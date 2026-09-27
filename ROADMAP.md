# Parley — Roadmap

Possible future work. Priorities change; unchecked items are not committed
requirements. See the change discipline note at the bottom before implementing
any of it.

---

## Known gaps in what exists today

These are not features. They are things the current implementation does not do
well, listed first because they matter more than anything below them.

* [x] **Real session auth.** Done. `lib/ownership.ts` now verifies a Supabase
  access token server-side (`lib/auth-server.ts`) and requires it to resolve to
  the same account the caller claims. The device token remains only as a
  fallback for a session that expires mid-rehearsal, and `requireAuthenticated`
  refuses it outright for destructive or financial actions. Remaining work: the
  fallback should eventually go away entirely, which means handling token
  refresh failure in the room without dropping the user out of it.
* [ ] **Custom scenarios.** There is no editor and no storage for them. The
  `customScenarios` entitlement was removed from `lib/plans.ts` and the
  pricing page on 2026-09-13 so the product stops advertising it; when an
  editor exists, the entitlement comes back with it.
* [ ] **Team workspace, and with it a Team plan.** A shared library, team
  progress and a seat do not exist; the `teamWorkspace` entitlement went on
  2026-09-13, and on 2026-09-14 the plan itself was withdrawn from sale — its
  entitlements were identical to Professional's at a lower price under a
  tagline promising per-seat access. `team` remains in the `Plan` type,
  `PLAN_FEATURES`, `PLAN_ORDER`, `plan_limits` and the database constraint so
  an existing subscription keeps working; it is absent from `PUBLIC_PLANS`.
  Selling it again means building seats first, and
  `tests/plan-claims.test.ts` fails if its entitlements ever diverge from
  Professional's without that decision being taken.
* [ ] **History retention: the claim is gone, the feature is not built.**
  `PlanFeatures.historyDays` was removed on 2026-09-14 along with every surface
  that printed it — the pricing table, the billing page and the privacy policy,
  which had been describing a deletion that never happened. Today every plan
  keeps everything until the account is deleted, and the policy says so. If
  tiered retention is ever wanted it needs a date filter in `lib/rehearsals.ts`
  and the account export, a reaper, and a deliberate change to the privacy
  policy — in that order, with the entitlement added back last.
* [ ] **Transcript export is universal, not tiered.** `GET /api/account`
  exports everything for every plan from the data controls page. The
  `exportTranscripts` entitlement was removed on 2026-09-13 because the
  pricing table said free users lacked something the same page's FAQ said
  they had.
* [ ] **Per-rehearsal deletion.** Data controls delete the whole account and
  nothing smaller, which the privacy policy now states outright. A single
  rehearsal — the one about a job you did not take — is the obvious thing
  someone wants to remove.
* [x] **The signed-in Nav overflows a phone.** Fixed: the `max-width: 820px`
  rule in `app/components/Nav.tsx` moves Pricing and Settings into the drawer
  and the 400px rule tightens the bar's gap. Re-measured 2026-09-16 across all
  25 routes at 390x844 — `document.scrollWidth` equals `clientWidth` on every
  one, signed in and out.
* [x] **Reminder delivery.** Resolved 2026-09-16 by removal, not by building
  it. Nothing scheduled these and nothing ever had: `notifyUpcomingConversation`
  was imported by no file, `web-push` was a dependency no file imported, the
  `/notifications` page was linked from nowhere (its one writer was the Stripe
  webhook, inserting a row no navigation could reach),
  and the three Settings toggles wrote to localStorage no code read — with "the
  day before" defaulting to ON, so the page promised a message it could not
  send and pre-agreed to it. The toggles, the page, `/api/notifications`,
  `/api/push`, `lib/notificationTriggers.ts`, the service-worker push handlers,
  the dependency and both tables are gone. The date the user gives onboarding
  is real and still drives the dashboard's countdown, which is where that
  urgency belongs until something can actually deliver a message.
  Re-opening this means building the scheduled job first and the switch second.
* [ ] **Debrief cost.** Every debrief re-sends the full transcript. Long
  rehearsals are disproportionately expensive; worth measuring before it
  matters.
* [ ] **Rate limiting is per-instance.** `lib/rateLimit.ts` and the proxy's
  store are in-memory, so limits are per serverless instance rather than
  global.

---

## Near-term

### The counterpart

* [ ] Reduce time-to-first-token in the room; it is the single thing that most
  affects whether a rehearsal feels live
* [ ] Broaden the eval suite — it currently probes one scenario and one
  counterpart per run
* [ ] Detect and cut counterpart replies that drift into summarising the
  negotiation rather than conducting it
* [ ] Tune the concession ladder against real transcripts rather than intuition

### The debrief

* [ ] Improve turn-position accuracy in key moments; a note anchored to the
  wrong line undermines trust in the whole page
* [ ] Calibrate scores across scenarios so a 60 means the same thing in a
  salary conversation and a renewal
* [ ] Handle very short and abandoned rehearsals more gracefully than a 422

### Library and counterparts

* [ ] More scenarios, especially outside the current six categories
* [ ] Let a user write their own scenario, including the mandate they want the
  counterpart to hold
* [x] Send the counterpart its own `tell`. Done 2026-09-15. It had been
  authored on all five built-ins, collected on every custom one, and rendered
  on the landing page and the bench as the thing you learn to read — while
  never reaching the model, so the signal a user was learning to read did not
  exist. It is now a conditional section in `lib/negotiation/prompt.ts`, guarded
  by `tell_discipline` in the eval harness. **Unverified against a model**, like
  everything else about counterpart behaviour — see `docs/product-direction.md`
  §8.7.

---

## Mid-term

* [ ] Spoken rehearsal. The strongest argument for it is that composure under
  interruption barely exists in text.
* [ ] Replay a single turn — re-run from a chosen point with a different line,
  rather than restarting the whole rehearsal
* [ ] Prep sheet: a one-page summary generated before the real conversation,
  built from the playbook and recent debriefs
* [ ] Compare two rehearsals of the same scenario side by side
* [ ] Transcript export beyond raw JSON

---

## Long-term

* [ ] Team plan for real: shared scenarios, aggregate progress, a manager view
  that shows where a team leaks value without exposing individual transcripts
* [ ] Integrations that put a rehearsal next to the calendar event it is for
* [ ] Independent review of the scoring — does a higher Parley score correlate
  with better real-world outcomes? Until that is answered, the scores are a
  well-designed proxy and should be described as one.

---

## Technical debt

* Consolidate the remaining inline-style blocks into shared components.
* Improve error boundaries around external services and database operations.
* Expand unit and end-to-end test coverage; there is currently no unit test
  layer at all.
* Distributed rate limiting for production.
* Better observability around debrief failures specifically — they are the
  failure users notice most, because the work is already done.
* Resolve the remaining `react-hooks/set-state-in-effect` lint errors; each is
  a browser-only value read on mount, and `lib/hooks/useUserId.ts` shows the
  pattern that fixes them properly.

---

## Change discipline

Roadmap items are not approved work. Before implementing one:

1. Confirm the requirement.
2. Inspect the current implementation.
3. Define the smallest useful change.
4. Review security and compatibility implications.
5. Implement and test.
6. Review the final diff.
