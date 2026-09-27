import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeSseChunk } from '@/lib/openrouter'

// The room streams token by token, which means every failure mode is a partial
// one: a model that stops halfway, a user who closes the tab, a connection that
// dies. The rule these tests protect is that the transcript must never be left
// with a user turn and no answer to it — the debrief would score a conversation
// where the counterpart never spoke.

const scenario = { slug: 'renewal-uplift' }
const USER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/ownership', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ownership')>()
  return {
    ...actual,
    verifyOwnership: vi.fn(async () => ({ ok: true as const, authenticated: true })),
    clientIp: () => 'stream-test-ip',
  }
})

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(async () => {}) }))

// The real output patterns, in an array the tests can add one sentinel to.
//
// The pattern list itself is child-safety and sexual-content matching; what is
// under test here is what the RELAY does once one of them fires, which is a
// different question and does not need any of that text in this file. The
// reference never changes, so the route — which iterates the imported binding
// on every read — sees the addition.
const outputPatterns = vi.hoisted(() => [] as RegExp[])
const BLOCK_SENTINEL = /TRIPS_THE_OUTPUT_FILTER/

vi.mock('@/lib/safety', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/safety')>()
  outputPatterns.push(...actual.OUTPUT_BLOCK_PATTERNS)
  return {
    ...actual,
    checkSafety: vi.fn(async () => ({ safe: true })),
    OUTPUT_BLOCK_PATTERNS: outputPatterns,
  }
})

const appendTurn = vi.hoisted(() =>
  vi.fn<(rehearsalId: string, side: 'you' | 'counterpart', content: string, position: number) => Promise<boolean>>(
    async () => true
  )
)
const loadRehearsal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rehearsals', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rehearsals')>()
  return {
    ...actual,
    appendTurn,
    loadRehearsal,
    getUserPlan: vi.fn(async () => 'free' as const),
  }
})

const recordTokenUsage = vi.hoisted(() =>
  vi.fn<(userId: string, plan: string, tokens: number) => Promise<void>>(async () => {})
)
vi.mock('@/lib/usageLimits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/usageLimits')>()
  return {
    ...actual,
    recordTokenUsage,
    isOverDailyBudget: vi.fn(async () => false),
  }
})

const openCounterpartStream = vi.hoisted(() => vi.fn())
vi.mock('@/lib/openrouter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/openrouter')>()
  return { ...actual, openCounterpartStream }
})

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self, insert: self, update: self, maybeSingle: async () => ({ data: null, error: null }),
  })
  return { supabaseServer: chain }
})

