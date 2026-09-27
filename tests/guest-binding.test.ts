import { beforeEach, describe, expect, it, vi } from 'vitest'

// A browser-only identity is bound to its browser the moment it first creates
// something worth keeping.
//
// Until 2026-09-14 it never was. The landing and pricing CTAs open a room on a
// uuid minted in localStorage, `rehearsals.user_id` is deliberately not a
// foreign key, and nothing created a `users` row for such an id — so a silent
// guest built up a full transcript history under an id bound to nothing.
// `verifyDeviceBinding` passes an id with no row ("nothing to protect yet"),
// which meant the source check on `POST /api/user/migrate` passed for ANY
// caller who knew the uuid, and the uuid is a query parameter on every read.
//
// These pin the fix: the row exists before the first rehearsal does, it carries
// the device token this browser presented, and it never overwrites a row that
// is already there.

type UpsertRow = { id: string; device_token: string }
type UpsertOptions = { onConflict: string; ignoreDuplicates: boolean }
const upsert = vi.hoisted(() =>
  vi.fn<(row: UpsertRow, options: UpsertOptions) => Promise<{ error: { message: string } | null }>>(
    async () => ({ error: null })
  )
)
const insertMaybeSingle = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'r1' }, error: null })))
const from = vi.hoisted(() =>
  vi.fn((table: string) => ({
    upsert,
    insert: () => ({ select: () => ({ maybeSingle: insertMaybeSingle }) }),
    __table: table,
  }))
)
vi.mock('@/lib/supabase-server', () => ({ supabaseServer: { from } }))

/** Spy for the session-route test below; hoisted because vi.doMock reads it. */
const bindGuestIdentity = vi.hoisted(() => vi.fn(async () => {}))

const GUEST = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'device-token-abc'

/** A NextRequest-shaped stub: only cookies, headers and json() are read. */
function request(cookies: Record<string, string> = {}, body?: unknown) {
  return {
    cookies: { get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined) },
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  } as never
}

describe('bindGuestIdentity', () => {
  beforeEach(() => {
    from.mockClear()
    upsert.mockClear()
    upsert.mockResolvedValue({ error: null })
  })

  it('creates the row carrying the token this browser presented', async () => {
    const { bindGuestIdentity } = await import('@/lib/ownership')

    await bindGuestIdentity(request({ parley_dt: TOKEN }), GUEST)

    expect(from).toHaveBeenCalledWith('users')
    expect(upsert).toHaveBeenCalledWith(
      { id: GUEST, device_token: TOKEN },
      { onConflict: 'id', ignoreDuplicates: true }
    )
  })

  it('never overwrites a row that already exists', async () => {
    // ignoreDuplicates is the whole guarantee: a real account's row, and a
    // guest's row after their first rehearsal, already carry a device token,
    // and a second call here must not be able to re-point it at another
    // browser. Asserted on the options rather than on behaviour because the
    // conflict is resolved inside PostgREST.
    const { bindGuestIdentity } = await import('@/lib/ownership')

    await bindGuestIdentity(request({ parley_dt: TOKEN }), GUEST)

    expect(upsert.mock.calls[0][1].ignoreDuplicates).toBe(true)
  })

  it('does nothing without a device token — there is nothing to bind to', async () => {
    const { bindGuestIdentity } = await import('@/lib/ownership')

    await bindGuestIdentity(request({}), GUEST)

    expect(upsert).not.toHaveBeenCalled()
  })

  it('does nothing for an id that is not a uuid', async () => {
    const { bindGuestIdentity } = await import('@/lib/ownership')

    await bindGuestIdentity(request({ parley_dt: TOKEN }), 'not-a-uuid')

    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not fail the caller when the write fails', async () => {
    // The rehearsal is still worth opening. An unbound id is a weaker position,
    // not a broken one, and refusing here would lock a guest out of the product
    // over a database blip.
    const { bindGuestIdentity } = await import('@/lib/ownership')
    upsert.mockResolvedValue({ error: { message: 'boom' } })

    await expect(bindGuestIdentity(request({ parley_dt: TOKEN }), GUEST)).resolves.toBeUndefined()
  })
})

describe('POST /api/rehearsal/session', () => {
  beforeEach(() => {
    from.mockClear()
    bindGuestIdentity.mockClear()
    insertMaybeSingle.mockClear()
  })

  it('binds the identity before the rehearsal row exists', async () => {
    // Order is the assertion. A rehearsal that exists for even a moment under
    // an id bound to nothing is exactly what this prevents, so binding after
    // the insert would not be a smaller version of the fix — it would be the
    // bug with extra steps.
    vi.doMock('@/lib/ownership', async importOriginal => {
      const actual = await importOriginal<typeof import('@/lib/ownership')>()
      return {
        ...actual,
        bindGuestIdentity,
        verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: false })),
        clientIp: () => 'test-ip',
      }
    })
    vi.doMock('@/lib/rateLimit', () => ({ checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }) }))
    vi.doMock('@/lib/validateRequest', () => ({ rejectInvalidContentType: () => null }))
    vi.doMock('@/lib/analytics', () => ({ trackEvent: vi.fn(async () => {}) }))
    vi.doMock('@/lib/usageLimits', async importOriginal => {
      const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
      return { ...actual, getRehearsalQuota: vi.fn(async () => ({ allowed: true, used: 0, limit: 3 })) }
    })
    vi.doMock('@/lib/rehearsals', async importOriginal => {
      const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
      return {
        ...actual,
        getUserPlan: vi.fn(async () => 'free' as const),
        resolveCounterpart: vi.fn(async () => ({
          id: 'deflector', name: 'The Deflector', role: 'Manager',
          disposition: '', tactics: [], tell: '', builtIn: true,
        })),
        appendTurn: vi.fn(async () => true),
        transitionRehearsal: vi.fn(async () => ({ ok: true, status: 'live', changed: true })),
      }
    })

    const order: string[] = []
    bindGuestIdentity.mockImplementation(async () => {
      order.push('bind')
    })
    insertMaybeSingle.mockImplementation(async () => {
      order.push('insert')
      return { data: { id: 'r1' }, error: null }
    })

    const { POST } = await import('@/app/api/rehearsal/session/route')
    const res = await POST(
      request(
        { parley_dt: TOKEN },
        { userId: GUEST, scenarioSlug: 'renewal-uplift', counterpartId: 'deflector' }
      )
    )

    expect(res.status).toBe(200)
    expect(bindGuestIdentity).toHaveBeenCalledWith(expect.anything(), GUEST)
    expect(order).toEqual(['bind', 'insert'])

    vi.doUnmock('@/lib/ownership')
    vi.doUnmock('@/lib/rehearsals')
    vi.doUnmock('@/lib/usageLimits')
    vi.doUnmock('@/lib/analytics')
    vi.doUnmock('@/lib/rateLimit')
    vi.doUnmock('@/lib/validateRequest')
    vi.resetModules()
  })
})
