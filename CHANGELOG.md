# Changelog

## [Unreleased]

Phase 4: a hardening pass over the surfaces the product had stopped looking at
— the three routes that still took a `userId` on trust, the webhook writes that
could lose a paid plan without saying so, and the pages that were public to
search without a title or private to users without a `noindex`. No live service
was involved; the schema change was executed against a local Postgres engine
(PGlite) rather than against Supabase.

### Security

* **`POST /api/user/update-profile` verifies who is calling.** It took a userId
  on trust — its own header comment said so, on the reasoning that a display
  name is cosmetic. It is not cosmetic to the person whose account it is:
  anyone who knew a uuid could rewrite a stranger's name, at any length, as
  often as they liked, because the rate limit was keyed on the caller-supplied
  userId and rotating it reset the counter. Now `verifyOwnership`, an IP-keyed
  limit, an 80-character bound, and the same content check every other
  user-authored field goes through. `tests/account-routes.test.ts`.
* **`GET /api/user/profile` no longer hands out an email address for a uuid.**
  Its comment deferred a real fix to "the Supabase Auth migration", which has
  since landed. The check it carried inline was also weaker than the shared one
  in two ways: it accepted any string up to 100 characters as an id, and it
  CLAIMED an unbound row's device token for whoever asked first — which handed
  a stranger the binding for any account that had never made a request.
* **`POST /api/email` is no longer an open relay.** It took the recipient from
  the request body with no authentication of any kind, which made Parley's
  verified sending domain available to anyone who could write a POST — and the
  `billing` type let them choose the headline and most of the body too. The
  recipient is no longer an argument: a caller proves which account they are
  and the address is read from that account's own row, so there is no request
  this endpoint can now be made to send anywhere except back to the person
  making it.
* **A suspended account cannot lift its own suspension.** RLS said WHICH row a
  signed-in browser may write; nothing said which COLUMNS, so `users.banned` —
  set by `lib/safety.ts` after a critical violation — was clearable from the
  browser console with one supabase-js call, and `users.device_token` was
  rewritable the same way. Column-level grants now limit the browser to the
  four fields sign-up and the OAuth callback actually write. Executed and
  verified on a local Postgres engine, including that the sign-up upsert and
  the PostgREST merge-duplicates upsert both still succeed.
* **`POST /api/stripe` will not open a checkout naming someone else.** The id
  in the session's metadata is the id the webhook later grants a plan to, and
  it was unverified. Completing such a session upserts the named user's
  `subscriptions` row — which is keyed on `user_id` — replacing their
  `stripe_customer_id` with the payer's, after which the victim's own billing
  portal opens the payer's customer record while the victim's real subscription
  stops being tracked against them. The route's rate limit was keyed on the
  same caller-supplied field, so it reset on demand; it is now keyed on the IP.
* **`POST /api/send-reset` stopped answering "is this an account?".** It
  returned Supabase's own error message with a 400, and that message
  distinguishes an unknown address from a transport failure. The answer is now
  the same either way, which is what the form in front of it already claimed.
* The Google Fonts allowances came off the CSP's `style-src` and `font-src`:
  all three families are committed under `app/fonts` and served same-origin, so
  those were open doors nothing walked through. HSTS is now sent in production,
  and deliberately not in development, where it would pin `localhost` for every
  other project on the machine.

### Fixed

* **A Stripe write that fails is no longer reported to Stripe as a success.**
  The subscription upsert on `checkout.session.completed` was issued and never
  checked, and `applySubscriptionUpdate` logged its error and returned the same
  `null` it returns for a stale event correctly dropped. Either way the route
  answered 200, Stripe never redelivered, and the entitlement change was gone
  with a log line to show for it — on the one write in the file that someone
  had already paid for. Both now throw, which records the event as `failed` and
  asks for the retry; "no row matched" still reads as delivered, because
  retrying that would never succeed. A malformed `metadata.user_id` is refused
  once rather than retried forever. `tests/stripe-webhook.test.ts`.
* **The debrief survives a rate limit.** `complete()` gave up on the first 429
  or 5xx and handed the recovery to the user as a "try generating it again"
  button, at the end of a rehearsal they had just spent fifteen minutes on. It
  now retries once, the way the room's stream already did — a refusal that
  generated nothing costs nothing to send again. A 4xx is still not retried,
  because that answer will not change.
