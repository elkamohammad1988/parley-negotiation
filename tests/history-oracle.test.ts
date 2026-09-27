import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/user/has-history answers "does this account have rehearsals". It used to
// answer for whoever the query string named, with no session check — turning any
// uuid into a yes/no on whether that person uses Parley. The uuid is not a
// secret the product protects: it travels as a query parameter on nearly every
// other read.
//
// These pin the property that closes it: the answer comes from the caller's own
// verified session, and a caller-supplied id cannot influence it at all.

const authenticatedUserId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-server', () => ({ authenticatedUserId }))

const eq = vi.hoisted(() => vi.fn())
const limit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, { from: self, select: self, eq, limit })
  eq.mockImplementation(() => chain)
  return { supabaseServer: chain }
})

const { GET } = await import('@/app/api/user/has-history/route')

const CALLER = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'

function request(url: string) {
  return {
    nextUrl: new URL(url, 'http://localhost'),
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as never
}

beforeEach(() => {
  authenticatedUserId.mockReset()
  eq.mockClear()
  limit.mockReset()
  limit.mockResolvedValue({ count: 3, error: null })
})

describe('/api/user/has-history', () => {
  it('answers false for a caller with no verified session, and queries nothing', async () => {
    authenticatedUserId.mockResolvedValue(null)

    const res = await GET(request(`/api/user/has-history?userId=${VICTIM}`))

    expect(await res.json()).toEqual({ hasHistory: false })
    expect(eq).not.toHaveBeenCalled()
  })

  it('ignores a userId in the query string entirely', async () => {
    authenticatedUserId.mockResolvedValue(CALLER)

    await GET(request(`/api/user/has-history?userId=${VICTIM}`))

    // The lookup is scoped to the SESSION's id, never the parameter's.
    expect(eq).toHaveBeenCalledWith('user_id', CALLER)
    expect(eq).not.toHaveBeenCalledWith('user_id', VICTIM)
  })

  it('answers for the session that asked', async () => {
    authenticatedUserId.mockResolvedValue(CALLER)

    const res = await GET(request('/api/user/has-history'))

    expect(await res.json()).toEqual({ hasHistory: true })
    expect(eq).toHaveBeenCalledWith('user_id', CALLER)
  })

  it('fails toward onboarding when the lookup errors', async () => {
    authenticatedUserId.mockResolvedValue(CALLER)
    limit.mockResolvedValue({ count: null, error: { message: 'boom' } })

    const res = await GET(request('/api/user/has-history'))

    expect(await res.json()).toEqual({ hasHistory: false })
  })
})
