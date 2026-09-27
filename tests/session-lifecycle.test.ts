import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getScenario } from '@/lib/negotiation/scenarios'
import type { RehearsalStatus } from '@/lib/negotiation/lifecycle'
import type { Scenario } from '@/lib/negotiation/types'

// End-to-end-ish tests for the two operations that could previously be done
// twice: ending a rehearsal, and scoring one. Both used to be a read followed
// by a write, which two tabs or one retried request could both pass.

const scenario = getScenario('renewal-uplift') as Scenario
const counterpart = {
  id: 'deflector', name: 'The Deflector', role: 'Manager',
  disposition: '', tactics: [], tell: '', builtIn: true,
}

const turns = [
  { id: 't0', rehearsalId: 'r1', side: 'counterpart' as const, content: scenario.opening, position: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: 't1', rehearsalId: 'r1', side: 'you' as const, content: 'What is available?', position: 1, createdAt: '2026-01-01T00:01:00Z' },
  { id: 't2', rehearsalId: 'r1', side: 'counterpart' as const, content: 'Not much.', position: 2, createdAt: '2026-01-01T00:02:00Z' },
  { id: 't3', rehearsalId: 'r1', side: 'you' as const, content: 'What about a title change?', position: 3, createdAt: '2026-01-01T00:03:00Z' },
]

function rehearsal(status: RehearsalStatus) {
  return {
    id: 'r1',
    userId: '11111111-1111-4111-8111-111111111111',
    scenarioSlug: scenario.slug,
    scenarioTitle: scenario.title,
    counterpartId: 'deflector',
    status,
    endReason: null,
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    durationSeconds: 600,
    turnCount: turns.length,
    overallScore: null,
  }
}

const USER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return {
    ...actual,
    verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })),
    // A fresh address per request: the per-IP rate limits are not what this
    // file tests, and with one shared address the eleventh debrief call here
    // would be refused as a burst before reaching the code under test.
    clientIp: () => `test-ip-${Math.random()}`,
  }
})

const trackEvent = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/analytics', () => ({ trackEvent }))

const loadRehearsal = vi.hoisted(() => vi.fn())
const transitionRehearsal = vi.hoisted(() => vi.fn())
const claimDebrief = vi.hoisted(() => vi.fn())
const releaseDebriefClaim = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return {
    ...actual,
    loadRehearsal,
    transitionRehearsal,
    claimDebrief,
    releaseDebriefClaim,
    getUserPlan: vi.fn(async () => 'free' as const),
  }
})

const complete = vi.hoisted(() => vi.fn())
vi.mock('@/lib/openrouter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/openrouter')>()
  return { ...actual, complete }
})

const recordTokenUsage = vi.hoisted(() => vi.fn(async (_u: string, _p: string, _t: number) => {}))
const isOverGlobalBudget = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/lib/usageLimits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
  return { ...actual, recordTokenUsage, isOverGlobalBudget }
})

// supabase-server stub whose terminal calls the tests can steer.
type DbResult = {
  data: Record<string, unknown> | null
  error: { code?: string; message: string } | null
}
const dbMaybeSingle = vi.hoisted(() =>
  vi.fn<() => Promise<DbResult>>(async () => ({ data: null, error: null }))
)
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self, in: self, order: self, limit: self,
    insert: self, update: self, upsert: self, delete: self, gte: self, head: self,
    maybeSingle: dbMaybeSingle,
  })
  return { supabaseServer: chain }
})

function patchRequest(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: () => undefined },
  } as never
}

beforeEach(() => {
  loadRehearsal.mockReset()
  transitionRehearsal.mockReset()
  claimDebrief.mockReset()
  releaseDebriefClaim.mockClear()
  complete.mockReset()
  trackEvent.mockReset()
  dbMaybeSingle.mockReset()
  dbMaybeSingle.mockResolvedValue({ data: null, error: null })
  recordTokenUsage.mockClear()
  isOverGlobalBudget.mockReset()
  isOverGlobalBudget.mockResolvedValue(false)
})

// ── Ending a rehearsal ──────────────────────────────────────────────────────