* **Settings stops saying "Saved" when it did not save.** The display name is
  the one field on that page that also lives on the server, and the write was
  fired and discarded with `.catch(() => {})` while "Saved" appeared
  regardless. It is now awaited and its answer read, with its own state saying
  which half succeeded.
* **A filtered counterpart turn is charged for.** The output filter discards the
  reply, but the provider generated it and we paid for it; the daily token
  ceiling recorded nothing on that path, which is the one path someone can trip
  deliberately. The leak path beside it already did this.
  `tests/streaming.test.ts`.
* `/api/analytics`, `/api/report` and `/api/feedback` validate the id they are
  handed as a uuid. All three write it into a uuid column, where a malformed
  value fails the whole insert — so a report or a piece of feedback could be
  lost entirely rather than merely landing unattributed.

### Accessibility

An axe sweep of twenty routes at WCAG 2.1 A and AA returned violations on
**eighteen of them**. It returns none. The run is reproducible with any axe
driver against the built app; nothing about it was committed, because it needs
Playwright for one manual check.

* **The quietest tier of the type scale was not readable.** `--pl-ink-faint`
  was `rgba(22,24,29,0.40)`, which composites to `#9d9b96` on the cream — 2.48:1
  against a 4.5:1 requirement. It was not decoration: 53 of its 59 uses in
  `globals.css` set `color`, so it was drawing the nav's quiet links, every
  section's eyebrow heading, the footer mark, "last updated" on the legal pages
  and the helper lines under the sign-up form. It is now 0.62, which reads
  4.78:1 on `--pl-bg` and 4.85:1 on `--pl-surface`. `--pl-ink-faint-line` keeps
  the old value for the three places it is a rule or a border rather than text.
  The same correction in the room's register, where 0.38 read 3.25:1 on the
  ground and 3.96:1 on the raised surface that actually binds it; it is 0.58.
* **Clay stopped being set as small text.** `#f0522e` is 3.16:1 on the cream —
  fine for the wordmark's full stop, which is display type, and a failure for
  the six places it was setting an error line, a link or a badge. Those moved to
  `clayDeep`, the written grade the design system already had for exactly this,
  at 7.7:1. The admin login error, onboarding's error, privacy-controls' delete
  error, the support widget's link, and both "upgrade to add more" links.
* **`warnDeep` did not do the one thing it exists for.** Its comment says it is
  the grade that clears 4.5:1 for warn-coloured words. It did on the cream and
  measured 4.43:1 on the sunken surface the `[configure: …]` marker sits on.
  `#8a5f0c` → `#7a5309`, now 6.1:1 and 5.4:1.
* **`citronDeep` likewise**, at 4.32:1 on the citron-soft ground a stamp's label
  actually sits on. `#6e7c1f` → `#667319`, 5.0:1.
* **The counterpart card's file number** was steel at `opacity: 0.5` — 2.48:1.
  `aria-hidden` covers the screen reader; it does not cover the person with low
  vision who can still see it. 0.78, and still the quietest thing on the card.
* **The "counterpart to pre-select" menu had no accessible name** — the only
  critical-impact finding in the sweep. Its `Field` wrapper renders a `<label>`
  and the component's own comment warns that a control needs `htmlFor` and a
  matching `id`; this one had neither, so the select announced as "menu".
* **`tests/contrast.test.ts`** computes every ratio from the tokens themselves —
  45 assertions, including that `citron` and `clay` are still NOT legible as
  small text, because both are fills and a future edit that darkened them would
  quietly change what they mean. It also pins `globals.css` and `lib/design.ts`
  to the same thirteen literals, which is the drift that caused two of the
  findings above. It caught the room fix being half a fix while it was being
  written.

### Changed

* **Six private surfaces stopped being indexable.** `/dashboard`, `/playbook`,
  `/progress`, `/counterparts/new`, `/maintenance` and `/billing` inherited the
  root `robots: { index: true }` — the first five are client components that
  could not carry their own metadata, and billing was simply the one private
  layout that never got the tag the others have. `robots.txt` disallowed most
  of them, but a Disallow only stops the crawl: a URL linked from anywhere can
  still be indexed without ever being fetched, which is exactly how a private
  page ends up in a result with no snippet.
