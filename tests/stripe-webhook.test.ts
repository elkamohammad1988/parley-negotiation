import { beforeEach, describe, expect, it, vi } from 'vitest'

// The webhook is the only thing that grants a paid plan, so the tests below are
// mostly about the three ways Stripe can be unhelpful: it retries, it does not
// order deliveries, and anyone can POST to the URL.

const SECRET = 'whsec_test_secret'
process.env.STRIPE_WEBHOOK_SECRET = SECRET

const trackEvent = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/analytics', () => ({ trackEvent }))

// Records every table operation so the tests can assert on what was written.
type Op = { table: string; kind: string; payload?: unknown; filters: Record<string, string> }
const ops = vi.hoisted(() => [] as Op[])
const ledgerInsert = vi.hoisted(() => vi.fn(async () => ({ error: null as { code?: string; message: string } | null })))
const ledgerUpdateResult = vi.hoisted(() => vi.fn(async () => ({ error: null as { message: string } | null })))
/** What a read of stripe_events returns — the prior attempt's state. */
const priorEvent = vi.hoisted(() =>
  vi.fn(async () => ({ data: null as { status: string; attempts: number } | null, error: null as { message: string } | null }))
)
const updateResult = vi.hoisted(() =>
  vi.fn(async () => ({ data: null as { user_id: string } | null, error: null as { message: string } | null }))
)
/** What the subscriptions upsert (the paid grant) returns. */
const upsertResult = vi.hoisted(() => vi.fn(async () => ({ error: null as { message: string } | null })))

vi.mock('@/lib/supabase-server', () => {
  function builder(table: string) {
    const op: Op = { table, kind: '', filters: {} }
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      insert: (payload: unknown) => {
        op.kind = 'insert'
        op.payload = payload
        ops.push(op)
        return table === 'stripe_events' ? ledgerInsert() : Promise.resolve({ error: null })
      },
      upsert: (payload: unknown) => {
        op.kind = 'upsert'
        op.payload = payload
        ops.push(op)
        return table === 'subscriptions' ? upsertResult() : Promise.resolve({ error: null })
      },
      update: (payload: unknown) => {
        op.kind = 'update'
        op.payload = payload
        ops.push(op)
        return chain
      },
      // The chain is itself awaitable, because a ledger update is awaited
      // straight after .eq() while a subscriptions update goes on through
      // .select().maybeSingle(). Without this, awaiting the former yields the
      // builder object and every error check silently passes.
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) => {
        const result =
          table === 'stripe_events' && op.kind === 'update'
            ? ledgerUpdateResult()
            : Promise.resolve({ error: null })
        return result.then(resolve, reject)
      },
      eq: (col: string, val: string) => {
        op.filters[col] = val
        return chain
      },
      or: (expr: string) => {
        op.filters.or = expr
        return chain
      },
      select: self,
      maybeSingle: () => (table === 'stripe_events' ? priorEvent() : updateResult()),
    })
    return chain
  }
  return { supabaseServer: { from: (table: string) => builder(table) } }
})

const { POST } = await import('@/app/api/stripe-webhook/route')

/** Signs a payload the way Stripe does, so the route's own check is exercised. */
async function sign(payload: string, secret = SECRET): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

async function post(event: unknown, opts: { secret?: string; signature?: string } = {}) {
  const payload = JSON.stringify(event)
  const signature = opts.signature ?? (await sign(payload, opts.secret ?? SECRET))
  return POST({
    text: async () => payload,
    headers: new Headers({ 'stripe-signature': signature }),
  } as never)
}

// ── Fixtures, shaped as Stripe actually sends them ──────────────────────────

const USER = '11111111-1111-4111-8111-111111111111'

const checkoutCompleted = {
  id: 'evt_checkout_1',
  type: 'checkout.session.completed',
  created: 1_760_000_000,
  data: {
    object: {
      id: 'cs_test_1',
      customer: 'cus_123',
      subscription: 'sub_123',
      metadata: { user_id: USER, plan: 'practitioner' },
    },
  },
}

