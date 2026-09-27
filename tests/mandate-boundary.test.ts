import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { SCENARIOS, scoreLevers } from '@/lib/negotiation/scenarios'
import { REHEARSAL_STATUSES, mandateMayBeRevealed, type RehearsalStatus } from '@/lib/negotiation/lifecycle'
import type { Scenario } from '@/lib/negotiation/types'

// The hidden mandate never reaches a client before the rehearsal has ended,
// proved for EVERY API route and server action rather than for the three
// routes tests/mandate.test.ts checks by name.
//
// Three layers, so a route added later cannot slip past by not being known:
//
//  1. Inventory. Every app/api/**/route.ts is classified below, and every
//     file is scanned for 'use server'. A new route, or a server action, fails
//     here until someone decides which class it is in.
//  2. Static. A route classified SEALED_BY_CONSTRUCTION must not be able to
//     reach the modules that hold the secret (scenarios.ts, prompt.ts) by any
//     chain of imports, and must not read the debriefs table, whose
//     mandate_reveal and levers columns hold the revealed copy.
//  3. Behavioural. Every other route is called, method by method, for every
//     state in which the mandate is still sealed, for every scenario, with the
//     full secret-bearing scenario loaded behind it and the model stream
//     reciting the mandate. Nothing the client receives may contain it.

const ROOT = resolve(__dirname, '..')
const rel = (p: string) => relative(ROOT, p).split(sep).join('/')

// ── The secret, as a detector ───────────────────────────────────────────────

function shingles(text: string, size = 6): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i + size <= words.length; i++) out.push(words.slice(i, i + size).join(' '))
  return out
}

/** Every phrase whose presence in a response would be a leak for this scenario. */
function secretPhrases(s: Scenario): string[] {
  return [
    ...shingles(s.hiddenMandate),
    ...s.mandateLevers.flatMap(l => [l.label, l.unlockedBy]),
  ]
}

function leaksIn(body: string, s: Scenario): string[] {
  // JSON escapes quotes and SSE splits text across frames; compare against a
  // decoded, frame-joined copy as well as the raw body.
  const joined = body
    .split('\n')
    .filter(l => l.startsWith('data: '))
    .map(l => { try { const e = JSON.parse(l.slice(6)); return `${e.chunk ?? ''}${e.fullReply ?? ''}` } catch { return '' } })
    .join('')
  const haystack = `${body}\n${body.replace(/\\"/g, '"')}\n${joined}`
  return secretPhrases(s).filter(p => haystack.includes(p))
}

describe('the detector can fail', () => {
  const s = SCENARIOS[0]
  it('sees a whole mandate, one clause of it, and a lever', () => {
    expect(leaksIn(JSON.stringify({ x: s.hiddenMandate }), s).length).toBeGreaterThan(0)
    expect(leaksIn(s.hiddenMandate.split(/\s+/).slice(2, 10).join(' '), s).length).toBeGreaterThan(0)
    expect(leaksIn(JSON.stringify({ l: s.mandateLevers[0].unlockedBy }), s).length).toBeGreaterThan(0)
  })
  it('sees a mandate recited across SSE frames', () => {
    const frames = s.hiddenMandate.split(' ').map(w => `data: ${JSON.stringify({ chunk: w + ' ' })}`).join('\n\n')
    expect(leaksIn(frames, s).length).toBeGreaterThan(0)
  })
  it('passes the public fields', () => {
    expect(leaksIn(JSON.stringify({ a: s.situation, b: s.premise, c: s.objective, d: s.opening }), s)).toEqual([])
  })
})

// ── 1. Inventory ────────────────────────────────────────────────────────────

/**
 * Routes whose import graph cannot reach the secret and which never read the
 * debriefs table. Asserted statically below, not taken on trust.
 */
const SEALED_BY_CONSTRUCTION = [
  'app/api/admin/analytics-funnel/route.ts',
  'app/api/admin/db-check/route.ts',
  'app/api/admin/login/route.ts',
  'app/api/admin/promote-user/route.ts',
  'app/api/admin/users/route.ts',
  'app/api/analytics/route.ts',
  'app/api/auth/signin/route.ts',
  'app/api/email/route.ts',
  'app/api/feedback/route.ts',
  'app/api/health/route.ts',
  'app/api/log-error/route.ts',
  'app/api/playbook/route.ts',
  'app/api/report/route.ts',
  'app/api/safety/route.ts',
  'app/api/send-reset/route.ts',
  'app/api/stripe/portal/route.ts',
  'app/api/stripe/route.ts',
  'app/api/stripe/setup-products/route.ts',
  'app/api/stripe-webhook/route.ts',
  'app/api/user/has-history/route.ts',
  'app/api/user/migrate/route.ts',
  'app/api/user/plan/route.ts',
  'app/api/user/profile/route.ts',
  'app/api/user/update-profile/route.ts',
]

