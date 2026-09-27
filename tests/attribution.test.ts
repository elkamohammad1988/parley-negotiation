import { beforeEach, describe, expect, it, vi } from 'vitest'

// Three routes take an id out of a request body and attach something to it, and
// the right answer to an id the caller cannot prove is different in each:
//
//   /api/safety    attribution decides whether an account gets BANNED. Three
//                  unauthenticated posts naming a stranger's uuid suspended
//                  their account and seeded a compliance log with their id.
//                  An unproven id is REFUSED.
//   /api/analytics attribution decides whose funnel a row lands in, and the
//                  `properties` payload was written to a jsonb column verbatim —
//                  so the "free text never reaches this table" rule that
//                  lib/analytics.ts opens with was a comment, not a control.
//                  An unproven id is DROPPED, so a real event still counts.
//   /api/playbook  the note is the user's own writing and must survive. A
//                  malformed source id is DROPPED rather than passed to a uuid
//                  column, where it would fail the insert and lose the note.
//
// These pin all three, including the deliberate differences between them —
// which are the part a later edit is most likely to flatten.

const verifyOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership, clientIp: () => '203.0.113.9' }
})

const checkSafety = vi.hoisted(() => vi.fn())
const checkContent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/safety', () => ({ checkSafety, checkContent }))

// Captures the row the playbook route tries to insert.
const insert = vi.hoisted(() => vi.fn())
const maybeSingle = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, { from: self, select: self, eq: self, order: self, limit: self, insert, maybeSingle })
  insert.mockImplementation(() => chain)
  return { supabaseServer: chain }
})

const trackEvent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics', () => ({ trackEvent }))

// Rate limiting is real in these tests but keyed on a fixed ip, so the window
// has to be reset between cases or the later ones 429.
const checkRateLimit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit }))

const { POST: safetyPost } = await import('@/app/api/safety/route')
const { POST: analyticsPost } = await import('@/app/api/analytics/route')
const { POST: playbookPost } = await import('@/app/api/playbook/route')

const VICTIM = '11111111-1111-4111-8111-111111111111'

function jsonRequest(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    cookies: { get: () => undefined },
    json: async () => body,
  } as never
}

beforeEach(() => {
  verifyOwnership.mockReset()
  checkSafety.mockReset()
  trackEvent.mockReset()
  checkRateLimit.mockReset()
  checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  checkSafety.mockResolvedValue({ safe: true })
  checkContent.mockReturnValue({ blocked: false })
  insert.mockClear()
  maybeSingle.mockReset()
  maybeSingle.mockResolvedValue({
    data: {
      id: 'entry-1',
      user_id: VICTIM,
      note: 'a note',
      dimension: null,
      source_rehearsal_id: null,
      source_scenario_title: null,
      created_at: new Date().toISOString(),
    },
    error: null,
  })
})

describe('/api/safety — attribution requires proof', () => {
  it('refuses a userId the caller cannot prove, and runs no check against it', async () => {
    verifyOwnership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await safetyPost(jsonRequest({ message: 'anything at all', userId: VICTIM }))

    expect(res.status).toBe(403)
    // The important half: checkSafety is what writes critical_violations and
    // flips users.banned. It must not run at all for an unproven id.
    expect(checkSafety).not.toHaveBeenCalled()
  })

  it('attributes to the caller once ownership is proven', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    const res = await safetyPost(jsonRequest({ message: 'check this', userId: VICTIM }))

    expect(res.status).toBe(200)
    expect(checkSafety).toHaveBeenCalledWith('check this', 'standalone-check', VICTIM)
  })

  it('still runs an unattributed check when no userId is named', async () => {
    const res = await safetyPost(jsonRequest({ message: 'check this' }))

    expect(res.status).toBe(200)
    expect(verifyOwnership).not.toHaveBeenCalled()
    // undefined, not 'anonymous' and not a caller-supplied value: nothing is
    // attached to any account.
    expect(checkSafety).toHaveBeenCalledWith('check this', 'standalone-check', undefined)
  })

  it('bounds the message rather than scanning an unbounded body', async () => {
    const res = await safetyPost(jsonRequest({ message: 'a'.repeat(4001) }))

    expect(res.status).toBe(400)
    expect(checkSafety).not.toHaveBeenCalled()
  })
})