* **Four public pages got their own titles.** `/library`, `/pricing`,
  `/support` and `/counterparts` are all in the sitemap and were all inheriting
  the root title, so every scenario brief had a specific title in search results
  and the page that links to all of them did not. Canonicals are set across the
  public set, including per-slug on the briefs.
* **`robots.txt` names the sitemap.** It is generated from `app/robots.ts` now,
  because a sitemap URL has to be absolute and the only honest source for the
  origin is `SITE_URL`, which a static file in `public/` cannot read.
* The PWA manifest's `background_color` and `theme_color` were a different cream
  from `PAPER.bg` in `lib/design.ts`, so the splash screen and the installed
  app's chrome did not match the product.

### Removed

* **`addBonusTokens`**, documented as "called from the Stripe webhook on a
  top-up". The webhook has never called it and Parley sells no top-up, so it was
  a function describing a product that does not exist. The
  `usage_daily.bonus_tokens` column and its consumption logic stay — raising
  someone's ceiling means setting it by hand, and the comment now says so.


Phase 3: the mandate made countable. The hidden mandate was prose the user read
once at the end; it is now also a closed, authored list of the discrete things
that were on the table, which is what turns the debrief's central claim from a
judgement into a count. No live service was involved in any of this.

### Added

* **The lever ledger.** Every scenario's mandate is now also written as
  `mandateLevers` — one row per thing that was actually available, each with
  the question that surfaces it, at least one per scenario marked as costing
  the counterpart nothing. The debrief returns which ids the transcript
  supports, the server snapshots the whole set with a verdict on each onto the
  debrief row, and the reveal renders found against missed with the question
  that would have opened each miss. `tests/levers.test.ts`.
* **The counterpart is handed an inventory, not a paragraph.** The system
  prompt splits the mandate by what can move, what is known and what is fixed,
  with "never raise it first" over the free levers and "do not give the same
  ground twice" over the movable ones. A paragraph could not be held
  consistently across twenty turns; a list can.
* **The count is public from the brief onward.** How many things are on the
  table is safe to publish and is the denominator the debrief settles against,
  so the brief and the room both state it, and the redaction draws one bar per
  thing sealed. It is fixed for the whole rehearsal — a count that moved as
  things were found would be live feedback, which the room does not have.
* **Progress says what you keep leaving on the table.** The lever history sums
  across every scored rehearsal and breaks it down by kind, so the page answers
  "at what?" and not only "am I improving?". `tests/lever-history.test.ts`.
* **`unprompted_free_lever`** joins the eval categories, with assertions that
  are themselves tested in both directions.
* **The counterpart is sent its own tell.** `Counterpart.tell` has been
  authored on all five built-ins since the bench existed, is collected on every
  custom counterpart, and is rendered on the landing page and the bench as the
  thing you learn to read — and it had never been sent to the model. The
  product described a signal it did not generate, which is the one kind of bug
  a green suite and a clean screenshot both miss. It is now a conditional
  section of the system prompt: shown only when the counterpart is genuinely
  closer to moving than it has said, never while it is holding firm, never as a
  claim about its own authority, and never pointed at — the room still gives no
  feedback. This is what makes a second rehearsal against a different
  counterpart teach something rather than sound different.
* **`tell_discipline`** joins the eval categories to measure the failure that
  addition opens: a counterpart that *announces* it is close has handed over a
  fact about its own authority for nothing. Assertions tested both ways,
  including against the five built-in tells actually being performed.
* **A category with no assertion arm now fails the suite.** The header of
  `evals/assertions.ts` warned that a category in `prompts.json` with no
  matching case falls through the switch and reports PASS having tested
  nothing — a paid run that is worse than no run. Nothing checked for it.
  `tests/eval-harness.test.ts` does now.
* **Every section heading the prompt writes must be one the leak guard knows.**
  The two were separate sets of literals in separate files, held together by
  nothing; a new section was unguarded twice over — the model could recite the
  heading, and `sanitisePromptField` stopped stripping it from user-authored
  fields. `tests/injection.test.ts` matches on heading shape, so the failure
  comes from the header that was just added.

### Security

* **The leak guard covers the itemised mandate too.** A lever says what the
  mandate says in different words, so shingling only `hiddenMandate` would have
  let a counterpart recite one verbatim and pass. Sources shorter than the
  eight-word window — a lever label is typically six — are covered by their
  whole phrase down to a floor of six, and the candidate reply is shingled at
  every length present rather than only the default.