/** Routes that can reach the secret, each called in section 3. */
const EXERCISED: Record<string, string[]> = {
  'app/api/account/route.ts': ['GET', 'DELETE'],
  'app/api/admin/stats/route.ts': ['GET'],
  'app/api/conversations/route.ts': ['GET', 'POST', 'PATCH'],
  'app/api/counterparts/route.ts': ['GET', 'POST', 'DELETE'],
  'app/api/debrief/route.ts': ['GET', 'POST'],
  'app/api/progress/route.ts': ['GET'],
  'app/api/rehearsal/route.ts': ['POST'],
  'app/api/rehearsal/session/route.ts': ['GET', 'POST', 'PATCH'],
  'app/api/scenarios/route.ts': ['GET'],
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

const routeFiles = sourceFiles(join(ROOT, 'app/api')).filter(f => f.endsWith(`${sep}route.ts`)).map(rel).sort()

function exportedMethods(file: string): string[] {
  const src = readFileSync(join(ROOT, file), 'utf8')
  return [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
    .map(m => m[1])
    .sort()
}

describe('inventory: every route and server action is classified', () => {
  it('finds the routes it is meant to guard', () => {
    expect(routeFiles.length).toBeGreaterThan(25)
  })

  it('has no unclassified route, and no stale entry', () => {
    const classified = [...SEALED_BY_CONSTRUCTION, ...Object.keys(EXERCISED)].sort()
    expect(routeFiles).toEqual(classified)
  })

  it('exercises every method an exercised route exports', () => {
    for (const [file, methods] of Object.entries(EXERCISED)) {
      expect(exportedMethods(file), file).toEqual([...methods].sort())
    }
  })

  it('has no server actions — a new one must be classified and exercised here', () => {
    // Server actions are POST endpoints Next.js generates from 'use server'
    // functions; they would bypass the route inventory entirely.
    const files = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'lib'))]
    const actions = files.filter(f => /(^|\n)\s*['"]use server['"]/.test(readFileSync(f, 'utf8'))).map(rel)
    expect(actions).toEqual([])
  })
})

// ── 2. Static: sealed by construction ───────────────────────────────────────

const SECRET_MODULES = ['lib/negotiation/scenarios.ts', 'lib/negotiation/prompt.ts'].map(p => join(ROOT, p))
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** Value imports only; `import type` is erased. */
function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
  const out: string[] = []
  for (const spec of specs) {
    let base: string | null = null
    if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
    else if (spec.startsWith('.')) base = resolve(dirname(file), spec)
    if (!base) continue
    const hit = [base, ...EXTENSIONS.map(e => base + e)].find(p => existsSync(p) && statSync(p).isFile())
    if (hit) out.push(hit)
  }
  return out
}

function pathToSecret(entry: string): string | null {
  const seen = new Set<string>()
  const walk = (file: string, trail: string[]): string[] | null => {
    if (SECRET_MODULES.includes(file)) return trail
    if (seen.has(file)) return null
    seen.add(file)
    for (const next of localImports(file)) {
      const found = walk(next, [...trail, next])
      if (found) return found
    }
    return null
  }
  return walk(entry, [entry])?.map(rel).join(' -> ') ?? null
}