/** Builds an SSE body from content deltas, as OpenRouter sends them. */
function sseBody(deltas: string[], opts: { stallAfter?: number; usage?: number } = {}) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encode = (o: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(o)}\n\n`))
      for (let i = 0; i < deltas.length; i++) {
        encode({ choices: [{ delta: { content: deltas[i] } }] })
        if (opts.stallAfter !== undefined && i === opts.stallAfter) {
          // Never closes: simulates a model that stops sending mid-reply.
          return
        }
      }
      if (opts.usage) encode({ usage: { total_tokens: opts.usage } })
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

function turnRequest(message = 'What else is available besides the money?') {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ rehearsalId: 'r1', userId: USER, message }),
    cookies: { get: () => undefined },
  } as never
}

/** Drains an SSE response into its parsed events. */
async function drain(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Record<string, unknown>[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try { events.push(JSON.parse(line.slice(6))) } catch { /* partial */ }
    }
  }
  return events
}

const liveRehearsal = {
  rehearsal: {
    id: 'r1', userId: USER, scenarioSlug: scenario.slug, scenarioTitle: 'T',
    counterpartId: 'deflector', status: 'live' as const, endReason: null,
    startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0,
    turnCount: 2, overallScore: null,
  },
  counterpart: { id: 'deflector', name: 'The Deflector', role: 'Manager', disposition: 'Warm', tactics: [], tell: '', builtIn: true },
  turns: [
    { id: 't0', rehearsalId: 'r1', side: 'counterpart' as const, content: 'Thanks for making the time.', position: 0, createdAt: '' },
    { id: 't1', rehearsalId: 'r1', side: 'you' as const, content: 'Thanks for seeing me.', position: 1, createdAt: '' },
  ],
}

beforeEach(async () => {
  appendTurn.mockReset()
  appendTurn.mockResolvedValue(true)
  loadRehearsal.mockReset()
  recordTokenUsage.mockReset()
  openCounterpartStream.mockReset()

  const { getScenario } = await import('@/lib/negotiation/scenarios')
  loadRehearsal.mockResolvedValue({ ...liveRehearsal, scenario: getScenario(scenario.slug) })
})

describe('a healthy stream', () => {
  it('streams chunks and persists the finished turn', async () => {
    openCounterpartStream.mockResolvedValue(
      new Response(sseBody(['I hear you. ', 'The cycle is paused, ', 'as you know.'], { usage: 240 }))
    )
    const { POST } = await import('@/app/api/rehearsal/route')
    const events = await drain(await POST(turnRequest()))

    const final = events.find(e => e.done)
    expect(final?.fullReply).toBe('I hear you. The cycle is paused, as you know.')
    expect(final?.truncated).toBe(false)

    // The user's turn and the counterpart's, in that order.
    expect(appendTurn).toHaveBeenCalledTimes(2)
    expect(appendTurn.mock.calls[0][1]).toBe('you')
    expect(appendTurn.mock.calls[1][1]).toBe('counterpart')
    expect(recordTokenUsage).toHaveBeenCalledWith(USER, 'free', 240)
  })

  it('still streams a long reply progressively while holding back the tail the leak guard has not judged', async () => {
    // The relay withholds the last few words until the guard can see a whole
    // phrase. That must delay the stream by a few words, not turn it into one
    // block at the end.
    const sentence = 'We have looked at the numbers again and there is some movement on term length. '
    const deltas = sentence.repeat(3).split(' ').filter(Boolean).map(w => w + ' ')
    openCounterpartStream.mockResolvedValue(new Response(sseBody(deltas, { usage: 300 })))
    const { POST } = await import('@/app/api/rehearsal/route')
    const events = await drain(await POST(turnRequest()))

    const chunks = events.filter(e => !e.done && e.chunk).map(e => String(e.chunk))
    const final = events.find(e => e.done)
    expect(chunks.length).toBeGreaterThan(5)
    const streamed = chunks.join('')
    expect(String(final?.fullReply).startsWith(streamed.trim().slice(0, 40))).toBe(true)
    // The tail arrives with the final frame.
    expect(String(final?.fullReply).length).toBeGreaterThan(streamed.trim().length)
  })

  it('falls back to an estimate when the provider reports no usage', async () => {
    openCounterpartStream.mockResolvedValue(new Response(sseBody(['Short answer.'])))
    const { POST } = await import('@/app/api/rehearsal/route')
    await drain(await POST(turnRequest()))

    // Cost tracking must not silently record zero for a turn that cost money.
    expect(recordTokenUsage.mock.calls[0][2]).toBeGreaterThan(0)
  })
})

describe('a stream that stops mid-reply', () => {
  it('keeps what arrived and marks the turn truncated', async () => {
    // Three sentences already delivered. Throwing them away because the fourth
    // never came would be worse for the transcript than an abrupt ending —
    // which is a thing real counterparts do anyway.
    openCounterpartStream.mockResolvedValue(
      new Response(
        sseBody(
          ['I have seen the announcement. ', 'The merit cycle is paused for everyone. ', 'I did not choose that, and'],
          { stallAfter: 2 }
        )
      )
    )
    const { POST } = await import('@/app/api/rehearsal/route')

    let events: Record<string, unknown>[]
    vi.useFakeTimers()
    try {
      const resPromise = POST(turnRequest())
      // Push past the idle timeout without waiting in real time.
      await vi.advanceTimersByTimeAsync(21_000)
      events = await drain(await resPromise)
    } finally {
      vi.useRealTimers()
    }

    const final = events.find(e => e.done)
    expect(final?.truncated).toBe(true)
    expect(String(final?.fullReply)).toContain('merit cycle is paused')

    // The counterpart turn is still written: the user's turn already exists,
    // and a transcript with a question and no answer would be scored as one.
    const counterpartWrite = appendTurn.mock.calls.find(c => c[1] === 'counterpart')
    expect(counterpartWrite).toBeTruthy()
    expect(String(counterpartWrite?.[2])).toContain('merit cycle is paused')
  })

  it('substitutes a line when almost nothing arrived', async () => {
    openCounterpartStream.mockResolvedValue(new Response(sseBody(['Well'], { stallAfter: 0 })))
    const { POST } = await import('@/app/api/rehearsal/route')

    vi.useFakeTimers()
    try {
      const resPromise = POST(turnRequest())
      await vi.advanceTimersByTimeAsync(21_000)
      await drain(await resPromise)
    } finally {
      vi.useRealTimers()
    }

    const counterpartWrite = appendTurn.mock.calls.find(c => c[1] === 'counterpart')
    expect(counterpartWrite, 'no counterpart turn was written at all').toBeTruthy()
    expect(String(counterpartWrite?.[2]).length).toBeGreaterThan(0)
  })
})

describe('a reply the output filter refuses', () => {
  beforeEach(() => {
    outputPatterns.push(BLOCK_SENTINEL)
  })
  afterEach(() => {
    const at = outputPatterns.indexOf(BLOCK_SENTINEL)
    if (at !== -1) outputPatterns.splice(at, 1)
  })

  it('substitutes a turn, says so, and still charges what the provider generated', async () => {
    openCounterpartStream.mockResolvedValue(
      new Response(sseBody(['Sure. ', 'TRIPS_THE_OUTPUT_FILTER here.'], { usage: 310 }))
    )
    const { POST } = await import('@/app/api/rehearsal/route')
    const events = await drain(await POST(turnRequest()))

    const final = events.find(e => e.done)
    expect(final?.filtered).toBe(true)
    expect(final?.fullReply).toBe('Let us keep this to the matter at hand.')

    // The transcript is never left lopsided: a counterpart turn exists either way.
    expect(appendTurn).toHaveBeenCalledTimes(2)
    expect(appendTurn.mock.calls[1][2]).toBe('Let us keep this to the matter at hand.')

    // The reply was discarded but the provider still generated it. A daily cost
    // ceiling that ignores the one path someone can trip on purpose is not a
    // ceiling — this used to record nothing at all.
    //
    // The figure is an estimate rather than the provider's 310: blocking cuts
    // the read loop, so the usage frame that closes an OpenRouter stream never
    // arrives, so the estimate covers the prompt that was sent as well as the
    // text that came back — the prompt alone is thousands of tokens.
    expect(recordTokenUsage).toHaveBeenCalledTimes(1)
    expect(recordTokenUsage.mock.calls[0][0]).toBe(USER)
    expect(recordTokenUsage.mock.calls[0][2]).toBeGreaterThan(310)
  })
})

describe('a client that disconnects', () => {
  it('aborts the upstream call instead of generating into a closed socket', async () => {
    // Cost, not tidiness: the provider call used to run to completion and we
    // paid for tokens nobody would ever read.
    let signal: AbortSignal | undefined
    openCounterpartStream.mockImplementation(async (_msgs: unknown, s: AbortSignal) => {
      signal = s
      return new Response(sseBody(['One. ', 'Two. ', 'Three. ', 'Four.']))
    })

    const { POST } = await import('@/app/api/rehearsal/route')
    const res = await POST(turnRequest())

    // Read one chunk, then walk away.
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()

    await new Promise(r => setTimeout(r, 20))
    expect(signal?.aborted, 'upstream was not aborted on disconnect').toBe(true)
  })

  it('charges the prompt it sent, not only the words that came back', async () => {
    // The usage frame closes the stream, so a turn aborted after its first
    // token never reports usage. Charging only the output made "open a turn,
    // walk away" the cheap way to spend: one word recorded against a prompt of
    // thousands of tokens.
    let promptChars = 0
    openCounterpartStream.mockImplementation(async (msgs: { content: string }[]) => {
      promptChars = msgs.reduce((n, m) => n + m.content.length, 0)
      return new Response(sseBody(['One. ', 'Two. ', 'Three. ', 'Four.']))
    })

    const { POST } = await import('@/app/api/rehearsal/route')
    const res = await POST(turnRequest())
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(recordTokenUsage).toHaveBeenCalledTimes(1))

    const charged = recordTokenUsage.mock.calls[0][2]
    expect(promptChars).toBeGreaterThan(1000)
    expect(charged).toBeGreaterThanOrEqual(Math.floor(promptChars / 4))
  })
})

describe('the turn is refused before any generation', () => {
  it('does not call the model when the rehearsal is not live', async () => {
    loadRehearsal.mockResolvedValue({
      ...liveRehearsal,
      rehearsal: { ...liveRehearsal.rehearsal, status: 'debriefed' as const },
      scenario: (await import('@/lib/negotiation/scenarios')).getScenario(scenario.slug),
    })
    const { POST } = await import('@/app/api/rehearsal/route')
    const res = await POST(turnRequest())

    expect(res.status).toBe(409)
    expect(openCounterpartStream).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it('does not call the model against a counterpart that has since been deleted', async () => {
    // lib/rehearsals serves a rehearsal whose custom counterpart is gone under
    // a flagged stand-in with no disposition. Generating from that would put
    // words in the mouth of someone the user described and then removed.
    loadRehearsal.mockResolvedValue({
      ...liveRehearsal,
      counterpart: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Counterpart no longer on file',
        role: '', disposition: '', tactics: [], tell: '', builtIn: false, retired: true,
      },
      scenario: (await import('@/lib/negotiation/scenarios')).getScenario(scenario.slug),
    })
    const { POST } = await import('@/app/api/rehearsal/route')
    const res = await POST(turnRequest())

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('counterpart_retired')
    expect(openCounterpartStream).not.toHaveBeenCalled()
    expect(appendTurn).not.toHaveBeenCalled()
  })

  it('does not call the model when the user turn cannot be saved', async () => {
    // Generating a reply to a turn that is not in the transcript would produce
    // a counterpart answering a question nobody can see.
    appendTurn.mockResolvedValue(false)
    const { POST } = await import('@/app/api/rehearsal/route')
    const res = await POST(turnRequest())

    expect(res.status).toBe(503)
    expect(openCounterpartStream).not.toHaveBeenCalled()
  })
})

// ── The SSE parser itself ───────────────────────────────────────────────────

describe('consumeSseChunk', () => {
  it('returns the trailing partial line for the next read', () => {
    const deltas: string[] = []
    const remainder = consumeSseChunk(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\ndata: {"choices":[{"del',
      d => deltas.push(d),
      () => {}
    )
    expect(deltas).toEqual(['Hello'])
    expect(remainder).toBe('data: {"choices":[{"del')
  })

  it('ignores [DONE] and malformed frames without throwing', () => {
    const deltas: string[] = []
    consumeSseChunk('data: [DONE]\ndata: not json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n', d => deltas.push(d), () => {})
    expect(deltas).toEqual(['ok'])
  })

  it('captures the usage figure from the terminal frame', () => {
    let tokens = 0
    consumeSseChunk('data: {"usage":{"total_tokens":512}}\n', () => {}, t => { tokens = t })
    expect(tokens).toBe(512)
  })
})
