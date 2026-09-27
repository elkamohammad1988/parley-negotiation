import { beforeEach, describe, expect, it, vi } from 'vitest'

// The ownership gate decides who may read a rehearsal transcript. Every branch
// below is a decision about someone else's candid working material, so each one
// is pinned — including the failure branches, which are the ones that rot.

const userIdFromAccessToken = vi.hoisted(() => vi.fn())
const accessTokenFrom = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-server', () => ({
  userIdFromAccessToken,
  accessTokenFrom,
  ACCESS_TOKEN_COOKIE: 'parley_at',
}))

// A minimal stand-in for the supabase-js query builder: every chain method
// returns the same object, and maybeSingle resolves whatever the test queued.
const maybeSingle = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, { from: self, select: self, eq: self, maybeSingle, update })
  update.mockImplementation(() => chain)
  return { supabaseServer: chain }
})

const { verifyOwnership, requireAuthenticated, isValidUserId } = await import('@/lib/ownership')

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

/** A NextRequest-shaped stub: only cookies and headers are read. */
function request(cookies: Record<string, string> = {}) {
  return {
    cookies: { get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined) },
    headers: new Headers(),
  } as never
}

beforeEach(() => {
  userIdFromAccessToken.mockReset()
  accessTokenFrom.mockReset()
  maybeSingle.mockReset()
  accessTokenFrom.mockReturnValue(null)
  maybeSingle.mockResolvedValue({ data: null, error: null })
})

describe('userId validation', () => {
  it('rejects anything that is not a uuid', () => {
    for (const bad of ['', 'abc', '../../etc', 123, null, undefined, `${USER} or 1=1`]) {
      expect(isValidUserId(bad)).toBe(false)
    }
    expect(isValidUserId(USER)).toBe(true)
  })

  it('refuses a malformed userId before touching the database', async () => {
    const result = await verifyOwnership(request(), 'not-a-uuid')
    expect(result).toEqual({ ok: false, status: 400, error: 'A valid userId is required.' })
    expect(maybeSingle).not.toHaveBeenCalled()
  })
})

describe('with a real Supabase session', () => {
  it('accepts a token that resolves to the claimed user', async () => {
    accessTokenFrom.mockReturnValue('jwt')
    userIdFromAccessToken.mockResolvedValue(USER)
    maybeSingle.mockResolvedValue({ data: { banned: false }, error: null })

    expect(await verifyOwnership(request(), USER)).toEqual({ ok: true, authenticated: true })
  })

  it('refuses a valid token belonging to someone else', async () => {
    // The interesting case: a genuine, unexpired session — for the wrong
    // account. This must not fall through to the weaker device-token path.
    accessTokenFrom.mockReturnValue('jwt')
    userIdFromAccessToken.mockResolvedValue(OTHER)

    const result = await verifyOwnership(request(), USER)
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('refuses a suspended account even with a valid session', async () => {
    accessTokenFrom.mockReturnValue('jwt')
    userIdFromAccessToken.mockResolvedValue(USER)
    maybeSingle.mockResolvedValue({ data: { banned: true }, error: null })

    const result = await verifyOwnership(request(), USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('falls back to the device token when the session has expired', async () => {
    // An expired token on a page left open is a routine event, not an attack.
    accessTokenFrom.mockReturnValue('stale-jwt')
    userIdFromAccessToken.mockResolvedValue(null)
    maybeSingle.mockResolvedValue({ data: { device_token: 'dt-1', banned: false }, error: null })

    expect(await verifyOwnership(request({ parley_dt: 'dt-1' }), USER)).toEqual({
      ok: true,
      authenticated: false,
    })
  })
})

describe('with only a device token', () => {
  it('accepts a matching token', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: 'dt-1', banned: false }, error: null })
    expect(await verifyOwnership(request({ parley_dt: 'dt-1' }), USER)).toEqual({
      ok: true,
      authenticated: false,
    })
  })

  it('refuses a mismatched token', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: 'dt-1', banned: false }, error: null })
    const result = await verifyOwnership(request({ parley_dt: 'dt-attacker' }), USER)
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('refuses when no token is presented at all for a bound id', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: 'dt-1', banned: false }, error: null })
    const result = await verifyOwnership(request(), USER)
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('claims the token on first sighting of an unbound row', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: null, banned: false }, error: null })
    expect(await verifyOwnership(request({ parley_dt: 'dt-new' }), USER)).toEqual({
      ok: true,
      authenticated: false,
    })
    expect(update).toHaveBeenCalledWith({ device_token: 'dt-new' })
  })
})

describe('when the database is unreachable', () => {
  it('fails CLOSED rather than waving the request through', async () => {
    // This used to return { ok: true }. A caller that cannot read the users
    // table cannot read the rehearsal either, so the open door bought nothing
    // except a window with no check in it.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    const result = await verifyOwnership(request({ parley_dt: 'dt-1' }), USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })
})

describe('requireAuthenticated — destructive and financial actions', () => {
  it('accepts a real session', async () => {
    accessTokenFrom.mockReturnValue('jwt')
    userIdFromAccessToken.mockResolvedValue(USER)
    maybeSingle.mockResolvedValue({ data: { banned: false }, error: null })

    expect((await requireAuthenticated(request(), USER)).ok).toBe(true)
  })

  it('refuses a device token alone', async () => {
    // Enough to resume a rehearsal; not enough to cancel a subscription or
    // erase an account.
    maybeSingle.mockResolvedValue({ data: { device_token: 'dt-1', banned: false }, error: null })

    const result = await requireAuthenticated(request({ parley_dt: 'dt-1' }), USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })
})