describe('static: routes sealed by construction', () => {
  it.each(SEALED_BY_CONSTRUCTION.map(f => [f]))('%s cannot import the secret', file => {
    expect(pathToSecret(join(ROOT, file))).toBeNull()
  })

  it.each(SEALED_BY_CONSTRUCTION.map(f => [f]))('%s never reads the debriefs table', file => {
    // debriefs.mandate_reveal and debriefs.levers are the revealed copy.
    expect(readFileSync(join(ROOT, file), 'utf8')).not.toMatch(/from\(\s*['"]debriefs['"]\s*\)/)
  })

  it('the exercised list is exactly the set that can reach the secret or the debriefs table', () => {
    // Keeps EXERCISED honest in the other direction: a route that no longer
    // needs exercising is moved, rather than left looking covered.
    const reaching = routeFiles.filter(f => {
      const src = readFileSync(join(ROOT, f), 'utf8')
      return pathToSecret(join(ROOT, f)) !== null || /from\(\s*['"]debriefs['"]\s*\)/.test(src)
    })
    expect(reaching).toEqual(Object.keys(EXERCISED).sort())
  })
})

// ── 3. Behavioural ──────────────────────────────────────────────────────────

const USER = '11111111-1111-4111-8111-111111111111'
const REHEARSAL_ID = '22222222-2222-4222-8222-222222222222'

// Whatever scenario and status the current case has loaded behind the routes.
const state = vi.hoisted(() => ({
  scenario: null as unknown as Scenario,
  status: 'live' as string,
  tables: {} as Record<string, Record<string, unknown>[]>,
}))

const counterpart = {
  id: 'closer', name: 'The Closer', role: 'Account executive', disposition: 'Firm',
  tactics: [], tell: '', builtIn: true,
}

function loaded() {
  const s = state.scenario
  return {
    rehearsal: {
      id: REHEARSAL_ID, userId: USER, scenarioSlug: s.slug, scenarioTitle: s.title,
      counterpartId: 'closer', status: state.status, endReason: null,
      startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: null,
      durationSeconds: 60, turnCount: 4, overallScore: null,
    },
    // The full, secret-bearing scenario: what the server really holds.
    scenario: s,
    counterpart,
    turns: [
      { id: 't0', rehearsalId: REHEARSAL_ID, side: 'counterpart', content: s.opening, position: 0, createdAt: '' },
      { id: 't1', rehearsalId: REHEARSAL_ID, side: 'you', content: 'What else is available besides price?', position: 1, createdAt: '' },
      { id: 't2', rehearsalId: REHEARSAL_ID, side: 'counterpart', content: 'Not much, honestly.', position: 2, createdAt: '' },
      { id: 't3', rehearsalId: REHEARSAL_ID, side: 'you', content: 'Who approves above you?', position: 3, createdAt: '' },
    ],
  }
}

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  const ok = async () => ({ ok: true as const, authenticated: true })
  return {
    ...actual,
    verifyOwnership: vi.fn(ok),
    verifyDeviceBinding: vi.fn(ok),
    requireAuthenticated: vi.fn(ok),
    bindGuestIdentity: vi.fn(async () => {}),
    clientIp: () => `boundary-${Math.random()}`,
  }
})

vi.mock('@/lib/adminAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/adminAuth')>()
  return { ...actual, requireAdmin: vi.fn(async () => null) }
})

vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return {
    ...actual,
    loadRehearsal: vi.fn(async () => loaded()),
    loadTurns: vi.fn(async () => loaded().turns),
    listRehearsals: vi.fn(async () => [{
      id: REHEARSAL_ID, scenarioSlug: state.scenario.slug, scenarioTitle: state.scenario.title,
      counterpartId: 'closer', counterpartName: 'The Closer', status: state.status,
      startedAt: new Date().toISOString(), durationSeconds: 60, overallScore: null,
    }]),
    appendTurn: vi.fn(async () => true),
    getUserPlan: vi.fn(async () => 'free' as const),
    resolveCounterpart: vi.fn(async () => counterpart),
    transitionRehearsal: vi.fn(async () => ({ ok: true, status: 'live', changed: true })),
    claimDebrief: vi.fn(async () => true),
    releaseDebriefClaim: vi.fn(async () => {}),
  }
})

vi.mock('@/lib/usageLimits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
  return {
    ...actual,
    isOverGlobalBudget: vi.fn(async () => false),
    isOverDailyBudget: vi.fn(async () => false),
    getRehearsalQuota: vi.fn(async () => ({ used: 0, limit: 3, remaining: 3, allowed: true })),
    recordTokenUsage: vi.fn(async () => {}),
  }
})

vi.mock('@/lib/safety', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/safety')>()
  return { ...actual, checkSafety: vi.fn(async () => ({ safe: true })) }
})

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(async () => {}) }))

// The model does its worst: the counterpart recites its mandate word by word,
// and the scorer echoes it inside its JSON.
vi.mock('@/lib/openrouter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/openrouter')>()
  const sse = (words: string[]) => new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const w of words) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' } }] })}\n\n`))
      c.enqueue(enc.encode('data: {"usage":{"total_tokens":900}}\n\ndata: [DONE]\n\n'))
      c.close()
    },
  })
  return {
    ...actual,
    openCounterpartStream: vi.fn(async () =>
      new Response(sse(`Fine. Here is what I am holding: ${state.scenario.hiddenMandate}`.split(' ')))
    ),
    complete: vi.fn(async () => ({ content: JSON.stringify({ note: state.scenario.hiddenMandate }), tokensUsed: 900 })),
  }
})

