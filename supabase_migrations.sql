-- ═══════════════════════════════════════════════════════════════════════════
-- Parley — Supabase schema
--
-- Run against your own Supabase project via Dashboard > SQL Editor, or:
--   psql $DATABASE_URL < supabase_migrations.sql
--
-- This schema is written for a fresh Parley project. It is NOT a migration
-- from any earlier schema and must not be run against an unrelated existing
-- database — several table names are reused with different meanings.
--
-- Shape of the model, in one paragraph: a USER opens a REHEARSAL against a
-- scenario and a counterpart; the conversation is stored as REHEARSAL_TURNS;
-- once it ends, exactly one DEBRIEF scores it and holds the revealed mandate.
-- Everything else hangs off those four. Scenarios and built-in counterparts
-- are deliberately NOT tables — they are versioned code in lib/negotiation/,
-- because a scenario's hidden mandate is prompt logic and belongs in review,
-- not in a row someone can edit in a dashboard.
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================
-- 001: Users
-- ============================================================

create table if not exists public.users (
  id uuid primary key,
  email text unique,
  display_name text,
  -- Soft ownership binding — see lib/ownership.ts. Not authentication.
  device_token text,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (email);

-- RLS is enabled on every table in this schema, and only `users` is given
-- policies. That split is deliberate:
--
--   Every other table is reached exclusively through this app's API routes,
--   which use the service-role key (service_role bypasses RLS). Enabling RLS
--   with no policy makes those tables deny-by-default for the browser's
--   anon key, which is exactly what we want — the app layer is the only gate.
--
--   `users` is the one table the browser writes to directly, at sign-up and
--   in the OAuth callback. Without the policies below those upserts are
--   silently rejected, no users row is ever created, and the device-token
--   ownership binding in lib/ownership.ts never activates — it only claims a
--   token when a row already exists.
alter table public.users enable row level security;

-- Postgres has no "create policy if not exists", and every other statement in
-- this file is safely re-runnable. Dropping first keeps that property, so
-- re-applying the file is not a half-executed migration.
drop policy if exists "Users can read own row" on public.users;
create policy "Users can read own row"
  on public.users for select
  using (auth.uid() = id);

drop policy if exists "Users can create own row" on public.users;
create policy "Users can create own row"
  on public.users for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own row" on public.users;
create policy "Users can update own row"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- COLUMN PRIVILEGES, because the policy above is not enough on its own.
--
-- "Users can update own row" says WHICH row a signed-in browser may write. It
-- cannot say which COLUMNS, and two of them are not the user's to set:
--
--   banned        is how lib/safety.ts suspends an account after a critical
--                 violation. With a blanket update grant, the suspended
--                 account could clear its own flag from the browser console
--                 with one supabase-js call — the ban would last exactly as
--                 long as it took to notice it.
--   device_token  is the soft ownership binding in lib/ownership.ts. The
--                 server claims it on a user's first request; letting the
--                 browser overwrite it directly would let a signed-in account
--                 rebind an id at will, which is the one thing the binding
--                 exists to prevent.
--
-- Neither is ever written by the browser: grep for `from('users')` outside
-- lib/supabase-server and the only payloads are id, email, display_name and
-- created_at, in app/signup and app/auth/callback. Those four are granted; the
-- other two are reachable through the service-role key alone.
--
-- `id` and `created_at` are in the update list because PostgREST's upsert
-- (resolution=merge-duplicates) emits every column of the payload in its
-- ON CONFLICT DO UPDATE SET, including the conflict target. Without them the
-- sign-up upsert fails with 42501 and no users row is ever created.
revoke update on table public.users from anon, authenticated;
revoke insert on table public.users from anon, authenticated;
grant insert (id, email, display_name, created_at) on table public.users to anon, authenticated;
grant update (id, email, display_name, created_at) on table public.users to authenticated;

grant all on table public.users to service_role;

-- ============================================================
-- 002: Rehearsals — one timeboxed attempt at a scenario
-- ============================================================

create table if not exists public.rehearsals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- Slug into lib/negotiation/scenarios.ts. Intentionally not a foreign key:
  -- scenarios live in code, and a rehearsal must remain readable after a
  -- scenario is retired from the library.
  scenario_slug text not null,
  -- Denormalised so history stays legible even if the slug is later removed.
  scenario_title text not null,
  counterpart_id text not null,
  -- The lifecycle. Mirrors lib/negotiation/lifecycle.ts, which documents the
  -- machine; transition_rehearsal() below is what enforces it.
  --
  --   draft ──▶ live ──▶ ended ────▶ debriefed
  --     │        │         ▲
  --     │        └▶ expired┘
  --     └────────┴▶ failed
  --
  -- Rows start as 'draft', not 'live': a rehearsal is only live once the
  -- counterpart's opening turn has actually landed, and the two used to be
  -- indistinguishable when an insert succeeded but the opening turn did not.
  status text not null default 'draft'
    check (status in ('draft', 'live', 'ended', 'debriefed', 'expired', 'failed')),
  -- Why it left 'live'. Kept separate so 'ended' stays a single state while
  -- the product can still tell a completed rehearsal from a walk-out.
  end_reason text check (end_reason in ('completed', 'abandoned', 'expired', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  debriefed_at timestamptz,
  -- Set when a debrief generation starts, so a second tab does not pay for a
  -- second model call. See claim_debrief() in section 004.
  debrief_claimed_at timestamptz,
  duration_seconds integer,
  -- Copied from the debrief so history and progress views need no join.
  overall_score integer
);

-- Covers both the history list and the monthly quota count, which filters on
-- user_id and started_at (see lib/usageLimits.ts).
create index if not exists rehearsals_user_started_idx
  on public.rehearsals (user_id, started_at desc);
create index if not exists rehearsals_user_scenario_idx
  on public.rehearsals (user_id, scenario_slug);

-- Reaping a live rehearsal that outran its window relies on this.
create index if not exists rehearsals_status_started_idx
  on public.rehearsals (status, started_at);

alter table public.rehearsals enable row level security;
grant all on table public.rehearsals to service_role;

-- ------------------------------------------------------------
-- 002a: The lifecycle, enforced here rather than in the API
-- ------------------------------------------------------------
-- Ending a rehearsal twice and scoring one twice were both guarded only by an
-- application-layer read followed by a write — which is a race, not a
-- guarantee. Two tabs, or one retried request, could both pass the read.
--
-- transition_rehearsal() closes that by doing the check and the write in a
-- single statement under a row lock. Its contract:
--
--   * a LEGAL transition performs the move and returns changed = true
--   * a repeat of the state it is already in is a NO-OP returning
--     changed = false, so an HTTP retry is safe rather than an error
--   * an ILLEGAL transition raises, so 'debriefed' can never go back to
--     'live' and a scored rehearsal can never be re-ended and re-scored
--
-- The no-op case is what makes "end twice" idempotent; the raise is what makes
-- "reopen a scored rehearsal" impossible. Both matter, and they are different.
create or replace function public.transition_rehearsal(
  p_rehearsal_id uuid,
  p_user_id uuid,
  p_to text,
  p_end_reason text default null
)
returns table (status text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_legal text[];
begin
  -- Row lock: concurrent callers queue here instead of both reading 'live'.
  select r.status into v_from
    from public.rehearsals r
   where r.id = p_rehearsal_id and r.user_id = p_user_id
     for update;

  if v_from is null then
    raise exception 'rehearsal_not_found' using errcode = 'P0002';
  end if;

  -- Already there. Not an error: this is the retried-request path.
  if v_from = p_to then
    return query select v_from, false;
    return;
  end if;

  v_legal := case v_from
    when 'draft'   then array['live', 'failed']
    when 'live'    then array['ended', 'expired', 'failed']
    when 'ended'   then array['debriefed', 'failed']
    when 'expired' then array['debriefed', 'failed']
    else array[]::text[]
  end;

  if not (p_to = any (v_legal)) then
    raise exception 'illegal_transition:%->%', v_from, p_to using errcode = 'P0001';
  end if;

  update public.rehearsals r
     set status = p_to,
         end_reason = coalesce(p_end_reason, r.end_reason),
         ended_at = case
           when p_to in ('ended', 'expired', 'failed') then coalesce(r.ended_at, now())
           else r.ended_at
         end,
         debriefed_at = case when p_to = 'debriefed' then now() else r.debriefed_at end,
         duration_seconds = case
           when p_to in ('ended', 'expired', 'failed')
             then coalesce(r.duration_seconds, greatest(0, extract(epoch from (now() - r.started_at))::integer))
           else r.duration_seconds
         end
   where r.id = p_rehearsal_id and r.user_id = p_user_id;

  return query select p_to, true;
end;
$$;

grant execute on function public.transition_rehearsal(uuid, uuid, text, text) to service_role;
-- Only the server may call this. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and Supabase's default privileges add anon and
-- authenticated on top — so without these revokes the function is reachable
-- through PostgREST's RPC endpoint with the public anon key. It runs as its
-- owner (security definer) and takes the user id as an argument rather than
-- reading auth.uid(), so that would let anyone holding a rehearsal id and its
-- owner's id end, expire or fail that rehearsal. Found by executing this file
-- against a Postgres engine in Phase 1B (docs/phase-1-verification.md).
revoke execute on function public.transition_rehearsal(uuid, uuid, text, text) from public, anon, authenticated;

-- ============================================================
-- 003: Rehearsal turns — the transcript
-- ============================================================

create table if not exists public.rehearsal_turns (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references public.rehearsals(id) on delete cascade,
  side text not null check (side in ('you', 'counterpart')),
  content text not null,
  -- 0-based index within the rehearsal. Debrief key moments point at these,
  -- so the ordering has to be stable and gap-free rather than timestamp-based.
  position integer not null,
  created_at timestamptz not null default now(),
  unique (rehearsal_id, position)
);

create index if not exists rehearsal_turns_rehearsal_idx
  on public.rehearsal_turns (rehearsal_id, position);

alter table public.rehearsal_turns enable row level security;
grant all on table public.rehearsal_turns to service_role;

-- ============================================================
-- 004: Debriefs — the scored read of a finished rehearsal
-- ============================================================

create table if not exists public.debriefs (
  id uuid primary key default gen_random_uuid(),
  -- One debrief per rehearsal, enforced here rather than in application code:
  -- re-scoring the same transcript would produce different numbers each time
  -- and make the progress trend meaningless.
  rehearsal_id uuid not null unique references public.rehearsals(id) on delete cascade,
  user_id uuid not null,
  overall_score integer not null,
  -- [{ dimension, score, note }] — shape in lib/negotiation/types.ts
  dimensions jsonb not null default '[]'::jsonb,
  -- [{ turnPosition, kind, label, betterLine? }]
  key_moments jsonb not null default '[]'::jsonb,
  outcome text not null check (outcome in ('agreement', 'partial', 'no-agreement', 'walked-away')),
  one_thing text not null default '',
  -- The counterpart's mandate, snapshotted at debrief time so an old debrief
  -- still reveals what was actually true during that rehearsal even after the
  -- scenario has been retuned in code.
  mandate_reveal text not null default '',
  -- The scenario's mandate levers as they stood when this rehearsal was
  -- scored, each carrying found true/false. The WHOLE set, not just the ones
  -- the buyer surfaced, and snapshotted for the same reason as mandate_reveal
  -- directly above: the reveal renders found against missed, and it has to
  -- keep rendering the same figures after the scenario is retuned in code.
  -- Storing ids alone would resolve them against a live scenario at render
  -- time, so adding a seventh lever next month would quietly restate an old
  -- "two of six" as "two of seven".
  levers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Additive, and separate from the create above, because `create table if not
-- exists` is a no-op on a database that already has the table — so a schema
-- that predates levers would silently never gain the column. Debriefs written
-- before it exists keep the default and render without a lever ledger, which
-- is the correct reading: nothing was scored against one.
alter table public.debriefs
  add column if not exists levers jsonb not null default '[]'::jsonb;

create index if not exists debriefs_user_created_idx
  on public.debriefs (user_id, created_at asc);

-- The one-debrief-per-rehearsal rule is carried by the `unique` on
-- rehearsal_id in the column definition above. Named explicitly here so it is
-- greppable and so the intent survives a future column reshuffle: a duplicate
-- INSERT raises 23505, which app/api/debrief/route.ts catches and answers by
-- returning the debrief that already exists. That is what makes generation
-- idempotent under a retry or a second tab — the constraint is the guarantee,
-- and the application code is only the polite handling of it.
create unique index if not exists debriefs_one_per_rehearsal_idx
  on public.debriefs (rehearsal_id);

alter table public.debriefs enable row level security;
grant all on table public.debriefs to service_role;

-- ------------------------------------------------------------
-- 004a: Claiming a debrief before generating it
-- ------------------------------------------------------------
-- The unique index above makes a duplicate debrief impossible, but it only
-- fires at INSERT — by which point both callers have already paid for a full
-- transcript-in, analysis-out model call. This claims the right to generate
-- first, so the second caller finds out cheaply.
--
-- The stale window exists because a claim can be orphaned: the process holding
-- it can die between claiming and inserting. After it lapses the claim can be
-- taken again, so a crashed generation does not strand a rehearsal unscored
-- forever.
create or replace function public.claim_debrief(
  p_rehearsal_id uuid,
  p_user_id uuid,
  p_stale_after interval default interval '3 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  update public.rehearsals r
     set debrief_claimed_at = now()
   where r.id = p_rehearsal_id
     and r.user_id = p_user_id
     and r.status in ('ended', 'expired')
     and (r.debrief_claimed_at is null or r.debrief_claimed_at < now() - p_stale_after)
     and not exists (select 1 from public.debriefs d where d.rehearsal_id = r.id)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

grant execute on function public.claim_debrief(uuid, uuid, interval) to service_role;
-- Same reasoning as transition_rehearsal() above: server-only, so the default
-- public EXECUTE is withdrawn. Left callable, this would let the anon key hold
-- another user's debrief claim for the whole stale window, on repeat.
revoke execute on function public.claim_debrief(uuid, uuid, interval) from public, anon, authenticated;

-- ============================================================
-- 005: Custom counterparts
-- ============================================================

create table if not exists public.custom_counterparts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  role text not null,
  disposition text not null,
  -- Array of short strings. Length-bounded in the API before it lands here.
  tactics jsonb not null default '[]'::jsonb,
  tell text,
  created_at timestamptz not null default now()
);

create index if not exists custom_counterparts_user_idx
  on public.custom_counterparts (user_id, created_at desc);

alter table public.custom_counterparts enable row level security;
grant all on table public.custom_counterparts to service_role;

-- ============================================================
-- 006: Playbook — the user's own notes on what works
-- ============================================================

create table if not exists public.playbook_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  note text not null,
  -- Optional filing against one of the five scored dimensions.
  dimension text,
  -- Where the note came from, so an entry is always traceable to the moment
  -- it was earned. Nulled rather than cascaded: deleting a rehearsal should
  -- not silently delete the lesson the user took from it.
  source_rehearsal_id uuid references public.rehearsals(id) on delete set null,
  source_scenario_title text,
  created_at timestamptz not null default now()
);

create index if not exists playbook_entries_user_idx
  on public.playbook_entries (user_id, created_at desc);

alter table public.playbook_entries enable row level security;
grant all on table public.playbook_entries to service_role;

-- ============================================================
-- 007: Upcoming conversations — what the user is actually preparing for
-- ============================================================
-- The dashboard is organised around a real, dated conversation rather than
-- around usage. This is the row that makes that possible, and it is why
-- onboarding asks for a date.

create table if not exists public.upcoming_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  -- Nullable: plenty of hard conversations have no date yet, and forcing one
  -- would make people invent it.
  happens_on date,
  -- Optional link to the library scenario they are rehearsing against.
  scenario_slug text,
  notes text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists upcoming_conversations_user_idx
  on public.upcoming_conversations (user_id, resolved, happens_on asc);

alter table public.upcoming_conversations enable row level security;
grant all on table public.upcoming_conversations to service_role;

-- ============================================================
-- 008: Subscriptions
-- ============================================================

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  plan text not null default 'free' check (plan in ('free', 'practitioner', 'professional', 'team')),
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- The `created` timestamp of the most recent Stripe event applied to this
  -- row. Webhook delivery is not ordered, so an update that arrives after the
  -- cancellation it precedes must not overwrite it. Every subscription write
  -- in app/api/stripe-webhook compares against this and drops stale events.
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_stripe_idx on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;
grant all on table public.subscriptions to service_role;

-- ------------------------------------------------------------
-- 008a: Rehearsal quota, enforced in the database
-- ------------------------------------------------------------
-- The monthly rehearsal quota is the product's paid boundary, and it was
-- checked only in app/api/rehearsal/session before the insert. That is a
-- read-then-write like every other one in this schema: two rooms opened at
-- once both read "2 of 3 used" and both proceed. It is also one forgotten
-- `if` away from not being enforced at all, in the one place where not
-- enforcing it costs money.
--
-- So the limit is enforced here as well, as a BEFORE INSERT trigger. The API
-- check stays — it is what produces a civil 402 with a number in it, rather
-- than an exception — but it is no longer the thing that decides.
--
-- WHY A TABLE AND NOT A HARDCODED CASE: these values must match
-- PLAN_FEATURES.monthlyRehearsals in lib/plans.ts, which is what the pricing
-- page renders and what the API checks. Two copies of a number that must agree
-- is a bug waiting to happen, so tests/quota.test.ts parses this table out of
-- the schema and fails if it disagrees with the TypeScript.
create table if not exists public.plan_limits (
  plan text primary key check (plan in ('free', 'practitioner', 'professional', 'team')),
  -- -1 means unlimited, matching the convention in lib/plans.ts.
  monthly_rehearsals integer not null
);

insert into public.plan_limits (plan, monthly_rehearsals) values
  ('free', 3),
  ('practitioner', 25),
  ('professional', -1),
  ('team', -1)
on conflict (plan) do update set monthly_rehearsals = excluded.monthly_rehearsals;

alter table public.plan_limits enable row level security;
grant all on table public.plan_limits to service_role;

create or replace function public.enforce_rehearsal_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limit integer;
  v_used integer;
  v_month_start timestamptz;
begin
  -- An active or trialing subscription decides the plan; anything else is free.
  select s.plan into v_plan
    from public.subscriptions s
   where s.user_id = new.user_id
     and s.status in ('active', 'trialing')
   limit 1;

  v_plan := coalesce(v_plan, 'free');

  select pl.monthly_rehearsals into v_limit
    from public.plan_limits pl
   where pl.plan = v_plan;

  -- An unknown plan falls back to the free limit rather than to unlimited.
  v_limit := coalesce(v_limit, 3);

  if v_limit = -1 then
    return new;
  end if;

  -- Calendar month in UTC, matching monthStartIso() in lib/usageLimits.ts.
  v_month_start := date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  -- 'failed' rows are excluded: a rehearsal whose opening turn never landed is
  -- not one the user got to have, and charging them for it would be wrong.
  -- lib/usageLimits.ts excludes them from its count for the same reason.
  select count(*) into v_used
    from public.rehearsals r
   where r.user_id = new.user_id
     and r.started_at >= v_month_start
     and r.status <> 'failed';

  if v_used >= v_limit then
    raise exception 'rehearsal_quota_exceeded:%:%', v_used, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Postgres has no "create trigger if not exists", and this file is meant to be
-- re-runnable, so drop first.
drop trigger if exists rehearsals_quota_guard on public.rehearsals;
create trigger rehearsals_quota_guard
  before insert on public.rehearsals
  for each row execute function public.enforce_rehearsal_quota();

-- ============================================================
-- 009: Daily usage — cost guard, not a product-visible limit
-- ============================================================

create table if not exists public.usage_daily (
  user_id uuid not null,
  usage_date date not null,
  tokens_used bigint not null default 0,
  -- Unspent balance carries forward across days; see lib/usageLimits.ts,
  -- which does the carry-forward in application code.
  bonus_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.usage_daily enable row level security;
grant all on table public.usage_daily to service_role;

-- 009a: Adding to a day's usage in one statement
-- ------------------------------------------------------------
-- The deployment-wide row (the nil uuid, see lib/usageLimits.ts) is written by
-- every turn of every visitor at once. Read-then-write in the application
-- loses increments under exactly that concurrency, and a cost ceiling that
-- undercounts the burst it exists to stop is not a ceiling. The upsert creates
-- the day's row if needed and adds in the same statement, so concurrent calls
-- serialise on the row instead of overwriting each other.
create or replace function public.add_token_usage(
  p_user_id uuid,
  p_usage_date date,
  p_tokens bigint
)
returns bigint
language sql
set search_path = public
as $$
  insert into public.usage_daily as u (user_id, usage_date, tokens_used)
  values (p_user_id, p_usage_date, greatest(p_tokens, 0))
  on conflict (user_id, usage_date)
  do update set tokens_used = u.tokens_used + excluded.tokens_used,
                updated_at = now()
  returning u.tokens_used;
$$;

grant execute on function public.add_token_usage(uuid, date, bigint) to service_role;
-- Server-only. Callable with the anon key, anyone could push the global row
-- over its ceiling and close the demo for the day.
revoke execute on function public.add_token_usage(uuid, date, bigint) from public, anon, authenticated;

-- ============================================================
-- 010: Safety and compliance
-- ============================================================

-- Immutable by policy: no update or delete grant is issued, and nothing in the
-- application ever removes a row. 18 U.S.C. §2258A.
create table if not exists public.critical_violations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  category text not null,
  context text,
  message_hash text not null,
  message_preview text,
  logged_at timestamptz not null default now(),
  ip_hint text
);

create index if not exists critical_violations_user_idx on public.critical_violations (user_id);

alter table public.critical_violations enable row level security;
grant select, insert on table public.critical_violations to service_role;

create table if not exists public.safety_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  category text not null,
  -- Which rehearsal or surface produced the flag, e.g. "rehearsal:<slug>".
  context text,
  message_preview text,
  flagged_at timestamptz not null default now()
);

create index if not exists safety_flags_flagged_idx on public.safety_flags (flagged_at desc);

alter table public.safety_flags enable row level security;
grant all on table public.safety_flags to service_role;

-- Hash-only audit trail. Never stores plaintext.
create table if not exists public.compliance_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid,
  content_hash text,
  action_taken text,
  timestamp timestamptz not null default now()
);

alter table public.compliance_log enable row level security;
grant all on table public.compliance_log to service_role;

create table if not exists public.banned_users (
  user_id uuid primary key,
  reason text,
  banned_at timestamptz not null default now()
);

alter table public.banned_users enable row level security;
grant all on table public.banned_users to service_role;

-- ============================================================
-- 011: Product surfaces — reports, feedback
-- ============================================================
--
-- `notifications` and `push_subscriptions` were defined here until 2026-09-16
-- and are gone. The trigger module was imported by no file, `web-push` was a
-- dependency no file imported, and the three reminder toggles in Settings wrote
-- to localStorage that nothing read. The only writer either table ever had was
-- the Stripe webhook's "Your plan is active" row, inserted into a page that no
-- navigation reached.
-- The tables, the routes, the page and the service-worker handlers have all
-- been removed rather than left as a schema that describes a feature the
-- product does not have. An existing database that already ran this file can
-- drop both tables; nothing reads them.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  rehearsal_id uuid,
  reason text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
grant all on table public.reports to service_role;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  message text not null,
  page text,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;
grant all on table public.feedback to service_role;

-- ============================================================
-- 012: Stripe webhook event ledger
-- ============================================================
-- Stripe retries a webhook until it gets a 2xx, and it does not promise
-- exactly-once or in-order delivery. Without a ledger a retried
-- checkout.session.completed re-fires the "your plan is active" notification
-- and re-records the analytics event, and a delayed customer.subscription.updated
-- can land after the .deleted that supersedes it and quietly resurrect a
-- cancelled plan.
--
-- Two defences live here. This table is the first: the handler inserts the
-- event id before doing any work, and a duplicate insert (23505) means the
-- event has already been handled, so it acknowledges and stops. The second is
-- subscriptions.last_event_at in section 008, which makes an out-of-order
-- event a no-op rather than a regression.
create table if not exists public.stripe_events (
  -- Stripe's own event id (evt_...). The primary key IS the idempotency key.
  id text primary key,
  type text not null,
  -- Stripe's created timestamp, not ours: used to order events that arrive out
  -- of sequence.
  event_created timestamptz,
  -- Claiming the id alone is not enough. An event whose handler throws AFTER
  -- the claim would be marked seen while none of its work happened, and the
  -- retry would short-circuit on the duplicate — losing an entitlement change
  -- silently and permanently. So the ledger records progress, not just arrival:
  --
  --   processing  claimed, handler running (or the process died mid-handler)
  --   done        handler finished; a replay is safe to ignore
  --   failed      handler threw; the route returned 503 and Stripe will retry
  --
  -- Only 'done' short-circuits a redelivery. 'processing' and 'failed' both
  -- re-run the handler, which is safe because every write it performs is
  -- either an upsert or guarded by last_event_at.
  status text not null default 'processing'
    check (status in ('processing', 'done', 'failed')),
  -- Kept for triage: which handler failed and why, without digging through logs.
  last_error text,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists stripe_events_received_idx
  on public.stripe_events (received_at desc);

-- Finds events stuck mid-flight: claimed, never completed, and old enough that
-- the process holding them is gone.
create index if not exists stripe_events_status_idx
  on public.stripe_events (status, received_at desc);

alter table public.stripe_events enable row level security;
grant all on table public.stripe_events to service_role;

-- ============================================================
-- 013: Analytics
-- ============================================================
-- Metadata only. The event whitelist in lib/analytics.ts is the contract:
-- no transcript text, no playbook notes, no user-authored free text ever
-- reaches this table.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_idx
  on public.analytics_events (event_name, created_at desc);

alter table public.analytics_events enable row level security;
-- Tables created through the SQL editor do not auto-grant to service_role.
grant all on table public.analytics_events to service_role;
