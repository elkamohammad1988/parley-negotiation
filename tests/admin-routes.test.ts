import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'

// Every /api/admin route refuses a caller without a valid admin session.
//
// WHY THIS IS ENUMERATED FROM DISK RATHER THAN LISTED. The guard — read the
// cookie, read ADMIN_PASSWORD, verify the token, 401 — was copy-pasted into
// five routes, and /api/admin/* sits outside the proxy's /admin/* matcher, so
// each copy is the only thing standing in front of that route. A list written
// by hand here would cover exactly the five that already exist and say nothing
// about the sixth. Reading the directory means a new admin route is in this
// suite the moment it is created, and an unguarded one fails on arrival.
//
// `login` is the deliberate exception: it is how the cookie is obtained, so it
// must be reachable without one. It has its own rate limit and constant-time
// password comparison, tested by the fact that it cannot mint a token without
// the password.

const ADMIN_API = join(process.cwd(), 'app/api/admin')
const PASSWORD = 'test-admin-password'

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}))

// Thenable query builder: every chain resolves to an empty, error-free result,
// so a route that gets PAST the guard runs to completion instead of throwing
// and producing a non-401 for the wrong reason.
vi.mock('@/lib/supabase-server', () => {
  const result = { data: [], count: 0, error: null }
  function chain(): Record<string, unknown> {
    const self: Record<string, unknown> = {}
    const back = () => self
    Object.assign(self, {
      select: back, eq: back, in: back, gte: back, lte: back, order: back,
      limit: back, insert: back, update: back, upsert: back, delete: back,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    })
    return self
  }
  const client = { from: () => chain() }
  return { supabaseServer: client, default: client }
})

/** Route directories under app/api/admin, minus the login endpoint. */
function guardedRouteDirs(): string[] {
  return readdirSync(ADMIN_API, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'login')
    .map(e => e.name)
    .sort()
}

function request(cookie: string | undefined, body: unknown = {}) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: (name: string) => (name === 'admin_session' && cookie ? { value: cookie } : undefined) },
    nextUrl: new URL('http://localhost/api/admin/test'),
  } as never
}

type Handler = (req: never) => Promise<Response>

async function handlersFor(dir: string): Promise<[string, Handler][]> {
  const mod = (await import(`@/app/api/admin/${dir}/route`)) as Record<string, unknown>
  return (['GET', 'POST', 'PATCH', 'DELETE', 'PUT'] as const)
    .filter(m => typeof mod[m] === 'function')
    .map(m => [m, mod[m] as Handler])
}

beforeEach(() => {
  vi.resetModules()
  process.env.ADMIN_PASSWORD = PASSWORD
})

describe('every /api/admin route is guarded', () => {
  it('finds the admin routes to check', () => {
    // Guards the guard: if this ever reads zero directories, every test below
    // would vacuously pass while checking nothing at all.
    expect(guardedRouteDirs().length).toBeGreaterThanOrEqual(5)
  })

  for (const dir of guardedRouteDirs()) {
    describe(`/api/admin/${dir}`, () => {
      it('refuses a caller with no admin_session cookie', async () => {
        for (const [method, handler] of await handlersFor(dir)) {
          const res = await handler(request(undefined))
          expect(res.status, `${method} /api/admin/${dir} without a cookie`).toBe(401)
        }
      })

      it('refuses a forged or tampered token', async () => {
        for (const [method, handler] of await handlersFor(dir)) {
          for (const forged of ['garbage', 'a.b', 'eyJleHAiOjk5OTk5OTk5OTl9.deadbeef']) {
            const res = await handler(request(forged))
            expect(res.status, `${method} /api/admin/${dir} with '${forged}'`).toBe(401)
          }
        }
      })

      it('refuses a token signed with the wrong password', async () => {
        const { createAdminSessionToken } = await import('@/lib/adminAuth')
        const wrong = await createAdminSessionToken('not-the-admin-password')
        for (const [method, handler] of await handlersFor(dir)) {
          const res = await handler(request(wrong))
          expect(res.status, `${method} /api/admin/${dir} with a wrong-key token`).toBe(401)
        }
      })

      it('refuses when ADMIN_PASSWORD is not configured, rather than letting everyone in', async () => {
        const { createAdminSessionToken } = await import('@/lib/adminAuth')
        const valid = await createAdminSessionToken(PASSWORD)
        delete process.env.ADMIN_PASSWORD
        for (const [method, handler] of await handlersFor(dir)) {
          const res = await handler(request(valid))
          expect(res.status, `${method} /api/admin/${dir} with no ADMIN_PASSWORD set`).toBe(401)
        }
        process.env.ADMIN_PASSWORD = PASSWORD
      })

      it('admits a valid session, so the guard is refusing for the right reason', async () => {
        const { createAdminSessionToken } = await import('@/lib/adminAuth')
        const valid = await createAdminSessionToken(PASSWORD)
        for (const [method, handler] of await handlersFor(dir)) {
          const res = await handler(request(valid, { userId: 'x', plan: 'free' }))
          expect(res.status, `${method} /api/admin/${dir} with a valid session`).not.toBe(401)
        }
      })
    })
  }
})