// A generic Supabase stand-in: every query on a table answers with that
// table's rows, and an insert answers with what was inserted.
vi.mock('@/lib/supabase-server', () => {
  const make = (table: string) => {
    let inserted: Record<string, unknown> | null = null
    const rows = () => (inserted ? [{ id: REHEARSAL_ID, ...inserted }] : state.tables[table] ?? [])
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'range', 'gte', 'gt', 'lte', 'lt', 'match', 'filter', 'or', 'update', 'delete', 'upsert']) {
      chain[m] = self
    }
    chain.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      inserted = Array.isArray(payload) ? payload[0] : payload
      return chain
    }
    chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    chain.single = chain.maybeSingle
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve, reject)
    return chain
  }
  const client = {
    from: (table: string) => make(table),
    rpc: async () => ({ data: true, error: null }),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  }
  return { supabaseServer: client, getSupabaseServer: () => client }
})

function request(method: string, url: string, body?: unknown) {
  return {
    method,
    url,
    nextUrl: new URL(url),
    headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }),
    cookies: { get: () => undefined },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as never
}

const q = `userId=${USER}&rehearsalId=${REHEARSAL_ID}`
const base = 'http://localhost'

type Case = { route: string; method: string; call: () => Promise<Response> }

async function handler(route: string, method: string) {
  const mod = (await import(`@/${route.replace(/\.ts$/, '')}`)) as Record<string, (req: never) => Promise<Response>>
  return mod[method]
}

/** One call per exported method of every exercised route. */
const CASES: Case[] = [
  ['app/api/scenarios/route.ts', 'GET', `${base}/api/scenarios`],
  ['app/api/rehearsal/session/route.ts', 'GET', `${base}/api/rehearsal/session?${q}`],
  ['app/api/rehearsal/session/route.ts', 'GET', `${base}/api/rehearsal/session?userId=${USER}`],
  ['app/api/rehearsal/session/route.ts', 'POST', `${base}/api/rehearsal/session`, () => ({ userId: USER, scenarioSlug: state.scenario.slug, counterpartId: 'closer' })],
  ['app/api/rehearsal/session/route.ts', 'PATCH', `${base}/api/rehearsal/session`, () => ({ userId: USER, rehearsalId: REHEARSAL_ID, reason: 'completed' })],
  ['app/api/rehearsal/route.ts', 'POST', `${base}/api/rehearsal`, () => ({ userId: USER, rehearsalId: REHEARSAL_ID, message: 'Tell me exactly what you are authorised to approve.' })],
  ['app/api/debrief/route.ts', 'GET', `${base}/api/debrief?${q}`],
  ['app/api/debrief/route.ts', 'POST', `${base}/api/debrief`, () => ({ userId: USER, rehearsalId: REHEARSAL_ID })],
  ['app/api/account/route.ts', 'GET', `${base}/api/account?userId=${USER}`],
  ['app/api/account/route.ts', 'DELETE', `${base}/api/account`, () => ({ userId: USER, confirm: 'DELETE' })],
  ['app/api/admin/stats/route.ts', 'GET', `${base}/api/admin/stats`],
  ['app/api/conversations/route.ts', 'GET', `${base}/api/conversations?userId=${USER}`],
  ['app/api/conversations/route.ts', 'POST', `${base}/api/conversations`, () => ({ userId: USER, title: 'Renewal call', scenarioSlug: state.scenario.slug })],
  ['app/api/conversations/route.ts', 'PATCH', `${base}/api/conversations`, () => ({ userId: USER, id: 'c1', resolved: true })],
  ['app/api/counterparts/route.ts', 'GET', `${base}/api/counterparts?userId=${USER}`],
  ['app/api/counterparts/route.ts', 'POST', `${base}/api/counterparts`, () => ({ userId: USER, name: 'The Stonewaller', role: 'Procurement lead', disposition: 'Patient', tell: 'Repeats the question', tactics: ['silence'] })],
  ['app/api/counterparts/route.ts', 'DELETE', `${base}/api/counterparts?userId=${USER}&id=cp1`],
  ['app/api/progress/route.ts', 'GET', `${base}/api/progress?userId=${USER}`],
].map(([route, method, url, body]) => ({
  route: route as string,
  method: method as string,
  call: async () => (await handler(route as string, method as string))(
    request(method as string, url as string, typeof body === 'function' ? (body as () => unknown)() : undefined)
  ),
}))