* **Levers never reach a client as scenario data at all**, not even from the
  projection that is allowed to send the prose mandate once a rehearsal has
  ended. The only form one is ever rendered in is a `ScoredLever` snapshotted
  onto a debrief row, which cannot exist any earlier. The debrief GET is now
  gated on `mandateMayBeRevealed()` rather than on that being inferred.

### Fixed

* **A failed progress read returned HTTP 200 with an empty history**, so the
  page rendered its EMPTY state and an outage told a paying user their work was
  gone. It is a 503 now, which the page already had a screen for.
* **The room showed turns the server had refused.** The composer puts your turn
  on screen the moment you send it, and nothing put it back when the request
  came home rejected — a safety refusal, the daily cap, a rehearsal that had
  already ended, a write that did not land. All of those return before the turn
  is persisted, so the transcript kept a line that existed nowhere else and lost
  it on the next reload. On a candid rehearsal transcript that reads as lost
  data rather than as a rejected turn. Every failed send now re-reads the
  transcript from the record, so what is on screen after a failure is what is
  stored. The dropped-connection notice no longer claims "your turn was saved"
  either — the client cannot know that, and a fetch that threw may never have
  reached the server.
* **The dashboard presented boilerplate as a finding.** "Where you leak most"
  printed the dimension's static `failureMode` — the same sentence for everyone
  who scores low on discovery — under a heading claiming it was about them. It
  is the lever history now, which is.
* **The billing card was a rounded, hairline-bordered div with no shadow**, the
  one thing `lib/design.ts` names as the way to look like every other product,
  and its stat labels were 10px, under the type floor that file sets.
* **Password recovery was unreachable from both ends.** "Forgot your password?"
  on the sign-in page led to `/reset-password`, which rendered only a
  set-a-new-password form. That form calls `supabase.auth.updateUser`, which
  needs a recovery session nobody arriving by that link has — so the user typed
  a new password twice and was told the link "may have expired, request a new
  one", with nowhere in the product to request one. `/api/send-reset`, which
  sends exactly that link and already pointed its `redirectTo` back at this
  page, was called from nothing: both halves were built and never joined. The
  page now decides which half it is — no recovery session asks for the email
  and sends the link, a recovery session sets the password — and an expired
  link drops back to the request form instead of failing the same way twice.
  A wrong address gets the same answer as a right one, so the form cannot be
  used to find out who has an account.
* **Two browser Supabase clients, two session stores.** `lib/supabase.ts`
  configured no `storageKey` while `lib/supabase-client.ts` uses
  `parley-auth-session`, and the two were never reconciled. `/reset-password`
  was the former's only importer, so it read a different session than the app
  it belonged to, and Settings' sign-out ended a session in the wrong store —
  which appeared to work only because `localStorage.clear()` runs immediately
  after and removes the real one. The file is deleted; there is one browser
  client.
* **The share card was declared and never drawn.** `metadata` set
  `twitter.card: 'summary_large_image'` and never set an `images` field, so
  every shared link unfurled a large empty card. `app/api/og/route.tsx` existed
  to fill it, was referenced by nothing, and returned `image/svg+xml`, which
  Facebook, X, LinkedIn and Slack all decline to render — so wiring it up would
  not have fixed it either. Replaced by `app/opengraph-image.tsx`, which Next
  renders to PNG at build and whose tags it injects itself, so the artwork and
  the metadata cannot drift apart again. It leads with the redaction, which
  states the mechanic before the sentence under it has to.

### Removed

* **The newsletter.** An unauthenticated POST that wrote email addresses into a
  table and promised "occasional updates from Parley" — no newsletter and no
  sender exist. Nothing linked to it. Route, unsubscribe route and table.
* **The Discord alert route.** Also orphaned, also unauthenticated, so anyone
  who knew the path could push fabricated safety and subscription alerts into
  the operator's channel.
