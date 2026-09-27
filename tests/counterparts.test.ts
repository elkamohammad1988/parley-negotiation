import { beforeEach, describe, expect, it, vi } from 'vitest'

// Custom counterparts are stored by app/api/counterparts and offered on the
// brief page next to the built-ins. Until resolveCounterpart existed, only the
// built-ins resolved when a room was opened or a rehearsal loaded — so the UI
// offered a counterpart the session route then refused as unknown. These pin
// the resolution path and the two properties it must keep:
//
//   * a custom counterpart resolves only for the user who wrote it
//   * a rehearsal whose counterpart was later deleted stays readable, and
//     stops accepting turns

const USER = '11111111-1111-4111-8111-111111111111'
const CUSTOM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const customRow = {
  id: CUSTOM_ID,
  name: 'Dana',
  role: 'Regional director',
  disposition: 'Agrees with everything, then nothing changes.',
  tactics: ['Brings up headcount whenever scope comes up', 42],
  tell: null,
}

// A supabase-js stand-in that records the filters applied, so a test can
// assert the custom lookup is scoped to the user, and lets each test steer
// the terminal result. `maybeSingle` answers single-row reads and the insert;
// awaiting the chain itself answers list reads.
type DbResult = { data: unknown; error: { message: string; code?: string } | null }
const calls = vi.hoisted(() => ({
  from: [] as string[],
  eq: [] as [string, unknown][],
  in: [] as [string, unknown][],
  insert: [] as unknown[],
}))
const maybeSingle = vi.hoisted(() =>
  vi.fn<() => Promise<DbResult>>(async () => ({ data: null, error: null }))
)
const listResult = vi.hoisted(() =>
  vi.fn<() => Promise<DbResult>>(async () => ({ data: [], error: null }))
)
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    from: (table: string) => { calls.from.push(table); return chain },
    select: () => chain,
    eq: (column: string, value: unknown) => { calls.eq.push([column, value]); return chain },
    in: (column: string, value: unknown) => { calls.in.push([column, value]); return chain },
    insert: (row: unknown) => { calls.insert.push(row); return chain },
    update: () => chain,
    order: () => chain,
    limit: () => chain,
    gte: () => chain,
    neq: () => chain,
    maybeSingle,
    then: (onFulfilled: (v: DbResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      listResult().then(onFulfilled, onRejected),
  })
  return { supabaseServer: chain }
})

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return {
    ...actual,
    verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })),
    clientIp: () => 'counterparts-test-ip',
  }
})

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(async () => {}) }))

vi.mock('@/lib/usageLimits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
  return {
    ...actual,
    getRehearsalQuota: vi.fn(async () => ({ used: 0, limit: 3, remaining: 3, allowed: true })),
    // Reads usage_daily, which would consume a queued response from the
    // supabase mock below. Covered on its own in tests/global-budget.test.ts.
    isOverGlobalBudget: vi.fn(async () => false),
  }
})

// Only the pieces the session route needs stubbed. resolveCounterpart,
// loadRehearsal and listRehearsals stay real — they are what is under test.
const transitionRehearsal = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, status: 'live' as const, changed: true }))
)
vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return {
    ...actual,
    getUserPlan: vi.fn(async () => 'free' as const),
    appendTurn: vi.fn(async () => true),
    transitionRehearsal,
  }
})

function postRequest(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: () => undefined },
  } as never
}

beforeEach(() => {
  calls.from.length = 0
  calls.eq.length = 0
  calls.in.length = 0
  calls.insert.length = 0
  maybeSingle.mockReset()
  maybeSingle.mockResolvedValue({ data: null, error: null })
  listResult.mockReset()
  listResult.mockResolvedValue({ data: [], error: null })
  transitionRehearsal.mockClear()
})

// ── Resolution ──────────────────────────────────────────────────────────────