describe('PATCH /api/rehearsal/session — ending', () => {
  it('ends a live rehearsal and records it once', async () => {
    transitionRehearsal.mockResolvedValue({ ok: true, status: 'ended', changed: true })
    const { PATCH } = await import('@/app/api/rehearsal/session/route')

    const res = await PATCH(patchRequest({ userId: USER, rehearsalId: 'r1', reason: 'completed' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'ended', reason: 'completed', changed: true })
    expect(transitionRehearsal).toHaveBeenCalledWith('r1', USER, 'ended', 'completed')
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: ending twice succeeds without double-counting', async () => {
    // The room ends a rehearsal on an explicit click AND the debrief page ends
    // it again if that did not land. The second call must not be an error, and
    // must not fire the analytics event a second time.
    transitionRehearsal.mockResolvedValue({ ok: true, status: 'ended', changed: false })
    const { PATCH } = await import('@/app/api/rehearsal/session/route')

    const res = await PATCH(patchRequest({ userId: USER, rehearsalId: 'r1', reason: 'completed' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.changed).toBe(false)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('refuses to re-end a rehearsal that has already been scored', async () => {
    // The machine forbids debriefed -> ended, which is what stops a scored
    // rehearsal being reopened and re-scored with a different number.
    transitionRehearsal.mockResolvedValue({
      ok: false, reason: 'illegal', detail: 'illegal_transition:debriefed->ended',
    })
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('debriefed'), scenario, counterpart, turns })
    const { PATCH } = await import('@/app/api/rehearsal/session/route')

    const res = await PATCH(patchRequest({ userId: USER, rehearsalId: 'r1', reason: 'completed' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('illegal_transition')
    expect(body.status).toBe('debriefed')
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('404s a rehearsal that is not the callers', async () => {
    transitionRehearsal.mockResolvedValue({ ok: false, reason: 'not_found' })
    const { PATCH } = await import('@/app/api/rehearsal/session/route')

    const res = await PATCH(patchRequest({ userId: USER, rehearsalId: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('still understands the older status spelling', async () => {
    transitionRehearsal.mockResolvedValue({ ok: true, status: 'ended', changed: true })
    const { PATCH } = await import('@/app/api/rehearsal/session/route')

    await PATCH(patchRequest({ userId: USER, rehearsalId: 'r1', status: 'abandoned' }))
    expect(transitionRehearsal).toHaveBeenCalledWith('r1', USER, 'ended', 'abandoned')
  })
})

// ── Generating a debrief ────────────────────────────────────────────────────

const VALID_DEBRIEF = JSON.stringify({
  overallScore: 61,
  dimensions: [
    { dimension: 'anchoring', score: 55, note: 'You opened on their number.' },
    { dimension: 'concession', score: 60, note: 'Two moves, nothing back.' },
    { dimension: 'discovery', score: 40, note: 'You never asked about the title.' },
    { dimension: 'composure', score: 80, note: 'You held the pause.' },
    { dimension: 'close', score: 70, note: 'You pinned a date.' },
  ],
  keyMoments: [{ turnPosition: 1, kind: 'gain', label: 'You asked before moving.' }],
  outcome: 'partial',
  oneThing: 'Ask what is inside their control before naming a number.',
})

const storedRow = {
  id: 'd1',
  rehearsal_id: 'r1',
  overall_score: 61,
  dimensions: [],
  key_moments: [],
  outcome: 'partial',
  one_thing: 'Ask first.',
  mandate_reveal: scenario.hiddenMandate,
  created_at: '2026-01-01T00:20:00Z',
}

describe('POST /api/debrief — generating', () => {
  it('returns the existing debrief without paying for another model call', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('debriefed'), scenario, counterpart, turns })
    dbMaybeSingle.mockResolvedValue({ data: storedRow, error: null })
    const { POST } = await import('@/app/api/debrief/route')

    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).debrief.id).toBe('d1')
    expect(complete).not.toHaveBeenCalled()
    expect(claimDebrief).not.toHaveBeenCalled()
  })

  it('refuses to score a rehearsal that is still live', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('live'), scenario, counterpart, turns })
    const { POST } = await import('@/app/api/debrief/route')

    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('not_scoreable')
    expect(complete).not.toHaveBeenCalled()
  })

  it('does not start a second generation while one is in flight', async () => {
    // Losing the claim with no debrief stored yet means someone else is
    // mid-call. Starting a second identical model call alongside theirs would
    // double the cost of the most expensive operation in the product.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    dbMaybeSingle.mockResolvedValue({ data: null, error: null })
    claimDebrief.mockResolvedValue(false)
    const { POST } = await import('@/app/api/debrief/route')

    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('generating')
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(complete).not.toHaveBeenCalled()
  })

  it('answers with the winning debrief when the unique index rejects the insert', async () => {
    // The claim lapsed and a concurrent request got there first. The caller
    // asked for a debrief and one exists, so this is a 200, not a 500.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue({ content: VALID_DEBRIEF, tokensUsed: 900 })

    dbMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })                       // no existing debrief
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } }) // insert loses
      .mockResolvedValueOnce({ data: storedRow, error: null })                  // read the winner

    const { POST } = await import('@/app/api/debrief/route')
    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).debrief.id).toBe('d1')
  })

  it('marks the rehearsal debriefed once the score is persisted', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue({ content: VALID_DEBRIEF, tokensUsed: 900 })
    transitionRehearsal.mockResolvedValue({ ok: true, status: 'debriefed', changed: true })

    dbMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })      // no existing debrief
      .mockResolvedValueOnce({ data: storedRow, error: null }) // insert succeeds

    const { POST } = await import('@/app/api/debrief/route')
    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(200)
    expect(transitionRehearsal).toHaveBeenCalledWith('r1', USER, 'debriefed')
    // A claim that produced a debrief is spent, not released.
    expect(releaseDebriefClaim).not.toHaveBeenCalled()
  })

  it('hands the claim back when the provider fails, so a retry is not told it is already being written', async () => {
    // Without the release, claim_debrief() would keep refusing the user's own
    // "Try again" for three minutes after a two-second provider failure — an
    // honest error followed by a misleading one.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue(null)
    dbMaybeSingle.mockResolvedValueOnce({ data: null, error: null }) // no existing debrief

    const { POST } = await import('@/app/api/debrief/route')
    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(503)
    expect(releaseDebriefClaim).toHaveBeenCalledWith('r1', USER)
    expect(transitionRehearsal).not.toHaveBeenCalled()
  })

  it('hands the claim back when the model output is unusable', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue({ content: 'I would rather not return JSON today.', tokensUsed: 12 })
    dbMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const { POST } = await import('@/app/api/debrief/route')
    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(502)
    expect(releaseDebriefClaim).toHaveBeenCalledWith('r1', USER)
    // Nothing was persisted, so the rehearsal must not read as scored.
    expect(transitionRehearsal).not.toHaveBeenCalled()
  })
})

