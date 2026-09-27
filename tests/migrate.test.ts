import { beforeEach, describe, expect, it, vi } from 'vitest'

// The guest → account migration moves every row a browser-only id holds onto
// a real account. Until 2026-09-13 it accepted two well-formed uuids from
// anyone, which was enough to move anyone's rehearsals, debriefs and playbook
// onto anyone's account. These pin the two ownership checks that guard it
// now, the order they run in, and that nothing is written when either fails.

const verifyOwnership = vi.hoisted(() => vi.fn())
const verifyDeviceBinding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership, verifyDeviceBinding }
})

// The only query the route runs is update({ user_id }).eq('user_id', old),
// once per table. Each link of the chain is its own spy so the test can read
// the table, the value written and the row filter.
type Eq = (column: string, value: string) => Promise<{ error: { message: string } | null }>
const eq = vi.hoisted(() => vi.fn<Eq>(async () => ({ error: null })))
const update = vi.hoisted(() => vi.fn<(values: { user_id: string }) => { eq: typeof eq }>(() => ({ eq })))
const from = vi.hoisted(() => vi.fn<(table: string) => { update: typeof update }>(() => ({ update })))
vi.mock('@/lib/supabase-server', () => ({ supabaseServer: { from } }))

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}))

const { POST } = await import('@/app/api/user/migrate/route')

const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'

/** A NextRequest-shaped stub: only headers, cookies and json() are read. */
function request(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: () => undefined },
  } as never
}

beforeEach(() => {
  verifyOwnership.mockReset()
  verifyDeviceBinding.mockReset()
  from.mockClear()
  update.mockClear()
  eq.mockClear()
})

describe('POST /api/user/migrate', () => {
  it('refuses when the caller does not own the destination account, before touching a table', async () => {
    verifyOwnership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ migrated: false, error: 'Forbidden' })
    expect(verifyOwnership).toHaveBeenCalledWith(expect.anything(), NEW)
    expect(verifyDeviceBinding).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses when the source id is bound to a different device, before touching a table', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ migrated: false, error: 'Forbidden' })
    expect(verifyDeviceBinding).toHaveBeenCalledWith(expect.anything(), OLD)
    expect(from).not.toHaveBeenCalled()
  })

  it('proves the source by its device binding, never by the session — which belongs to the new account', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: true, authenticated: false })

    const res = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ migrated: true })
    // verifyOwnership would refuse the old id as "a valid session for
    // someone else"; it must only ever be asked about the destination.
    expect(verifyOwnership).toHaveBeenCalledTimes(1)
    expect(verifyOwnership).toHaveBeenCalledWith(expect.anything(), NEW)
    expect(verifyDeviceBinding).toHaveBeenCalledTimes(1)
    expect(verifyDeviceBinding).toHaveBeenCalledWith(expect.anything(), OLD)
  })

  it('moves exactly the tables a guest can have written to, filtered on the old id', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: true, authenticated: false })

    await POST(request({ oldUserId: OLD, newUserId: NEW }))

    const tables = from.mock.calls.map(call => call[0]).sort()
    // A closed set on purpose: a table a guest can write to and that is missing
    // from here loses that guest's rows the moment they sign up. `notifications`
    // and `push_subscriptions` left this list on 2026-09-16 with the rest of the
    // notification subsystem — both tables are gone from the schema, so moving
    // rows between them is no longer a thing that can be got wrong.
    expect(tables).toEqual([
      'custom_counterparts',
      'debriefs',
      'playbook_entries',
      'rehearsals',
      'upcoming_conversations',
    ])
    for (const call of update.mock.calls) expect(call[0]).toEqual({ user_id: NEW })
    for (const call of eq.mock.calls) expect(call).toEqual(['user_id', OLD])
  })

  it('answers malformed or identical ids without consulting ownership or the database', async () => {
    for (const body of [{ oldUserId: 'not-a-uuid', newUserId: NEW }, { oldUserId: OLD, newUserId: OLD }, {}]) {
      const res = await POST(request(body))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ migrated: false })
    }
    expect(verifyOwnership).not.toHaveBeenCalled()
    expect(verifyDeviceBinding).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('is replay-safe: the same request twice moves the same rows and still succeeds', async () => {
    // The browser retries this — the failure screens on the sign-up page and
    // the OAuth callback both offer "Try again" with the same pair of ids, and
    // a user signing in again on the same browser sends it once more. The
    // update is filtered on the old id, so the second run matches nothing;
    // what matters is that it is not refused, does not double-write, and does
    // not report a failure the caller would show to someone whose data is
    // already where they wanted it.
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: true, authenticated: false })

    const first = await POST(request({ oldUserId: OLD, newUserId: NEW }))
    const callsAfterFirst = eq.mock.calls.length
    const second = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(await first.json()).toEqual({ migrated: true })
    expect(await second.json()).toEqual({ migrated: true })
    // Same work both times, and every write still scoped to the old id.
    expect(eq.mock.calls.length).toBe(callsAfterFirst * 2)
    for (const call of eq.mock.calls) expect(call).toEqual(['user_id', OLD])
    for (const call of update.mock.calls) expect(call[0]).toEqual({ user_id: NEW })
  })

  it('refuses a source the caller cannot prove even when their own session is real', async () => {
    // The attack the ownership checks exist for, written as the attacker sees
    // it: a genuine account of their own, and someone else's guest uuid — which
    // is not a secret, since the client sends it as a query parameter on every
    // read. Since 2026-09-14 that uuid is bound to its own browser the moment
    // it starts a rehearsal (tests/guest-binding.test.ts), so the device-token
    // check has something to refuse with.
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('reports a partial failure rather than swallowing it', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    verifyDeviceBinding.mockResolvedValue({ ok: true, authenticated: false })
    eq.mockImplementationOnce(async () => ({ error: { message: 'boom' } }))

    const res = await POST(request({ oldUserId: OLD, newUserId: NEW }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.migrated).toBe(false)
    expect(body.failedTables).toHaveLength(1)
  })
})