function subscriptionUpdated(overrides: Record<string, unknown> = {}, created = 1_760_000_100) {
  return {
    id: `evt_updated_${created}`,
    type: 'customer.subscription.updated',
    created,
    data: {
      object: {
        id: 'sub_123',
        status: 'active',
        current_period_end: 1_762_000_000,
        cancel_at_period_end: false,
        items: { data: [{ price: { lookup_key: 'professional_monthly', metadata: { tier: 'professional' } } }] },
        ...overrides,
      },
    },
  }
}

const subscriptionDeleted = {
  id: 'evt_deleted_1',
  type: 'customer.subscription.deleted',
  created: 1_760_000_200,
  data: { object: { id: 'sub_123', status: 'canceled' } },
}

beforeEach(() => {
  ops.length = 0
  trackEvent.mockReset()
  ledgerInsert.mockReset()
  ledgerInsert.mockResolvedValue({ error: null })
  ledgerUpdateResult.mockReset()
  ledgerUpdateResult.mockResolvedValue({ error: null })
  priorEvent.mockReset()
  priorEvent.mockResolvedValue({ data: null, error: null })
  updateResult.mockReset()
  updateResult.mockResolvedValue({ data: { user_id: USER }, error: null })
  upsertResult.mockReset()
  upsertResult.mockResolvedValue({ error: null })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

const opsOn = (table: string) => ops.filter(o => o.table === table)

// ── Authenticity ────────────────────────────────────────────────────────────

describe('signature verification', () => {
  it('rejects an unsigned request', async () => {
    const res = await post(checkoutCompleted, { signature: '' })
    expect(res.status).toBe(400)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })

  it('rejects a request signed with the wrong secret', async () => {
    // The attack this stops: a hand-rolled checkout.session.completed naming
    // any user_id and any plan would otherwise grant a paid subscription.
    const res = await post(checkoutCompleted, { secret: 'whsec_wrong' })
    expect(res.status).toBe(400)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })

  it('rejects a tampered payload that keeps a valid-looking signature', async () => {
    const original = JSON.stringify(checkoutCompleted)
    const signature = await sign(original)
    const tampered = JSON.stringify({
      ...checkoutCompleted,
      data: { object: { ...checkoutCompleted.data.object, metadata: { user_id: USER, plan: 'team' } } },
    })

    const res = await POST({
      text: async () => tampered,
      headers: new Headers({ 'stripe-signature': signature }),
    } as never)

    expect(res.status).toBe(400)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })

  it('accepts a correctly signed event', async () => {
    const res = await post(checkoutCompleted)
    expect(res.status).toBe(200)
  })

  // Stripe signs a timestamp alongside the payload so a captured delivery
  // cannot be replayed later. Nothing was reading it, so a valid signature
  // stayed valid forever — the event ledger covered a replay of a SEEN event
  // but not one captured in transit and delayed, or replayed ahead of the
  // original. These two pin the tolerance in both directions.
  async function signAt(payload: string, timestamp: number): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `t=${timestamp},v1=${hex}`
  }

  it('rejects a genuinely signed event replayed outside the tolerance', async () => {
    const payload = JSON.stringify(checkoutCompleted)
    const stale = Math.floor(Date.now() / 1000) - 600 // ten minutes old

    const res = await POST({
      text: async () => payload,
      headers: new Headers({ 'stripe-signature': await signAt(payload, stale) }),
    } as never)

    expect(res.status).toBe(400)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })

  it('rejects a far-future timestamp, which is forgery rather than delay', async () => {
    const payload = JSON.stringify(checkoutCompleted)
    const future = Math.floor(Date.now() / 1000) + 600

    const res = await POST({
      text: async () => payload,
      headers: new Headers({ 'stripe-signature': await signAt(payload, future) }),
    } as never)

    expect(res.status).toBe(400)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })

  it('still accepts a delivery inside the tolerance', async () => {
    const payload = JSON.stringify(checkoutCompleted)
    const recent = Math.floor(Date.now() / 1000) - 120

    const res = await POST({
      text: async () => payload,
      headers: new Headers({ 'stripe-signature': await signAt(payload, recent) }),
    } as never)

    expect(res.status).toBe(200)
  })
})

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('replay protection', () => {
  it('records the event id before doing any work', async () => {
    await post(checkoutCompleted)
    const ledger = opsOn('stripe_events')[0]
    expect(ledger.kind).toBe('insert')
    expect((ledger.payload as { id: string }).id).toBe('evt_checkout_1')
    // The ledger write must come first, or a crash mid-handler leaves the event
    // unrecorded and the retry re-runs the side effects.
    expect(ops[0].table).toBe('stripe_events')
  })

  it('claims the event as processing, not merely as seen', async () => {
    await post(checkoutCompleted)
    const claim = opsOn('stripe_events')[0]
    expect((claim.payload as { status: string }).status).toBe('processing')
  })

  it('marks the event done only after the handler returns', async () => {
    await post(checkoutCompleted)
    const ledgerOps = opsOn('stripe_events')
    const done = ledgerOps.find(o => (o.payload as { status?: string })?.status === 'done')

    expect(done, 'event was never marked done').toBeTruthy()
    // Ordering is the guarantee: the subscription write has to happen between
    // the claim and the completion, or 'done' means nothing.
    const claimIndex = ops.indexOf(ledgerOps[0])
    const doneIndex = ops.indexOf(done as Op)
    const workIndex = ops.indexOf(opsOn('subscriptions')[0])
    expect(claimIndex).toBeLessThan(workIndex)
    expect(workIndex).toBeLessThan(doneIndex)
  })

  it('does nothing on a replay of an event already marked done', async () => {
    ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    priorEvent.mockResolvedValue({ data: { status: 'done', attempts: 1 }, error: null })

    const res = await post(checkoutCompleted)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.duplicate).toBe(true)
    expect(opsOn('subscriptions')).toHaveLength(0)
    expect(trackEvent).not.toHaveBeenCalled()
    // The notification is the visible half: a retried delivery used to re-send
    // "your plan is active" every time Stripe retried.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks Stripe to retry when the ledger itself is unavailable', async () => {
    // Better a late delivery than an entitlement change we cannot prove we
    // applied exactly once.
    ledgerInsert.mockResolvedValue({ error: { code: '08006', message: 'connection failure' } })

    const res = await post(checkoutCompleted)
    expect(res.status).toBe(503)
    expect(opsOn('subscriptions')).toHaveLength(0)
  })
})