describe('resolveCounterpart', () => {
  it('resolves a built-in without touching the database', async () => {
    const { resolveCounterpart } = await import('@/lib/rehearsals')
    const found = await resolveCounterpart('closer', USER)

    expect(found?.builtIn).toBe(true)
    expect(found?.name).toBe('The Closer')
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('resolves a custom counterpart for its owner, scoped to that owner', async () => {
    maybeSingle.mockResolvedValue({ data: customRow, error: null })
    const { resolveCounterpart } = await import('@/lib/rehearsals')
    const found = await resolveCounterpart(CUSTOM_ID, USER)

    expect(found).toMatchObject({ id: CUSTOM_ID, name: 'Dana', builtIn: false })
    // A tactic that is not a string is dropped rather than reaching the prompt.
    expect(found?.tactics).toEqual(['Brings up headcount whenever scope comes up'])
    expect(found?.tell).toBe('')
    expect(found?.retired).toBeUndefined()

    // The property that makes this an authorisation boundary: the query is
    // filtered by the verified user id, not just by the counterpart id.
    expect(calls.from).toContain('custom_counterparts')
    expect(calls.eq).toContainEqual(['id', CUSTOM_ID])
    expect(calls.eq).toContainEqual(['user_id', USER])
  })

  it('resolves to nothing when the row is not this user\'s to see', async () => {
    // What the scoped query returns for someone else's counterpart, or for an
    // id that does not exist. The caller is not told which.
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { resolveCounterpart } = await import('@/lib/rehearsals')

    expect(await resolveCounterpart(CUSTOM_ID, USER)).toBeNull()
  })

  it('never queries for an id that is neither a built-in nor a uuid', async () => {
    const { resolveCounterpart } = await import('@/lib/rehearsals')

    expect(await resolveCounterpart('not-a-real-id', USER)).toBeNull()
    expect(await resolveCounterpart('', USER)).toBeNull()
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('resolves to nothing on a database error rather than inventing a counterpart', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const { resolveCounterpart } = await import('@/lib/rehearsals')

    expect(await resolveCounterpart(CUSTOM_ID, USER)).toBeNull()
  })
})

// ── Opening a room ──────────────────────────────────────────────────────────

describe('POST /api/rehearsal/session — a custom counterpart', () => {
  it('opens the room against one of the user\'s own counterparts', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: customRow, error: null })    // the custom lookup
      .mockResolvedValueOnce({ data: { id: 'r-new' }, error: null }) // the insert
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest({ userId: USER, scenarioSlug: 'renewal-uplift', counterpartId: CUSTOM_ID }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rehearsalId).toBe('r-new')
    expect(calls.insert).toContainEqual(expect.objectContaining({ counterpart_id: CUSTOM_ID, user_id: USER }))
  })

  it('refuses a counterpart that does not resolve for this user, before inserting anything', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest({ userId: USER, scenarioSlug: 'renewal-uplift', counterpartId: CUSTOM_ID }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown counterpart.')
    expect(calls.insert).toHaveLength(0)
  })

  it('marks a room failed when it cannot be brought live, so it does not count', async () => {
    transitionRehearsal.mockResolvedValueOnce({ ok: false, reason: 'error', detail: 'timeout' } as never)
    maybeSingle.mockResolvedValueOnce({ data: { id: 'r-stuck' }, error: null })
    const { POST } = await import('@/app/api/rehearsal/session/route')

    const res = await POST(postRequest({ userId: USER, scenarioSlug: 'renewal-uplift', counterpartId: 'closer' }))

    expect(res.status).toBe(500)
    expect(transitionRehearsal).toHaveBeenCalledWith('r-stuck', USER, 'failed', 'failed')
  })
})

// ── Reading a rehearsal whose counterpart is gone ───────────────────────────

const rehearsalRow = {
  id: 'r1',
  user_id: USER,
  scenario_slug: 'renewal-uplift',
  scenario_title: 'A 22% uplift on your largest software renewal',
  counterpart_id: CUSTOM_ID,
  status: 'ended',
  end_reason: 'completed',
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:12:00Z',
  duration_seconds: 720,
  overall_score: null,
}

describe('loadRehearsal after the custom counterpart was deleted', () => {
  it('still serves the record, under a flagged stand-in', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: rehearsalRow, error: null }) // the rehearsal
      .mockResolvedValueOnce({ data: null, error: null })         // the counterpart is gone
    const { loadRehearsal } = await import('@/lib/rehearsals')

    const loaded = await loadRehearsal('r1', USER)

    expect(loaded).not.toBeNull()
    expect(loaded?.rehearsal.status).toBe('ended')
    expect(loaded?.counterpart).toMatchObject({ id: CUSTOM_ID, builtIn: false, retired: true })
    expect(loaded?.counterpart.disposition).toBe('')
  })

  it('still resolves a built-in the same way it always did', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { ...rehearsalRow, counterpart_id: 'ally' }, error: null })
    const { loadRehearsal } = await import('@/lib/rehearsals')

    const loaded = await loadRehearsal('r1', USER)

    expect(loaded?.counterpart).toMatchObject({ id: 'ally', builtIn: true })
    expect(loaded?.counterpart.retired).toBeUndefined()
    // One read for the rehearsal, none for the counterpart.
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })
})

// ── History ─────────────────────────────────────────────────────────────────

