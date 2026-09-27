import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SCENARIOS, getScenario } from '@/lib/negotiation/scenarios'
import { REHEARSAL_STATUSES, type RehearsalStatus } from '@/lib/negotiation/lifecycle'
import type { Scenario } from '@/lib/negotiation/types'

// The one guarantee this product cannot lose.
//
// `Scenario.hiddenMandate` is the answer the user is trying to discover by
// asking good questions. If it reaches a live client — in a JSON body, in a
// server-rendered page payload, anywhere — the Information gain score becomes
// unscoreable and the exercise becomes a writing exercise.
//
// These tests assert the guarantee at every boundary that serialises a
// scenario, and they assert it by SHINGLE rather than by whole string: a
// partial leak of one clause is still a leak, and checking only for the exact
// full mandate would miss it.

/** Overlapping 6-word phrases. Long enough not to collide with ordinary prose. */
function shingles(text: string, size = 6): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i + size <= words.length; i++) {
    out.push(words.slice(i, i + size).join(' '))
  }
  return out
}

/** Fails with the offending phrase rather than "expected false to be true". */
function expectNoMandate(payload: unknown, scenario: Scenario, where: string) {
  const serialised = JSON.stringify(payload)
  const leaked = shingles(scenario.hiddenMandate).filter(s => serialised.includes(s))
  expect(leaked, `${where} leaked mandate text for "${scenario.slug}": ${leaked[0]}`).toEqual([])
}

// Sanity-check the detector itself. A leak test that cannot fail is worthless.
describe('the leak detector', () => {
  it('catches a whole mandate', () => {
    const s = SCENARIOS[0]
    expect(() => expectNoMandate({ oops: s.hiddenMandate }, s, 'self-test')).toThrow()
  })

  it('catches a single leaked clause', () => {
    const s = SCENARIOS[0]
    const clause = s.hiddenMandate.split(/\s+/).slice(3, 12).join(' ')
    expect(() => expectNoMandate({ oops: clause }, s, 'self-test')).toThrow()
  })

  it('passes on scenario text that is meant to be public', () => {
    const s = SCENARIOS[0]
    expect(() => expectNoMandate({ situation: s.situation, premise: s.premise }, s, 'self-test')).not.toThrow()
  })
})

describe('every scenario is shaped so the guarantee is testable', () => {
  it('has a non-trivial hidden mandate', () => {
    for (const s of SCENARIOS) {
      expect(s.hiddenMandate.split(/\s+/).length, `${s.slug} mandate too short to shingle`).toBeGreaterThan(12)
    }
  })

  it('does not restate the mandate inside a public field', () => {
    for (const s of SCENARIOS) {
      expectNoMandate(
        {
          premise: s.premise,
          situation: s.situation,
          objective: s.objective,
          constraints: s.constraints,
          counterpartRole: s.counterpartRole,
          opening: s.opening,
          tactics: s.tactics,
        },
        s,
        'the public fields of the scenario itself'
      )
    }
  })
})

describe('GET /api/scenarios — the public library', () => {
  it('never serialises a mandate', async () => {
    const { GET } = await import('@/app/api/scenarios/route')
    const res = await GET({ nextUrl: new URL('http://localhost/api/scenarios') } as never)
    const body = await res.json()

    for (const s of SCENARIOS) expectNoMandate(body, s, 'GET /api/scenarios')
  })

  it('never serialises a mandate when asked for one scenario', async () => {
    const { GET } = await import('@/app/api/scenarios/route')
    for (const s of SCENARIOS) {
      const res = await GET({
        nextUrl: new URL(`http://localhost/api/scenarios?slug=${s.slug}`),
      } as never)
      expectNoMandate(await res.json(), s, `GET /api/scenarios?slug=${s.slug}`)
    }
  })
})

// ── Route-level tests need the data layer stubbed ───────────────────────────

const scenario = getScenario('renewal-uplift') as Scenario
const counterpart = { id: 'deflector', name: 'The Deflector', role: 'Manager', disposition: '', tactics: [], tell: '', builtIn: true }

const turns = [
  { id: 't0', rehearsalId: 'r1', side: 'counterpart' as const, content: scenario.opening, position: 0, createdAt: '2026-01-01T00:00:00Z' },
  { id: 't1', rehearsalId: 'r1', side: 'you' as const, content: 'What is the budget?', position: 1, createdAt: '2026-01-01T00:01:00Z' },
]

function rehearsal(status: RehearsalStatus) {
  return {
    id: 'r1',
    userId: '11111111-1111-4111-8111-111111111111',
    scenarioSlug: scenario.slug,
    scenarioTitle: scenario.title,
    counterpartId: 'deflector',
    status,
    startedAt: '2026-01-01T00:00:00Z',
    endReason: status === 'ended' ? ('completed' as const) : null,
    endedAt: status === 'live' || status === 'draft' ? null : '2026-01-01T00:12:00Z',
    durationSeconds: status === 'live' || status === 'draft' ? 0 : 720,
    turnCount: turns.length,
    overallScore: null,
  }
}

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })) }
})