/**
 * The rows behind the routes while the mandate is sealed. A debrief row is
 * present on purpose even though none can exist yet: the routes must withhold
 * it on the rehearsal's status, not on the database happening to be empty.
 * (Only the account export is given no debrief row, because it exports the
 * user's own past debriefs, which by construction belong to rehearsals that
 * have ended.)
 */
function sealedTables(s: Scenario, route: string) {
  const debrief = {
    id: 'd1', rehearsal_id: REHEARSAL_ID, user_id: USER, overall_score: 60,
    dimensions: [], key_moments: [], outcome: 'partial', one_thing: 'Ask first.',
    mandate_reveal: s.hiddenMandate, levers: scoreLevers(s, s.mandateLevers.map(l => l.id)),
    created_at: new Date().toISOString(),
    rehearsals: { scenario_slug: s.slug, counterpart_id: 'closer', started_at: new Date().toISOString() },
  }
  return {
    debriefs: route === 'app/api/account/route.ts' ? [] : [debrief],
    rehearsals: [{ id: REHEARSAL_ID, user_id: USER, scenario_slug: s.slug, status: state.status, counterpart_id: 'closer', started_at: new Date().toISOString() }],
    users: [{ id: USER, email: 'someone@example.com', display_name: 'Someone', created_at: new Date().toISOString(), plan: 'free' }],
    upcoming_conversations: [{ id: 'c1', user_id: USER, title: 'Renewal call', scenario_slug: s.slug, happens_on: null, notes: null, resolved: false, created_at: new Date().toISOString() }],
    custom_counterparts: [],
    playbook_entries: [],
  }
}

const SEALED_STATES = REHEARSAL_STATUSES.filter(s => !mandateMayBeRevealed(s)) as RehearsalStatus[]

describe('behavioural: no exercised route leaks while the mandate is sealed', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('calls every method of every exercised route', () => {
    const called = [...new Set(CASES.map(c => `${c.route} ${c.method}`))].sort()
    const expected = Object.entries(EXERCISED).flatMap(([r, ms]) => ms.map(m => `${r} ${m}`)).sort()
    expect(called).toEqual(expected)
  })

  it('has sealed states to sweep, including live', () => {
    expect(SEALED_STATES).toContain('live')
  })

  for (const status of SEALED_STATES) {
    for (const scenario of SCENARIOS) {
      it(`every route, state = ${status}, scenario = ${scenario.slug}`, async () => {
        state.scenario = scenario
        state.status = status
        const leaks: string[] = []
        for (const c of CASES) {
          state.tables = sealedTables(scenario, c.route)
          const res = await c.call()
          const body = await res.text()
          const found = leaksIn(body, scenario)
          if (found.length) leaks.push(`${c.method} ${c.route} (${res.status}): "${found[0]}"`)
        }
        expect(leaks).toEqual([])
      })
    }
  }

  it('the harness would have seen a leak: the debrief reveals once the rehearsal has ended', async () => {
    // A sweep that cannot fail proves nothing. Same routes, same fixtures, a
    // revealing state, and the one surface allowed to reveal does.
    const scenario = SCENARIOS[0]
    state.scenario = scenario
    state.status = 'ended'
    state.tables = sealedTables(scenario, 'app/api/debrief/route.ts')
    const res = await (await handler('app/api/debrief/route.ts', 'GET'))(request('GET', `${base}/api/debrief?${q}`))
    expect(leaksIn(await res.text(), scenario).length).toBeGreaterThan(0)
  })

  it('the room stream actually recited the mandate upstream, and the relay withheld it', async () => {
    const scenario = SCENARIOS[0]
    state.scenario = scenario
    state.status = 'live'
    state.tables = sealedTables(scenario, 'app/api/rehearsal/route.ts')
    const { openCounterpartStream } = await import('@/lib/openrouter')
    const res = await (await handler('app/api/rehearsal/route.ts', 'POST'))(
      request('POST', `${base}/api/rehearsal`, { userId: USER, rehearsalId: REHEARSAL_ID, message: 'What can you approve?' })
    )
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(openCounterpartStream).toHaveBeenCalled()
    expect(body).toContain('"done":true')
    expect(leaksIn(body, scenario)).toEqual([])
  })
})