describe('listRehearsals', () => {
  it('names custom counterparts from one scoped lookup', async () => {
    listResult
      .mockResolvedValueOnce({
        data: [
          { ...rehearsalRow, id: 'r1', counterpart_id: CUSTOM_ID },
          { ...rehearsalRow, id: 'r2', counterpart_id: 'closer' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: CUSTOM_ID, name: 'Dana' }], error: null })
    const { listRehearsals } = await import('@/lib/rehearsals')

    const rows = await listRehearsals(USER)

    expect(rows.map(r => r.counterpartName)).toEqual(['Dana', 'The Closer'])
    expect(calls.in).toContainEqual(['id', [CUSTOM_ID]])
    expect(calls.eq).toContainEqual(['user_id', USER])
  })

  it('does not look anything up when every counterpart is a built-in', async () => {
    listResult.mockResolvedValueOnce({
      data: [{ ...rehearsalRow, counterpart_id: 'deflector' }],
      error: null,
    })
    const { listRehearsals } = await import('@/lib/rehearsals')

    const rows = await listRehearsals(USER)

    expect(rows[0].counterpartName).toBe('The Deflector')
    expect(listResult).toHaveBeenCalledTimes(1)
  })
})

// ── The tell reaches the model ──────────────────────────────────────────────
//
// Every built-in has carried a `tell` since the bench existed, the landing page
// and the bench page both render it as the thing you learn to read, and until
// 2026-09-15 buildCounterpartPrompt never received it. The product described a
// signal it did not generate, which is the one kind of bug a passing test suite
// and a clean screenshot will both miss.
//
// These pin the three properties that make it worth having: it is sent, it is
// conditional rather than constant, and a counterpart without one produces no
// section at all rather than an empty heading.
describe('the counterpart tell in the system prompt', () => {
  it('sends every built-in its own tell', async () => {
    const { buildCounterpartPrompt } = await import('@/lib/negotiation/prompt')
    const { BUILT_IN_COUNTERPARTS } = await import('@/lib/negotiation/counterparts')
    const { SCENARIOS } = await import('@/lib/negotiation/scenarios')

    for (const counterpart of BUILT_IN_COUNTERPARTS) {
      const prompt = buildCounterpartPrompt({
        scenario: SCENARIOS[0],
        counterpart,
        elapsedMinutes: 5,
        userTurnCount: 4,
      })
      expect(counterpart.tell, `${counterpart.id} has no tell to send`).toBeTruthy()
      expect(prompt, counterpart.id).toContain(counterpart.tell)
      expect(prompt, counterpart.id).toContain('WHAT CHANGES WHEN YOU ARE CLOSE')
    }
  })

  it('frames the tell as a condition rather than as a habit', async () => {
    const { buildCounterpartPrompt } = await import('@/lib/negotiation/prompt')
    const { BUILT_IN_COUNTERPARTS } = await import('@/lib/negotiation/counterparts')
    const { SCENARIOS } = await import('@/lib/negotiation/scenarios')

    const prompt = buildCounterpartPrompt({
      scenario: SCENARIOS[0],
      counterpart: BUILT_IN_COUNTERPARTS[0],
      elapsedMinutes: 5,
      userTurnCount: 4,
    })

    // A tell performed on every turn is a tic, and a tic is not a skill to
    // read. It must also stay a manner of speaking rather than a claim about
    // authority, which is what would turn it into a mandate disclosure.
    expect(prompt).toContain('only when it is actually true')
    expect(prompt).toContain('never while you are genuinely holding firm')
    // And it is never pointed at — the room gives no feedback.
    expect(prompt).toContain('Do not name it')
  })

  it('writes no section for a counterpart that has no tell', async () => {
    const { buildCounterpartPrompt } = await import('@/lib/negotiation/prompt')
    const { BUILT_IN_COUNTERPARTS } = await import('@/lib/negotiation/counterparts')
    const { SCENARIOS } = await import('@/lib/negotiation/scenarios')

    // What a custom counterpart saved without one resolves to — the column is
    // nullable and rowToCounterpart maps null to an empty string.
    const prompt = buildCounterpartPrompt({
      scenario: SCENARIOS[0],
      counterpart: { ...BUILT_IN_COUNTERPARTS[0], tell: '' },
      elapsedMinutes: 5,
      userTurnCount: 4,
    })

    expect(prompt).not.toContain('WHAT CHANGES WHEN YOU ARE CLOSE')
    // The rest of the prompt is unaffected.
    expect(prompt).toContain('WHERE YOU ARE RIGHT NOW')
  })
})
