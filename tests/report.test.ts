import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORT_REASONS, isReportReason } from '@/lib/negotiation/reports'

// Reporting a counterpart that misbehaved.
//
// This route existed with no caller: nothing in the product could reach it, so
// the `reports` table could never receive a row. That is worse here than a
// normal orphan would be — every claim Parley makes rests on the counterpart
// not folding and not disclosing its mandate, and a user who has just watched
// one concede in three turns is the only instrument that sees whether it does.
// The debrief now carries the form.
//
// Becoming reachable is what these pin. Two behaviours were fine while nobody
// could call it and are not fine now:
//
//   ATTRIBUTION was taken from the body on trust, so a report could be filed
//   under someone else's id. It is now proven, and an unproven id is DROPPED
//   rather than refused — the same trade /api/analytics settled on, because a
//   report is still worth having from someone whose session lapsed.
//
//   A FAILED INSERT answered `{ ok: true }`. Invisible with no UI; with one it
//   is the product telling someone their report was filed when it was not.

const verifyOwnership = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership, clientIp: () => '203.0.113.11' }
})

const insert = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, { from: () => chain, insert })
  return { supabaseServer: chain }
})

const checkRateLimit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit }))

const { POST } = await import('@/app/api/report/route')

const OWNER = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const REHEARSAL = '33333333-3333-4333-8333-333333333333'

function jsonRequest(body: unknown) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    cookies: { get: () => undefined },
    json: async () => body,
  } as never
}

/** The row the route tried to write. */
function written() {
  expect(insert).toHaveBeenCalledTimes(1)
  return insert.mock.calls[0][0] as Record<string, unknown>
}

beforeEach(() => {
  verifyOwnership.mockReset()
  insert.mockReset()
  insert.mockResolvedValue({ error: null })
  checkRateLimit.mockReset()
  checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
})

describe('the reason set is declared once', () => {
  it('is the closed list the form renders', () => {
    // The ids the route validates and the options the debrief offers come from
    // the same module. Two lists of one closed set drift, and the failure is a
    // 400 on a form that looks fine.
    expect(REPORT_REASONS.map(r => r.id)).toEqual([
      'broke-role',
      'too-easy',
      'revealed-mandate',
      'nonsensical',
      'abusive',
      'other',
    ])
    for (const r of REPORT_REASONS) {
      expect(isReportReason(r.id)).toBe(true)
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.hint.length).toBeGreaterThan(0)
    }
    expect(isReportReason('inappropriate')).toBe(false)
    expect(isReportReason(undefined)).toBe(false)
  })
})

describe('POST /api/report', () => {
  it('refuses a reason that is not in the set, and writes nothing', async () => {
    const res = await POST(jsonRequest({ reason: 'made-me-sad', userId: OWNER }))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('attributes the report once ownership is proven', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    const res = await POST(
      jsonRequest({ reason: 'broke-role', userId: OWNER, rehearsalId: REHEARSAL })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(written()).toMatchObject({
      user_id: OWNER,
      rehearsal_id: REHEARSAL,
      reason: 'broke-role',
    })
  })

  it('drops an id the caller cannot prove, but still files the report', async () => {
    verifyOwnership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(
      jsonRequest({ reason: 'too-easy', userId: STRANGER, rehearsalId: REHEARSAL })
    )

    // Filed — the counterpart's behaviour is worth knowing about either way —
    // but attached to nobody. This is the deliberate difference from
    // /api/safety, where an unproven id is refused outright because
    // attribution there decides whether an account gets banned.
    expect(res.status).toBe(200)
    expect(written().user_id).toBeNull()
    expect(written().reason).toBe('too-easy')
  })

  it('drops a malformed rehearsal id rather than losing the report', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    await POST(jsonRequest({ reason: 'nonsensical', userId: OWNER, rehearsalId: 'not-a-uuid' }))

    // Both are uuid columns, so a malformed value would fail the whole insert.
    expect(written().rehearsal_id).toBeNull()
  })

  it('bounds the detail field', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })

    await POST(jsonRequest({ reason: 'other', userId: OWNER, detail: 'x'.repeat(5000) }))

    expect((written().detail as string).length).toBe(1000)
  })

  it('reports a failed insert as a failure, not as success', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    insert.mockResolvedValue({ error: { message: 'connection refused' } })

    const res = await POST(jsonRequest({ reason: 'abusive', userId: OWNER }))

    // The debrief says "Filed" on a 2xx. It must not say that for a row that
    // never landed.
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('keeps the database message out of the response', async () => {
    verifyOwnership.mockResolvedValue({ ok: true, authenticated: true })
    insert.mockResolvedValue({ error: { message: 'relation "reports" does not exist' } })

    const res = await POST(jsonRequest({ reason: 'abusive', userId: OWNER }))

    expect(JSON.stringify(await res.json())).not.toContain('relation')
  })
})
