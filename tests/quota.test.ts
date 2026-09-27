import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_FEATURES, PLAN_ORDER, type Plan } from '@/lib/plans'

// The rehearsal quota is the product's paid boundary. It is enforced in two
// places that must agree: a BEFORE INSERT trigger in Postgres, which is what
// actually decides, and the API check, which is what produces a civil 402 with
// a number in it.
//
// Two copies of a limit is a bug waiting to happen, so the first block here
// parses the real schema and fails if the numbers have drifted.

const SQL = readFileSync(join(process.cwd(), 'supabase_migrations.sql'), 'utf-8')

describe('plan_limits in the schema matches lib/plans.ts', () => {
  /** The seeded rows, read out of the insert statement in the migration. */
  function seededLimits(): Record<string, number> {
    const block = SQL.match(/insert into public\.plan_limits[\s\S]*?;/)
    expect(block, 'no plan_limits seed found in the schema').toBeTruthy()
    const out: Record<string, number> = {}
    for (const m of (block?.[0] ?? '').matchAll(/\('([a-z]+)',\s*(-?\d+)\)/g)) {
      out[m[1]] = Number(m[2])
    }
    return out
  }

  it('seeds a row for every plan', () => {
    expect(Object.keys(seededLimits()).sort()).toEqual([...PLAN_ORDER].sort())
  })

  it('agrees with PLAN_FEATURES.monthlyRehearsals on every plan', () => {
    const limits = seededLimits()
    for (const plan of PLAN_ORDER) {
      expect(
        limits[plan],
        `plan_limits.${plan} in supabase_migrations.sql disagrees with PLAN_FEATURES in lib/plans.ts`
      ).toBe(PLAN_FEATURES[plan as Plan].monthlyRehearsals)
    }
  })

  it('uses -1 for unlimited in both places, not 0 or null', () => {
    // A 0 here would silently block every rehearsal on an unlimited plan.
    const limits = seededLimits()
    for (const plan of PLAN_ORDER) {
      if (PLAN_FEATURES[plan as Plan].monthlyRehearsals === -1) {
        expect(limits[plan]).toBe(-1)
      }
    }
  })
})

describe('the quota trigger', () => {
  const fn = SQL.match(/create or replace function public\.enforce_rehearsal_quota[\s\S]*?\$\$;/)?.[0] ?? ''

  it('exists and is wired as a BEFORE INSERT trigger', () => {
    expect(fn, 'enforce_rehearsal_quota() not found').toBeTruthy()
    expect(SQL).toMatch(/create trigger rehearsals_quota_guard\s+before insert on public\.rehearsals/)
  })

  it('treats an unlimited plan as unlimited', () => {
    expect(fn).toMatch(/if v_limit = -1 then\s+return new;/)
  })

  it('falls back to the free limit for an unknown plan, not to unlimited', () => {
    // coalesce(..., 3) — the failure direction matters: an unrecognised plan
    // must not become a free unlimited account.
    expect(fn).toMatch(/v_limit := coalesce\(v_limit, 3\)/)
    expect(PLAN_FEATURES.free.monthlyRehearsals).toBe(3)
  })

  it('only counts an active or trialing subscription toward the plan', () => {
    expect(fn).toMatch(/status in \('active', 'trialing'\)/)
  })

  it('counts the calendar month in UTC, like the API does', () => {
    expect(fn).toMatch(/date_trunc\('month', now\(\) at time zone 'utc'\) at time zone 'utc'/)
  })

  it('excludes failed rehearsals from the count', () => {
    // A room whose opening turn never landed is not one the user got to have.
    expect(fn).toMatch(/r\.status <> 'failed'/)
  })

  it('raises a message the API can parse back into used and limit', () => {
    expect(fn).toMatch(/rehearsal_quota_exceeded:%:%/)
  })
})

// ── The API still answers civilly when the trigger is the one that fires ────

const trackEvent = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/analytics', () => ({ trackEvent }))

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return {
    ...actual,
    verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })),
    clientIp: () => 'quota-test-ip',
  }
})

vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return {
    ...actual,
    getUserPlan: vi.fn(async () => 'free' as const),
    appendTurn: vi.fn(async () => true),
    transitionRehearsal: vi.fn(async () => ({ ok: true as const, status: 'live' as const, changed: true })),
  }
})

const quotaStatus = vi.hoisted(() =>
  vi.fn(async () => ({ used: 0, limit: 3, remaining: 3, allowed: true }))
)
vi.mock('@/lib/usageLimits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
  return { ...actual, getRehearsalQuota: quotaStatus }
})

type InsertResult = { data: { id: string } | null; error: { message: string } | null }
const insertResult = vi.hoisted(() =>
  vi.fn<() => Promise<InsertResult>>(async () => ({ data: { id: 'r-new' }, error: null }))
)
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self, in: self, order: self, limit: self,
    insert: self, update: self, upsert: self, delete: self, gte: self, neq: self, head: self,
    maybeSingle: () => insertResult(),
  })
  return { supabaseServer: chain }
})

function postRequest(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: () => undefined },
  } as never
}

const USER = '11111111-1111-4111-8111-111111111111'
const openRoom = { userId: USER, scenarioSlug: 'renewal-uplift', counterpartId: 'deflector' }

beforeEach(() => {
  trackEvent.mockReset()
  insertResult.mockReset()
  insertResult.mockResolvedValue({ data: { id: 'r-new' }, error: null })
  quotaStatus.mockReset()
  quotaStatus.mockResolvedValue({ used: 0, limit: 3, remaining: 3, allowed: true })
})

describe('POST /api/rehearsal/session — quota', () => {
  it('refuses before touching the database when the API check already knows', async () => {
    quotaStatus.mockResolvedValue({ used: 3, limit: 3, remaining: 0, allowed: false })
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest(openRoom))
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body).toMatchObject({ code: 'quota_exceeded', used: 3, limit: 3 })
    expect(insertResult).not.toHaveBeenCalled()
  })

  it('answers 402 identically when the trigger is what refuses', async () => {
    // The race the trigger exists for: two rooms opened at once both read
    // "2 of 3 used" and both pass the API check. The loser must get the same
    // civil message, not a 500.
    quotaStatus.mockResolvedValue({ used: 2, limit: 3, remaining: 1, allowed: true })
    insertResult.mockResolvedValue({
      data: null,
      error: { message: 'new row violates: rehearsal_quota_exceeded:3:3' },
    })
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest(openRoom))
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body.code).toBe('quota_exceeded')
    // Parsed out of the exception, so the number shown is the database's, not
    // the stale one the API read a moment earlier.
    expect(body.used).toBe(3)
    expect(body.limit).toBe(3)
  })

  it('still 500s an insert failure that is not a quota refusal', async () => {
    insertResult.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest(openRoom))
    expect(res.status).toBe(500)
  })

  it('opens the room when there is quota left', async () => {
    const { POST } = await import('@/app/api/rehearsal/session/route')
    const res = await POST(postRequest(openRoom))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rehearsalId).toBe('r-new')
  })
})
