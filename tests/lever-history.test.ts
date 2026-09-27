import { beforeEach, describe, expect, it, vi } from 'vitest'

// The lever history on /api/progress.
//
// The trends on that page say whether the scores are moving. This aggregate
// says what they are moving away from, and it is the only reading there with
// ground truth beneath it: every lever counted was authored into a scenario
// before the rehearsal started. So it has to be a count and not an estimate —
// which means it has to be right about malformed rows, about debriefs scored
// before levers existed, and about not quietly reporting an empty history as a
// successful read.

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return { ...actual, verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })) }
})

vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return { ...actual, getUserPlan: vi.fn(async () => 'professional' as const) }
})

const result = vi.hoisted(() => ({ data: [] as unknown[], error: null as { message: string } | null }))
vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self,
    select: self,
    eq: self,
    order: self,
    // `limit` is the last call in the chain, so it resolves.
    limit: () => Promise.resolve(result),
  })
  return { supabaseServer: chain }
})

const USER = '11111111-1111-4111-8111-111111111111'

const DIMENSIONS = [
  { dimension: 'anchoring', score: 50, note: '' },
  { dimension: 'concession', score: 50, note: '' },
  { dimension: 'discovery', score: 50, note: '' },
  { dimension: 'composure', score: 50, note: '' },
  { dimension: 'close', score: 50, note: '' },
]

const lever = (kind: string, found: boolean, free = false) => ({
  id: `${kind}-${found}-${free}`,
  label: 'l',
  unlockedBy: 'u',
  kind,
  found,
  ...(free ? { free: true } : {}),
})

function row(levers: unknown, at = '2026-09-01T00:00:00.000Z') {
  return { overall_score: 50, dimensions: DIMENSIONS, levers, created_at: at, rehearsal_id: crypto.randomUUID() }
}

async function progress() {
  const { GET } = await import('@/app/api/progress/route')
  const res = await GET({
    nextUrl: new URL(`http://localhost/api/progress?userId=${USER}`),
  } as never)
  return { status: res.status, body: await res.json() }
}

describe('the lever history', () => {
  beforeEach(() => {
    result.data = []
    result.error = null
  })

  it('counts found against everything faced, across rehearsals', async () => {
    result.data = [
      row([lever('price', true), lever('trade', false), lever('intel', true)]),
      row([lever('price', false), lever('trade', false)]),
    ]
    const { body } = await progress()
    expect(body.levers.found).toBe(2)
    expect(body.levers.total).toBe(5)
    expect(body.levers.rehearsals).toBe(2)
  })

  it('breaks the count down by kind, in a stable order', async () => {
    result.data = [row([lever('intel', true), lever('price', false), lever('trade', true)])]
    const { body } = await progress()
    // Not insertion order: the page reads the same way on every visit.
    expect(body.levers.byKind.map((k: { kind: string }) => k.kind)).toEqual(['price', 'trade', 'intel'])
  })

  it('reports only the kinds actually faced', async () => {
    result.data = [row([lever('price', true)])]
    const { body } = await progress()
    expect(body.levers.byKind).toEqual([{ kind: 'price', found: 1, total: 1 }])
  })

  it('counts a rehearsal where a free lever went unfound', async () => {
    result.data = [
      row([lever('trade', false, true), lever('price', true)]),
      row([lever('trade', true, true)]),
      row([lever('intel', false, true)]),
    ]
    const { body } = await progress()
    expect(body.levers.freeMissRehearsals).toBe(2)
  })

  it('ignores a debrief scored before levers existed', async () => {
    // The column defaults to an empty array, and an empty ledger is not a
    // rehearsal where the buyer found nothing — it is one that was never
    // scored against a ledger at all. Counting it would drag the fraction
    // down with rehearsals that never had the chance.
    result.data = [row([]), row([lever('price', true)])]
    const { body } = await progress()
    expect(body.levers.rehearsals).toBe(1)
    expect(body.levers.total).toBe(1)
  })

  it('drops a malformed lever rather than counting it', async () => {
    result.data = [
      row([lever('price', true), { kind: 'not-a-kind', found: true }, null, 'nonsense', { found: true }]),
    ]
    const { body } = await progress()
    expect(body.levers.total).toBe(1)
    expect(body.levers.found).toBe(1)
  })

  it('treats a non-array levers column as no ledger', async () => {
    result.data = [row(null), row('{}')]
    const { body } = await progress()
    expect(body.levers.rehearsals).toBe(0)
    expect(body.levers.total).toBe(0)
  })

  it('is not withheld from a free plan', async () => {
    // Unlike the trends, this says nothing about movement over time, and it is
    // the clearest evidence in the product that a second rehearsal is worth
    // running — which makes it the wrong thing to hide from someone deciding.
    const rehearsals = await import('@/lib/rehearsals')
    vi.mocked(rehearsals.getUserPlan).mockResolvedValueOnce('free')
    result.data = [row([lever('price', true), lever('trade', false)])]
    const { body } = await progress()
    expect(body.locked).toBe(true)
    expect(body.levers.total).toBe(2)
    expect(body.levers.found).toBe(1)
  })

  it('fails loudly when the history cannot be read', async () => {
    // It used to return 200 with an empty history, which renders as "you have
    // never rehearsed anything" — an outage telling a paying user their work
    // is gone.
    result.error = { message: 'connection refused' }
    const { status, body } = await progress()
    expect(status).toBe(503)
    expect(body.error).toBeTruthy()
    expect(body.rehearsalCount).toBeUndefined()
  })
})