const loadRehearsal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return { ...actual, loadRehearsal, getUserPlan: vi.fn(async () => 'free' as const) }
})

// The debrief route reads the debriefs table directly.
const maybeSingle = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })))
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self, in: self, order: self, limit: self,
    insert: self, update: self, upsert: self, delete: self, gte: self, head: self,
    maybeSingle,
  })
  return { supabaseServer: chain }
})

const USER = '11111111-1111-4111-8111-111111111111'

describe('GET /api/rehearsal/session — rehydrating a live room', () => {
  beforeEach(() => { loadRehearsal.mockReset() })

  it('never sends the mandate to a LIVE room', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('live'), scenario, counterpart, turns })
    const { GET } = await import('@/app/api/rehearsal/session/route')
    const res = await GET({
      nextUrl: new URL(`http://localhost/api/rehearsal/session?userId=${USER}&rehearsalId=r1`),
    } as never)

    expect(res.status).toBe(200)
    expectNoMandate(await res.json(), scenario, 'GET /api/rehearsal/session (live)')
  })

  it('still never sends the mandate once the room has ENDED', async () => {
    // The room route is not the reveal surface even after the fact — that is
    // the debrief's job, from the snapshot stored on the debrief row.
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    const { GET } = await import('@/app/api/rehearsal/session/route')
    const res = await GET({
      nextUrl: new URL(`http://localhost/api/rehearsal/session?userId=${USER}&rehearsalId=r1`),
    } as never)

    expectNoMandate(await res.json(), scenario, 'GET /api/rehearsal/session (complete)')
  })
})

describe('GET /api/debrief — the one place the mandate may surface', () => {
  beforeEach(() => { loadRehearsal.mockReset(); maybeSingle.mockClear() })

  it('withholds the mandate while the rehearsal is still live', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('live'), scenario, counterpart, turns })
    const { GET } = await import('@/app/api/debrief/route')
    const res = await GET({
      nextUrl: new URL(`http://localhost/api/debrief?userId=${USER}&rehearsalId=r1`),
    } as never)

    const body = await res.json()
    expect(body.scenario.hiddenMandate).toBeNull()
    expectNoMandate(body, scenario, 'GET /api/debrief (live)')
  })

  it('reveals it once the rehearsal has ended', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('ended'), scenario, counterpart, turns })
    const { GET } = await import('@/app/api/debrief/route')
    const res = await GET({
      nextUrl: new URL(`http://localhost/api/debrief?userId=${USER}&rehearsalId=r1`),
    } as never)

    const body = await res.json()
    expect(body.scenario.hiddenMandate).toBe(scenario.hiddenMandate)
  })

  it('reveals it once the rehearsal has expired', async () => {
    loadRehearsal.mockResolvedValue({ rehearsal: rehearsal('expired'), scenario, counterpart, turns })
    const { GET } = await import('@/app/api/debrief/route')
    const res = await GET({
      nextUrl: new URL(`http://localhost/api/debrief?userId=${USER}&rehearsalId=r1`),
    } as never)

    expect((await res.json()).scenario.hiddenMandate).toBe(scenario.hiddenMandate)
  })
})

// ── The guarantee, swept across every state and every client-facing route ───
//
// The tests above check the states one at a time. This one is the backstop:
// for EVERY state in the union, hit every route a browser can reach and assert
// the mandate is absent whenever the rehearsal has not stopped. Written as a
// sweep rather than as cases so a state added to the union later is covered
// the moment it exists, instead of quietly skipping the check.

const SEALED_STATES: RehearsalStatus[] = ['draft', 'live', 'failed']

describe('across every rehearsal state', () => {
  beforeEach(() => { loadRehearsal.mockReset() })

  it('covers the whole status union, so a new state cannot slip past', () => {
    const revealing: RehearsalStatus[] = ['ended', 'expired', 'debriefed']
    expect([...SEALED_STATES, ...revealing].sort()).toEqual([...REHEARSAL_STATUSES].sort())
  })

  for (const status of SEALED_STATES) {
    it(`keeps the mandate out of every client-facing response while state = ${status}`, async () => {
      loadRehearsal.mockResolvedValue({ rehearsal: rehearsal(status), scenario, counterpart, turns })

      const session = await (await import('@/app/api/rehearsal/session/route')).GET({
        nextUrl: new URL(`http://localhost/api/rehearsal/session?userId=${USER}&rehearsalId=r1`),
      } as never)
      expectNoMandate(await session.json(), scenario, `session GET (${status})`)

      const debrief = await (await import('@/app/api/debrief/route')).GET({
        nextUrl: new URL(`http://localhost/api/debrief?userId=${USER}&rehearsalId=r1`),
      } as never)
      const debriefBody = await debrief.json()
      expect(debriefBody.scenario.hiddenMandate, `debrief GET leaked at ${status}`).toBeNull()
      expectNoMandate(debriefBody, scenario, `debrief GET (${status})`)

      const scenarios = await (await import('@/app/api/scenarios/route')).GET({
        nextUrl: new URL('http://localhost/api/scenarios'),
      } as never)
      expectNoMandate(await scenarios.json(), scenario, `scenarios GET (${status})`)
    })
  }
})