* **The notification subsystem, entire.** Settings offered "a week before",
  "the day before" and "when a debrief is ready", with the second switched on
  by default. None of the three could ever fire, and nothing in the stack
  beneath them could either: no scheduler existed, `notifyUpcomingConversation`
  was imported by no file, `web-push` was a dependency no file imported, the
  `/notifications` page was linked from no nav or footer, and the toggles
  wrote to localStorage keys no code read. The table had exactly one writer —
  the Stripe webhook inserted a "Your plan is active" row on subscription
  start — into a page no navigation reached, so even that was never read. So
  the product promised a message it had no way to send and pre-agreed to it on
  the user's behalf — the one failure mode a green suite and a clean screenshot
  both miss. Gone: the toggles, the page, `/api/notifications`, `/api/push`,
  `lib/notificationTriggers.ts`, the service-worker `push` and
  `notificationclick` handlers, the `web-push` dependency, and the
  `notifications` and `push_subscriptions` tables. The dated conversation the
  user gives onboarding is real and still counts down on the dashboard, which
  is where that urgency belongs until something can deliver a message.
* **`app/components/ScrollReveal.tsx`**, imported by nothing, and whose
  `.scroll-reveal` / `.reveal-visible` classes are defined in no stylesheet —
  so it would have animated nothing had anything used it. The landing page's
  reveal is its own `useInView` and is unaffected.
* **`users.onboarding_context`**, declared and never read or written.


Phase 2B: the guest → account conversion flow, followed end to end for the
first time. See `docs/phase-2-plan.md` §6–§9 for what the walk found, what was
changed and what was verified against what. No live service was involved.

### Security

* **A browser-only identity is bound to its browser before it has anything
  worth taking.** The landing and pricing CTAs open a room on a uuid minted in
  `localStorage`, and `rehearsals.user_id` is deliberately not a foreign key —
  so a guest accumulated a full transcript history under an id that had no
  `users` row, carried no device token, and was therefore accepted as a
  migration source from anyone who knew it. The uuid is not a secret: the
  client sends it as a query parameter on every read. `POST /api/rehearsal/session`
  now calls the new `bindGuestIdentity`, which creates the row carrying the
  presented device token, before the first rehearsal is inserted.
  `tests/guest-binding.test.ts`. A browser with cookies blocked still gets no
  binding; that limit is recorded rather than hidden.

### Fixed

* **A failed guest migration no longer reports success.** Three copies of the
  call, none reading the response and two not awaiting it — so a 403, a partial
  move and a success were indistinguishable, and `parley_uid` had already been
  switched to the new account. Creating an account could therefore look exactly
  like deleting your work. One definition in `lib/guest-migration.ts`, awaited,
  where success is only a 2xx carrying `migrated: true`; sign-up and the OAuth
  callback stop on a screen that says the rehearsals are still in this browser
  and offers a retry. `tests/guest-migration.test.ts`.
* **Creating an account returns you to what you were keeping.** Every path sent
  people to `/onboarding` or `/dashboard`, so someone who clicked "keep this" on
  their debrief was answered with the product's first-run screen. The debrief
  now carries a sanitised `?next=`, honoured by sign-up, sign-in and the
  callback.

### Changed

* **A guest account is no longer called an account.** "Try one without an
  account" creates a Supabase user at `@parley-guest.local` with a password
  shown to nobody, so nothing can ever sign into it again — yet it set
  `parley_authenticated`, which drew signed-in chrome and *suppressed* the
  browser-only notice for the user whose work was held most precariously.
  `useSignedIn()` now means "an account that can be signed back into".
  `tests/signed-in.test.ts`. Browsers already in that state carry no mark and
  are unaffected.
* **The debrief's ask names what it keeps.** The fact first — saved to this
  browser only — then this debrief, the transcript and the playbook notes, then
  one button reading "Keep this rehearsal". Every item listed is a table the
  migration actually moves; progress trends are not listed, because they are a
  paid entitlement.

### Removed

* **The transcript-history claim, from the pricing table, the billing page and
  the privacy policy.** `historyDays` promised 30 days on Free and three years
  on Professional. No reader filtered by date and no reaper deleted anything,
  so every plan kept everything: the claim undersold what a free account keeps
  and sold paid retention that was not being withheld from anyone, and as a
  privacy statement it described a deletion that never happened. The policy now
  says what is true — kept until you delete it, nothing removed on a schedule or
  when a plan lapses. A reaper is a destructive data feature and a legal
  decision, so the claim was removed rather than enforced.