describe('POST /api/debrief — cost', () => {
  it('refuses to generate once the deployment-wide ceiling is reached, and keeps the transcript', async () => {
    // Rehearsals opened before the ceiling tripped can be ended afterwards.
    // Exempting their debriefs left the largest call in the product ungated.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    dbMaybeSingle.mockResolvedValueOnce({ data: null, error: null }) // no existing debrief
    isOverGlobalBudget.mockResolvedValueOnce(true)
    const { POST } = await import('@/app/api/debrief/route')

    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('global_cap')
    expect(claimDebrief).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('still returns a debrief that already exists when the ceiling is reached', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('debriefed'), scenario, counterpart, turns })
    dbMaybeSingle.mockResolvedValue({ data: storedRow, error: null })
    isOverGlobalBudget.mockResolvedValue(true)
    const { POST } = await import('@/app/api/debrief/route')

    const res = await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(res.status).toBe(200)
  })

  it('charges an attempt whose output is unusable, not only the ones that parse', async () => {
    // The claim is released so the user can retry, which made failed attempts
    // an uncounted way to buy full-transcript model calls.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue({ content: 'not json', tokensUsed: 4321 })
    dbMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const { POST } = await import('@/app/api/debrief/route')

    await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(recordTokenUsage).toHaveBeenCalledWith(USER, 'free', 4321)
  })

  it('charges an estimate of the prompt when the provider call fails outright', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    claimDebrief.mockResolvedValue(true)
    complete.mockResolvedValue(null)
    dbMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const { POST } = await import('@/app/api/debrief/route')

    await POST(patchRequest({ userId: USER, rehearsalId: 'r1' }))

    expect(recordTokenUsage).toHaveBeenCalledTimes(1)
    expect(recordTokenUsage.mock.calls[0][2]).toBeGreaterThan(500)
  })
})
