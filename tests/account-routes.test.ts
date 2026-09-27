import { beforeEach, describe, expect, it, vi } from 'vitest'

// Four routes that used to take a userId on trust.
//
// Each one is a boundary where the caller names an account and the server acts
// on it, and each was reachable by anyone who knew a uuid — which the client
// sends as a query parameter on every read, so it is not a secret. The tests
// below pin the gate, and pin that nothing is written or sent when it refuses.

const verifyOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership }
})

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
}))

// A minimal supabase-js stand-in. Reads resolve whatever `row` holds; writes
// are recorded so a test can assert that none happened.
type Write = { table: string; values: Record<string, unknown> }
const writes = vi.hoisted(() => [] as Write[])
const row = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, error: null as { message: string } | null }))
vi.mock('@/lib/supabase-server', () => {
  function builder(table: string) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self,
      eq: self,
      maybeSingle: async () => row,
      update: (values: Record<string, unknown>) => {
        writes.push({ table, values })
        return chain
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    })
    return chain
  }
  return { supabaseServer: { from: (table: string) => builder(table) } }
})

const USER = '11111111-1111-4111-8111-111111111111'

/** A NextRequest-shaped stub: only headers, cookies, json() and nextUrl are read. */
function request(body: unknown, query: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/test')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    cookies: { get: () => undefined },
    nextUrl: url,
  } as never
}

const FORBIDDEN = { ok: false, status: 403 as const, error: 'Forbidden' }
const OWNED = { ok: true, authenticated: true }

beforeEach(() => {
  writes.length = 0
  row.data = null
  row.error = null
  verifyOwnership.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

// ── The display name is not a cosmetic field ────────────────────────────────

describe('POST /api/user/update-profile', () => {
  it('refuses a userId the caller does not own, before writing', async () => {
    verifyOwnership.mockResolvedValue(FORBIDDEN)
    const { POST } = await import('@/app/api/user/update-profile/route')

    const res = await POST(request({ userId: USER, displayName: 'not mine' }))

    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('bounds the name rather than storing whatever arrives', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    const { POST } = await import('@/app/api/user/update-profile/route')

    const res = await POST(request({ userId: USER, displayName: 'x'.repeat(5000) }))

    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(String(writes[0].values.display_name)).toHaveLength(80)
  })

  it('saves a name the caller owns', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    const { POST } = await import('@/app/api/user/update-profile/route')

    const res = await POST(request({ userId: USER, displayName: '  Mo  ' }))

    expect(res.status).toBe(200)
    expect(writes[0]).toEqual({ table: 'users', values: { display_name: 'Mo' } })
  })
})

// ── An account's email address is not public ────────────────────────────────

describe('GET /api/user/profile', () => {
  it('refuses a userId the caller does not own, and returns no address', async () => {
    verifyOwnership.mockResolvedValue(FORBIDDEN)
    row.data = { display_name: 'Mo', email: 'private@example.com' }
    const { GET } = await import('@/app/api/user/profile/route')

    const res = await GET(request(null, { userId: USER }))

    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('private@example.com')
  })

  it('returns the profile to the account itself', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    row.data = { display_name: 'Mo', email: 'mine@example.com' }
    const { GET } = await import('@/app/api/user/profile/route')

    const res = await GET(request(null, { userId: USER }))

    expect(await res.json()).toEqual({ displayName: 'Mo', email: 'mine@example.com' })
  })
})

// ── The mail endpoint is not a relay ────────────────────────────────────────

describe('POST /api/email', () => {
  it('ignores a caller-supplied recipient entirely', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    row.data = { email: 'owner@example.com', display_name: 'Mo' }
    process.env.RESEND_API_KEY = 'test-key'
    process.env.EMAIL_FROM = 'parley@example.com'
    vi.resetModules()
    const { POST } = await import('@/app/api/email/route')

    await POST(request({ type: 'welcome', userId: USER, to: 'victim@example.com' }))

    const sent = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(sent).toHaveLength(1)
    const body = JSON.parse(String((sent[0][1] as RequestInit).body))
    expect(body.to).toBe('owner@example.com')

    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    vi.resetModules()
  })

  it('sends nothing at all for an account the caller does not own', async () => {
    verifyOwnership.mockResolvedValue(FORBIDDEN)
    const { POST } = await import('@/app/api/email/route')

    const res = await POST(request({ type: 'billing', userId: USER, headline: 'Pay now' }))

    expect(res.status).toBe(403)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuses a guest address that can never receive mail', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    row.data = { email: 'guest_abc@parley-guest.local', display_name: 'Guest' }
    const { POST } = await import('@/app/api/email/route')

    const res = await POST(request({ type: 'welcome', userId: USER }))

    expect(res.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

// ── Checkout metadata decides who gets the plan ─────────────────────────────

describe('POST /api/stripe', () => {
  it('refuses to open a checkout naming an account the caller does not own', async () => {
    verifyOwnership.mockResolvedValue(FORBIDDEN)
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    vi.resetModules()
    const { POST } = await import('@/app/api/stripe/route')

    const res = await POST(request({ plan: 'practitioner', interval: 'monthly', userId: USER }))

    expect(res.status).toBe(403)
    // Nothing reached Stripe, so no session exists to be completed.
    expect(globalThis.fetch).not.toHaveBeenCalled()

    delete process.env.STRIPE_SECRET_KEY
    vi.resetModules()
  })

  // Team is in PLAN_ORDER so an existing subscription keeps full access, and
  // out of PUBLIC_PLANS because it is Professional's entitlements at a lower
  // price. This route validated with isPlan — which reads PLAN_ORDER — so a
  // caller who simply typed the withdrawn plan's name bought full access at the
  // withdrawn rate. Ownership is OWNED here and the price is configured, so the
  // only thing that can produce the refusal is the plan guard itself.
  it('refuses to sell a plan that is not offered, even to a caller who owns the account', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_TEAM_MONTHLY = 'price_team_monthly'
    vi.resetModules()
    const { POST } = await import('@/app/api/stripe/route')

    const res = await POST(request({ plan: 'team', interval: 'monthly', userId: USER }))

    expect(res.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()

    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_TEAM_MONTHLY
    vi.resetModules()
  })

  it('refuses a guest holding only a device token, and says how to continue', async () => {
    // A device token is a browser that once used this id, not identity. The
    // one route that takes money requires a signed-in account, like the
    // billing portal and account deletion already did.
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: false })
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_PRACTITIONER_MONTHLY = 'price_practitioner_monthly'
    vi.resetModules()
    const { POST } = await import('@/app/api/stripe/route')

    const res = await POST(request({ plan: 'practitioner', interval: 'monthly', userId: USER }))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('session_required')
    expect(globalThis.fetch).not.toHaveBeenCalled()

    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_PRACTITIONER_MONTHLY
    vi.resetModules()
  })

  it('still sells the plans it does offer', async () => {
    verifyOwnership.mockResolvedValue(OWNED)
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_PRICE_PRACTITIONER_MONTHLY = 'price_practitioner_monthly'
    vi.resetModules()
    const { POST } = await import('@/app/api/stripe/route')

    const res = await POST(request({ plan: 'practitioner', interval: 'monthly', userId: USER }))

    // Reached Stripe rather than being turned away at the guard — the fix above
    // narrowed what may be bought, and this pins that it narrowed it no further.
    expect(res.status).toBe(200)
    expect(globalThis.fetch).toHaveBeenCalled()

    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_PRACTITIONER_MONTHLY
    vi.resetModules()
  })
})