* **The `monthlyDebriefs` entitlement.** No route read it, and a debrief is
  generated once per rehearsal, so "Unlimited" printed beside "25 rehearsals a
  month" described a resource that cannot exist. The FAQ says it in words.
* **Team, from everything that sells it** — the plan cards, the comparison
  table, the Stripe product configuration and the upgrade prompts. Its
  entitlements were byte-for-byte Professional's at a lower price, under a
  tagline promising per-seat access while nothing implements a seat and the
  terms say one person per account. **Nothing was taken from anyone:** `team`
  remains in the type, `PLAN_FEATURES`, `PLAN_ORDER`, `plan_limits` and the
  database constraint, so an existing subscription still resolves to full
  access. Several people on one account is arranged by hand, which the pricing
  FAQ now says.

### Tests

* `tests/plan-claims.test.ts` — walks `app/` and `lib/` and fails if an
  entitlement is declared but enforced nowhere, if a removed one returns, if any
  surface claims a history window, if a plan outside `PUBLIC_PLANS` is offered
  or priced, or if the comparison table grows a row that is not enforced. It is
  what keeps the rule in `lib/plans.ts` from being a comment.
* Replay safety on `POST /api/user/migrate`, and a source refused while the
  caller's own session is genuine.

Phase 2: the product and UX study (`docs/phase-2-product-study.md`), the
plan that follows from it (`docs/phase-2-plan.md`), and the P0/P1 items
from that plan. Every screen was driven in the production build with every
API route mocked, at desktop and phone widths, before and after the changes.
No live service was involved; see the study's legend.

### Security

* **The guest → account migration checks ownership of both ids.**
  `POST /api/user/migrate` accepted two well-formed uuids from anyone and
  moved every row from one to the other. It now requires `verifyOwnership`
  for the destination and the new `verifyDeviceBinding` — the device-token
  half of the same check, which does not refuse a session held for a
  different account — for the source, and writes nothing if either fails.
  `tests/migrate.test.ts`, `tests/device-binding.test.ts`.

### Fixed

* **The room fits the viewport.** `.pl-room-shell` had only a `min-height`,
  so the transcript column grew to its content, the document scrolled
  instead of the column, and after a few exchanges the composer sat below
  the fold with the auto-scroll a no-op. A height on the shell and
  `min-height: 0` on the column.
* **Ending too early no longer offers a retry that cannot succeed.** The
  End dialog warns when fewer than two turns have been said, and a
  `422 too_short` debrief renders its own state with the way back to the
  brief instead of "Try again".
* **Primary controls clear AA.** White on clay computed to 3.5:1; primary
  buttons, the pressed chip and the clay tab now carry ink (5.0:1), and clay
  used as words on paper uses `--pl-clay-deep` (7.7:1), as warn already did.
  Room-register clay text is unchanged.

### Changed

* **A browser-only debrief says so.** When no account is signed in, the
  paper debrief carries one ruled line — "Saved to this browser only." —
  with the way to create an account. `lib/hooks/useSignedIn.ts` now holds
  the single definition of "signed in" that the Nav also uses.
* **One palette across the chrome.** Nav ground,
  `theme-color`, the cookie banner, `::selection` and the OG image now use
  PAPER's cream, ink and clay. The email templates and the newsletter
  unsubscribe page still carry older values (recorded, not changed).
* **The sign-up page's tab switcher is the segmented control**, not a pill,
  and its primary button and in-sentence links are the product's own.

Phase 1 of the verification pass: make the core rehearsal loop truthful
end-to-end. See `docs/phase-1-verification.md` for what was and was not
verified, and against which services.

Phase 1B, same day: an attempt at live verification. No Supabase, OpenRouter
or Stripe credentials were available, so every live check stays BLOCKED
(§13–§22 of the same document). What could be done without them was done:
the schema was executed against a real PostgreSQL engine, which found one
defect, and the six lint errors were resolved.

### Security

* **The two server-only database functions are no longer executable with
  the anon key.** `transition_rehearsal()` and `claim_debrief()` are
  `security definer` and take the user id as an argument. Postgres grants
  EXECUTE on a new function to PUBLIC by default, so on a Supabase project
  both were reachable through PostgREST's RPC endpoint by anyone holding a
  rehearsal id and its owner's id. `supabase_migrations.sql` now revokes
  EXECUTE from `public`, `anon` and `authenticated` on both;
  `tests/lifecycle.test.ts` asserts the revokes stay. Found by executing the
  schema in Phase 1B; the application only ever calls these through the
  service-role client, which is unaffected.

