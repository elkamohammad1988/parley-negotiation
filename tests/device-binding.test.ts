import { beforeEach, describe, expect, it, vi } from 'vitest'

// verifyDeviceBinding is the device-token half of verifyOwnership on its own.
// It exists for one caller — the guest → account migration — which has to
// prove the id being migrated away from while the browser legitimately holds
// a session for a different account. The one behaviour that distinguishes it
// from verifyOwnership is pinned first; the rest is the fallback path, which
// must not drift from the one tests/ownership.test.ts already covers.

const userIdFromAccessToken = vi.hoisted(() => vi.fn())
const accessTokenFrom = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-server', () => ({
  userIdFromAccessToken,
  accessTokenFrom,
  ACCESS_TOKEN_COOKIE: 'parley_at',
}))

const maybeSingle = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, { from: self, select: self, eq: self, maybeSingle, update })
  update.mockImplementation(() => chain)
  return { supabaseServer: chain }
})

const { verifyDeviceBinding, verifyOwnership } = await import('@/lib/ownership')

const GUEST = '11111111-1111-4111-8111-111111111111'
const ACCOUNT = '22222222-2222-4222-8222-222222222222'

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
  update.mockClear()
  accessTokenFrom.mockReturnValue(null)
  maybeSingle.mockResolvedValue({ data: null, error: null })
})

describe('verifyDeviceBinding', () => {
  it('ignores a session that belongs to another account, where verifyOwnership refuses it', async () => {
    // The migration case: the browser has just signed in as ACCOUNT and is
    // proving the GUEST id it rehearsed under. The device token matches.
    accessTokenFrom.mockReturnValue('jwt')
    userIdFromAccessToken.mockResolvedValue(ACCOUNT)
    maybeSingle.mockResolvedValue({ data: { device_token: 'd1', banned: false }, error: null })
    const req = request({ parley_dt: 'd1', parley_at: 'jwt' })

    expect(await verifyDeviceBinding(req, GUEST)).toEqual({ ok: true, authenticated: false })
    expect(await verifyOwnership(req, GUEST)).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('refuses a bound id presented with the wrong device token', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: 'd1', banned: false }, error: null })

    expect(await verifyDeviceBinding(request({ parley_dt: 'd2' }), GUEST)).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
    expect(await verifyDeviceBinding(request(), GUEST)).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('passes an id with no row — there is nothing to protect yet — and claims nothing', async () => {
    expect(await verifyDeviceBinding(request({ parley_dt: 'd1' }), GUEST)).toEqual({ ok: true, authenticated: false })
    expect(update).not.toHaveBeenCalled()
  })

  it('binds a rowed but unbound id to the first device token it sees', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: null, banned: false }, error: null })

    expect(await verifyDeviceBinding(request({ parley_dt: 'd1' }), GUEST)).toEqual({ ok: true, authenticated: false })
    expect(update).toHaveBeenCalledWith({ device_token: 'd1' })
  })

  it('refuses a banned id and a malformed id, and fails closed on a database error', async () => {
    maybeSingle.mockResolvedValue({ data: { device_token: 'd1', banned: true }, error: null })
    expect((await verifyDeviceBinding(request({ parley_dt: 'd1' }), GUEST)).ok).toBe(false)

    expect(await verifyDeviceBinding(request(), 'nope')).toEqual({
      ok: false,
      status: 400,
      error: 'A valid userId is required.',
    })

    maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } })
    const result = await verifyDeviceBinding(request(), GUEST)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })
})