// ── Failures must not be swallowed ──────────────────────────────────────────

describe('a handler that throws', () => {
  it('records the failure and asks Stripe to retry instead of answering 200', async () => {
    // The bug this replaces: the ledger insert succeeded, the handler threw,
    // the catch logged it, and the route still returned 200. Stripe never
    // redelivered and the entitlement change was gone.
    updateResult.mockRejectedValue(new Error('subscriptions table is on fire'))

    const res = await post(subscriptionUpdated())

    expect(res.status).toBe(503)
    const failed = opsOn('stripe_events').find(o => (o.payload as { status?: string })?.status === 'failed')
    expect(failed, 'the event was not marked failed').toBeTruthy()
    expect((failed?.payload as { last_error: string }).last_error).toContain('on fire')
  })

  it('never marks a thrown handler done', async () => {
    updateResult.mockRejectedValue(new Error('boom'))
    await post(subscriptionUpdated())
    const done = opsOn('stripe_events').find(o => (o.payload as { status?: string })?.status === 'done')
    expect(done).toBeUndefined()
  })

  it('re-runs the handler on redelivery of a failed event, and succeeds', async () => {
    // The full path the retry exists for: delivery 1 throws and 503s, Stripe
    // redelivers, delivery 2 finds status 'failed', re-runs the work and
    // completes.
    updateResult.mockRejectedValue(new Error('transient'))
    const first = await post(subscriptionUpdated())
    expect(first.status).toBe(503)

    ops.length = 0
    updateResult.mockReset()
    updateResult.mockResolvedValue({ data: { user_id: USER }, error: null })
    // Redelivery: the id is already there, and the prior attempt failed.
    ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    priorEvent.mockResolvedValue({ data: { status: 'failed', attempts: 1 }, error: null })

    const second = await post(subscriptionUpdated())

    expect(second.status).toBe(200)
    // The work actually re-ran rather than being skipped as a duplicate.
    expect(opsOn('subscriptions')).toHaveLength(1)
    expect((opsOn('subscriptions')[0].payload as { plan?: string }).plan).toBe('professional')
    const done = opsOn('stripe_events').find(o => (o.payload as { status?: string })?.status === 'done')
    expect(done, 'the retry did not mark the event done').toBeTruthy()
  })

  it('counts the attempt when re-running a failed event', async () => {
    ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    priorEvent.mockResolvedValue({ data: { status: 'failed', attempts: 2 }, error: null })

    await post(subscriptionUpdated())

    const reclaim = opsOn('stripe_events').find(o => (o.payload as { attempts?: number })?.attempts !== undefined)
    expect((reclaim?.payload as { attempts: number }).attempts).toBe(3)
  })

  it('re-runs an event stuck in processing from a died-mid-handler attempt', async () => {
    // A process that crashed between claiming and completing leaves
    // 'processing'. Treating that as done would lose the work permanently.
    ledgerInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    priorEvent.mockResolvedValue({ data: { status: 'processing', attempts: 1 }, error: null })

    const res = await post(subscriptionUpdated())

    expect(res.status).toBe(200)
    expect(opsOn('subscriptions')).toHaveLength(1)
  })

  it('asks for a retry when the work succeeded but the ledger could not be finalised', async () => {
    // Answering 200 would strand the row in 'processing' forever. The retry is
    // safe: every write the handler performs is an upsert or ordering-guarded.
    ledgerUpdateResult.mockResolvedValue({ error: { message: 'write failed' } })

    const res = await post(subscriptionUpdated())
    expect(res.status).toBe(503)
  })

})

