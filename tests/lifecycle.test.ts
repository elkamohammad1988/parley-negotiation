import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REHEARSAL_STATUSES,
  TRANSITIONS,
  acceptsTurns,
  canGenerateDebrief,
  canTransition,
  isTerminal,
  mandateMayBeRevealed,
  toRehearsalStatus,
  type RehearsalStatus,
} from '@/lib/negotiation/lifecycle'

// The state machine is enforced in Postgres (transition_rehearsal), and mirrored
// in TypeScript so the app can avoid making calls it knows will be refused.
// Two things therefore need testing: that the machine is the shape we intend,
// and that the two copies of it have not drifted apart.

const LEGAL: [RehearsalStatus, RehearsalStatus][] = [
  ['draft', 'live'],
  ['draft', 'failed'],
  ['live', 'ended'],
  ['live', 'expired'],
  ['live', 'failed'],
  ['ended', 'debriefed'],
  ['ended', 'failed'],
  ['expired', 'debriefed'],
  ['expired', 'failed'],
]

describe('legal transitions', () => {
  for (const [from, to] of LEGAL) {
    it(`allows ${from} -> ${to}`, () => {
      expect(canTransition(from, to)).toBe(true)
    })
  }
})

describe('rejected transitions', () => {
  // Exhaustive: every ordered pair that is not on the legal list, including
  // self-transitions. Enumerated rather than spot-checked, so widening the
  // machine by accident fails here.
  const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`))
  const rejected: [RehearsalStatus, RehearsalStatus][] = []
  for (const from of REHEARSAL_STATUSES) {
    for (const to of REHEARSAL_STATUSES) {
      if (!legalSet.has(`${from}->${to}`)) rejected.push([from, to])
    }
  }

  it('has a rejected set covering the rest of the matrix', () => {
    expect(rejected.length).toBe(REHEARSAL_STATUSES.length ** 2 - LEGAL.length)
  })

  for (const [from, to] of rejected) {
    it(`rejects ${from} -> ${to}`, () => {
      expect(canTransition(from, to)).toBe(false)
    })
  }
})

describe('the transitions that matter to the product', () => {
  it('cannot reopen a scored rehearsal', () => {
    // The whole reason debriefs are generated once: a reopened rehearsal could
    // be re-ended and re-scored, and the progress trend would stop meaning
    // anything.
    for (const to of REHEARSAL_STATUSES) {
      expect(canTransition('debriefed', to)).toBe(false)
    }
    expect(isTerminal('debriefed')).toBe(true)
  })

  it('cannot score a rehearsal twice', () => {
    expect(canTransition('ended', 'debriefed')).toBe(true)
    expect(canTransition('debriefed', 'debriefed')).toBe(false)
  })

  it('cannot end a rehearsal twice into a different reason', () => {
    expect(canTransition('live', 'ended')).toBe(true)
    expect(canTransition('ended', 'ended')).toBe(false)
    expect(canTransition('ended', 'expired')).toBe(false)
  })

  it('cannot take turns anywhere but live', () => {
    for (const s of REHEARSAL_STATUSES) {
      expect(acceptsTurns(s)).toBe(s === 'live')
    }
  })

  it('can only score a transcript that has stopped growing and is unscored', () => {
    expect(REHEARSAL_STATUSES.filter(canGenerateDebrief).sort()).toEqual(['ended', 'expired'])
  })

  it('treats an unrecognised status as failed, never as live', () => {
    for (const junk of ['', 'complete', 'abandoned', 'LIVE', null, undefined, 42]) {
      expect(toRehearsalStatus(junk)).toBe('failed')
    }
  })
})

describe('the mandate rule', () => {
  it('seals the mandate in exactly the states where it could still change play', () => {
    expect(REHEARSAL_STATUSES.filter(s => !mandateMayBeRevealed(s)).sort()).toEqual([
      'draft',
      'failed',
      'live',
    ])
  })

  it('never reveals in a state that still accepts turns', () => {
    for (const s of REHEARSAL_STATUSES) {
      if (acceptsTurns(s)) expect(mandateMayBeRevealed(s)).toBe(false)
    }
  })
})

// ── The two copies of the machine must agree ────────────────────────────────

const SQL = readFileSync(join(process.cwd(), 'supabase_migrations.sql'), 'utf-8')

describe('supabase_migrations.sql matches lib/negotiation/lifecycle.ts', () => {
  it('declares the same set of states in the check constraint', () => {
    const match = SQL.match(/check \(status in \(([^)]*)\)\)/)
    expect(match, 'no status check constraint found in the schema').toBeTruthy()
    const sqlStates = [...(match?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map(m => m[1])
    expect(sqlStates.sort()).toEqual([...REHEARSAL_STATUSES].sort())
  })

  it('encodes the same transition table in transition_rehearsal()', () => {
    // Parses the `case v_from when 'x' then array[...]` block and rebuilds the
    // transition map from it, so a change in one copy and not the other fails.
    const block = SQL.match(/v_legal := case v_from([\s\S]*?)end;/)
    expect(block, 'no v_legal case block found in transition_rehearsal()').toBeTruthy()

    const fromSql: Record<string, string[]> = {}
    for (const m of (block?.[1] ?? '').matchAll(/when '(\w+)'\s+then array\[([^\]]*)\]/g)) {
      fromSql[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1])
    }

    // Anything not named in the case block falls through to `else array[]`,
    // which is how the terminal states are expressed in SQL.
    for (const state of REHEARSAL_STATUSES) {
      const sqlTargets = (fromSql[state] ?? []).sort()
      const tsTargets = [...TRANSITIONS[state]].sort()
      expect(sqlTargets, `transitions out of '${state}' disagree between SQL and TS`).toEqual(
        tsTargets
      )
    }
  })

  it('declares the same end reasons', () => {
    const match = SQL.match(/check \(end_reason in \(([^)]*)\)\)/)
    expect(match, 'no end_reason check constraint found').toBeTruthy()
    const sqlReasons = [...(match?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map(m => m[1])
    expect(sqlReasons.sort()).toEqual(['abandoned', 'completed', 'expired', 'failed'])
  })

  it('still enforces one debrief per rehearsal', () => {
    // The idempotency guarantee is the constraint, not the application code.
    expect(SQL).toMatch(/rehearsal_id uuid not null unique references public\.rehearsals/)
    expect(SQL).toMatch(/create unique index if not exists debriefs_one_per_rehearsal_idx/)
  })

  it('keeps a ledger of Stripe event ids for webhook idempotency', () => {
    expect(SQL).toMatch(/create table if not exists public\.stripe_events/)
    expect(SQL).toMatch(/id text primary key/)
  })

  it('locks the row before deciding, so two callers cannot both pass the check', () => {
    // Without `for update` the function is just the old read-then-write race
    // relocated into the database.
    const fn = SQL.match(/create or replace function public\.transition_rehearsal[\s\S]*?\$\$;/)
    expect(fn?.[0]).toMatch(/for update/)
  })

  it('keeps the two security-definer functions server-only', () => {
    // Postgres grants EXECUTE on a new function to PUBLIC by default, and both
    // functions take the user id as an argument rather than reading auth.uid().
    // Without the revoke, the public anon key could call them through
    // PostgREST's RPC endpoint and end or claim another user's rehearsal.
    // Executing the schema against a Postgres engine in Phase 1B showed the
    // `authenticated` role could call transition_rehearsal() before this was
    // added; the revoke must survive any future reshuffle of the file.
    for (const signature of [
      'transition_rehearsal\\(uuid, uuid, text, text\\)',
      'claim_debrief\\(uuid, uuid, interval\\)',
    ]) {
      expect(SQL).toMatch(
        new RegExp(`grant execute on function public\\.${signature} to service_role;`)
      )
      expect(SQL).toMatch(
        new RegExp(
          `revoke execute on function public\\.${signature} from public, anon, authenticated;`
        )
      )
    }
  })
})