describe('/api/analytics — properties cannot carry free text', () => {
  it('drops undeclared keys instead of storing them', async () => {
    const res = await analyticsPost(
      jsonRequest({
        event: 'paywall_viewed',
        properties: {
          source: 'pricing_page',
          // The shape of the real risk: a transcript line smuggled in beside a
          // legitimate key.
          note: 'I am going to ask for 15% and my manager is called Dana',
          __proto__: { polluted: true },
        },
      })
    )

    expect(res.status).toBe(200)
    const [event] = trackEvent.mock.calls[0]
    expect(event.properties).toEqual({ source: 'pricing_page' })
    expect('note' in event.properties).toBe(false)
  })

  it('drops a declared key whose value is not one of the declared literals', async () => {
    await analyticsPost(
      jsonRequest({ event: 'signup_started', properties: { method: 'smuggled free text' } })
    )

    const [event] = trackEvent.mock.calls[0]
    expect(event.properties).toEqual({})
  })

  it('takes no properties at all for an event that declares none', async () => {
    await analyticsPost(
      jsonRequest({ event: 'counterpart_created', properties: { description: 'my actual boss' } })
    )

    const [event] = trackEvent.mock.calls[0]
    expect(event.properties).toEqual({})
  })

  it('survives a properties value that is not an object', async () => {
    for (const bad of ['a string', 42, null, ['a', 'b']]) {
      trackEvent.mockClear()
      const res = await analyticsPost(jsonRequest({ event: 'counterpart_created', properties: bad }))
      expect(res.status).toBe(200)
      expect(trackEvent.mock.calls[0][0].properties).toEqual({})
    }
  })

  it('keeps every declared key when the payload is legitimate', async () => {
    await analyticsPost(
      jsonRequest({
        event: 'checkout_started',
        properties: { plan: 'practitioner', interval: 'annual' },
      })
    )

    const [event] = trackEvent.mock.calls[0]
    expect(event.properties).toEqual({ plan: 'practitioner', interval: 'annual' })
  })
})

describe('/api/analytics — attribution requires proof', () => {
  it('records the event unattributed when the caller cannot prove the id', async () => {
    verifyOwnership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await analyticsPost(
      jsonRequest({ event: 'checkout_started', properties: { plan: 'professional' }, userId: VICTIM })
    )

    // Not a refusal — see the note in the route on why this differs from
    // /api/safety. The event still counts; it just counts for nobody.
    expect(res.status).toBe(200)
    expect(trackEvent).toHaveBeenCalledWith(expect.anything(), null)
  })

  it('attributes once ownership is proven', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    await analyticsPost(jsonRequest({ event: 'signup_completed', properties: { method: 'email' }, userId: VICTIM }))

    expect(trackEvent).toHaveBeenCalledWith(expect.anything(), VICTIM)
  })

  it('rejects an event name that is not on the client whitelist', async () => {
    const res = await analyticsPost(jsonRequest({ event: 'debrief_generated', properties: {} }))

    expect(res.status).toBe(400)
    expect(trackEvent).not.toHaveBeenCalled()
  })
})

describe('/api/playbook — a caller-supplied source id cannot break the write', () => {
  const REHEARSAL = '33333333-3333-4333-8333-333333333333'

  it('drops a malformed sourceRehearsalId rather than losing the note to a 500', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    const res = await playbookPost(
      jsonRequest({ userId: VICTIM, note: 'Ask before naming a number', sourceRehearsalId: '../../etc/passwd' })
    )

    expect(res.status).toBe(200)
    // The row is still written — the note survives — with the unusable
    // attribution dropped. source_rehearsal_id is a uuid column with a foreign
    // key, so passing the raw value through would have failed the whole insert.
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source_rehearsal_id: null }))
  })

  it('keeps a well-formed source id', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    await playbookPost(
      jsonRequest({ userId: VICTIM, note: 'Nine seconds of silence', sourceRehearsalId: REHEARSAL })
    )

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source_rehearsal_id: REHEARSAL }))
  })

  it('still refuses to write anything for an unproven userId', async () => {
    verifyOwnership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await playbookPost(jsonRequest({ userId: VICTIM, note: 'not mine to write' }))

    expect(res.status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
  })
})