// ── Ordering ────────────────────────────────────────────────────────────────

describe('out-of-order delivery', () => {
  it('guards every subscription write on last_event_at', async () => {
    await post(subscriptionUpdated())
    const update = opsOn('subscriptions')[0]
    expect(update.kind).toBe('update')
    expect(update.filters.or).toContain('last_event_at.is.null')
    expect(update.filters.or).toContain('last_event_at.lte.')
  })

  it('stamps the write with Stripe\'s event time, not ours', async () => {
    // Using our own clock would make the ordering guard useless: two events
    // processed out of order would both look "newest".
    await post(subscriptionUpdated({}, 1_760_000_100))
    const update = opsOn('subscriptions')[0]
    expect((update.payload as { last_event_at: string }).last_event_at).toBe(
      new Date(1_760_000_100 * 1000).toISOString()
    )
  })

  it('treats a dropped stale update as success, not a delivery failure', async () => {
    // The guard matched no row because newer state is already there. Returning
    // non-2xx would make Stripe retry an event that must never be applied.
    updateResult.mockResolvedValue({ data: null, error: null })
    const res = await post(subscriptionUpdated())
    expect(res.status).toBe(200)
  })
})

// ── Plan state is derived from Stripe ───────────────────────────────────────

describe('plan derivation', () => {
  it('reads the plan from the price lookup_key, not from our metadata', async () => {
    // Checkout metadata is what WE sent at session creation, so it goes stale
    // the moment someone changes plan in the billing portal.
    await post(subscriptionUpdated())
    const update = opsOn('subscriptions')[0]
    expect((update.payload as { plan?: string }).plan).toBe('professional')
  })

  it('falls back to the price metadata tier when no lookup_key is set', async () => {
    await post(
      subscriptionUpdated({
        items: { data: [{ price: { metadata: { tier: 'team' } } }] },
      })
    )
    expect((opsOn('subscriptions')[0].payload as { plan?: string }).plan).toBe('team')
  })

  it('leaves the plan alone when the price says nothing recognisable', async () => {
    // Better to keep the last known good plan than to write a guess.
    await post(
      subscriptionUpdated({
        items: { data: [{ price: { lookup_key: 'legacy_grandfathered' } }] },
      })
    )
    expect((opsOn('subscriptions')[0].payload as { plan?: string }).plan).toBeUndefined()
  })

  it('drops to free on cancellation and records it once', async () => {
    await post(subscriptionDeleted)
    const update = opsOn('subscriptions')[0]
    expect(update.payload).toMatchObject({ status: 'canceled', plan: 'free' })
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('marks a failed payment past_due against the customer', async () => {
    await post({
      id: 'evt_failed_1',
      type: 'invoice.payment_failed',
      created: 1_760_000_300,
      data: { object: { customer: 'cus_123' } },
    })
    const update = opsOn('subscriptions')[0]
    expect(update.payload).toMatchObject({ status: 'past_due' })
    expect(update.filters.stripe_customer_id).toBe('cus_123')
  })
})

describe('malformed input', () => {
  it('400s a body that is not JSON without recording anything', async () => {
    const payload = 'not json'
    const res = await POST({
      text: async () => payload,
      headers: new Headers({ 'stripe-signature': await sign(payload) }),
    } as never)

    expect(res.status).toBe(400)
    expect(ops).toHaveLength(0)
  })

  it('400s a signed event with no id rather than 500ing into a Stripe retry loop', async () => {
    const res = await post({ type: 'checkout.session.completed', data: { object: {} } })
    expect(res.status).toBe(400)
  })
})


// ── A write that fails is not a write that succeeded ────────────────────────
//
// Stripe only redelivers what it is told to redeliver. Every case below used
// to be answered with a 200 and a log line, which is the same thing as losing
// the entitlement change permanently — the customer had already been charged.

describe('database failures are handed back to Stripe', () => {
  it('asks for a retry when the paid grant cannot be written', async () => {
    upsertResult.mockResolvedValue({ error: { message: 'connection reset' } })

    const res = await post(checkoutCompleted)

    expect(res.status).toBe(503)
    const ledger = opsOn('stripe_events').filter(o => o.kind === 'update')
    expect(ledger.at(-1)?.payload).toMatchObject({ status: 'failed' })
    // Nothing was tracked as a started subscription, because none started.
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('asks for a retry when a cancellation cannot be written', async () => {
    updateResult.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } })

    const res = await post(subscriptionDeleted)

    expect(res.status).toBe(503)
    expect(opsOn('stripe_events').filter(o => o.kind === 'update').at(-1)?.payload).toMatchObject({
      status: 'failed',
    })
  })

  it('still treats "no row matched" as a delivered event, not a failure', async () => {
    // A stale event dropped by the last_event_at guard, or a subscription this
    // deployment has never seen. Retrying would never make either succeed.
    updateResult.mockResolvedValue({ data: null, error: null })

    const res = await post(subscriptionDeleted)

    expect(res.status).toBe(200)
    expect(opsOn('stripe_events').filter(o => o.kind === 'update').at(-1)?.payload).toMatchObject({
      status: 'done',
    })
  })

  it('ignores a malformed user_id instead of retrying it forever', async () => {
    const res = await post({
      ...checkoutCompleted,
      id: 'evt_checkout_bad_id',
      data: {
        object: {
          ...checkoutCompleted.data.object,
          metadata: { user_id: 'not-a-uuid', plan: 'practitioner' },
        },
      },
    })

    expect(res.status).toBe(200)
    expect(opsOn('subscriptions')).toHaveLength(0)
    expect(opsOn('stripe_events').filter(o => o.kind === 'update').at(-1)?.payload).toMatchObject({
      status: 'done',
    })
  })
})