### Fixed

* **Lint is clean.** The six `react-hooks/set-state-in-effect` errors — in
  the admin, billing, settings, sign-up, status and upgrade pages — are
  resolved by reading browser-only values through `useSyncExternalStore`
  (the pattern in `lib/hooks/useUserId.ts`), deriving the upgrade page's
  plan from the query string, and moving fetch-driven state updates into
  promise callbacks. No page changes what it renders on the server.

* **Custom counterparts can actually be rehearsed.** They were stored,
  listed, and offered on the brief page, but the session route resolved only
  the built-in archetypes and refused them as unknown — and a rehearsal
  carrying one could not be loaded at all. `resolveCounterpart` in
  `lib/rehearsals.ts` now resolves a built-in or one of the caller's own
  custom counterparts, scoped to the verified user id. A rehearsal whose
  custom counterpart was later deleted stays readable under a flagged
  stand-in and stops accepting turns. History rows carry the custom name.
* **A failed debrief generation no longer blocks the retry it invites.** The
  generation claim was only released by its three-minute stale window, so a
  provider failure followed by the user's own "Try again" was answered with
  "already being written". The claim is now handed back on every failure
  path that persisted nothing.
* **A room that could not be brought live is marked failed** rather than
  left as a draft that counts against the month.

### Removed

* The `customScenarios`, `teamWorkspace` and `exportTranscripts` plan
  entitlements, from `lib/plans.ts`, the pricing comparison and the Stripe
  product descriptions. The first two were never built; the third is
  available to every plan through the account export, so it was not a
  differentiator. The Team tagline no longer promises a shared library.

### Tests

* `tests/counterparts.test.ts` — counterpart resolution, ownership scoping,
  the deleted-counterpart stand-in, and the session route against a custom
  counterpart.
* `tests/safety.test.ts` — the content safety layer's block, soft-flag and
  pass decisions.
* Claim release on debrief failure; the turn route refusing a retired
  counterpart.

## [0.1.0] — Parley

First release of Parley.

### The product

* **Rehearsal room** — a live, timeboxed negotiation against a counterpart
  holding a mandate the user cannot see. Streams token by token, runs on a
  visible clock, and gives no feedback while it is running.
* **Scenario library** — six briefed situations across pay, clients, vendors,
  internal politics, difficult news and fundraising. Each carries a hidden
  mandate, a stated objective, real constraints, and a walk-away point.
* **Counterparts** — five archetypes, each chosen to stress a different scored
  dimension, plus user-authored counterparts describing a real person.
* **Debrief** — the mandate revealed, five scored dimensions with transcript
  citations, key moments with better lines, and one thing to change next time.
  Generated once per rehearsal and persisted.
* **Playbook** — the user's own notes on what works, mostly captured from
  debriefs and traceable back to the rehearsal that earned them.
* **Progress** — per-dimension trends across rehearsals, so the answer to "is
  this working" is per-skill rather than a single average.
* **Readiness dashboard** — organised around a real, dated conversation the
  user is preparing for, with a countdown to it.

### Data model

`rehearsals`, `rehearsal_turns`, `debriefs`, `custom_counterparts`,
`playbook_entries`, `upcoming_conversations`.

Scenarios and built-in counterparts are code, not tables, because a hidden
mandate is prompt logic and belongs in review.

### Safety

A layered content safety system whose checks all apply unconditionally, plus a
targeted-harm layer specific to this product, catching attempts to use the
rehearsal room to script coercion, blackmail, retaliation or unlawful treatment
of a specific real person.

### Business rules

* Metering is by **monthly rehearsals**. A rehearsal has a natural end, so the quota is something a user can reason about
  before buying, and there is no incentive to cut a rehearsal short.
* Plans are Free / Practitioner / Professional / Team.
* Entitlement has a single source of truth (`subscriptions.plan`).
* No device fingerprinting: the free tier is a server-enforced quota, which is
  harder to evade and does not require fingerprinting visitors.

### Notifications

No re-engagement messaging. Parley notifies about a conversation the user
scheduled themselves, or work it has finished for them. The email endpoint has
no type for anything else.
