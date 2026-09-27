import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ROOM_MODEL, DEBRIEF_MODEL, complete, consumeSseChunk, isConfigured, openCounterpartStream } from '@/lib/openrouter'

// What this file verifies, and what it does not.
//
// Every other test that touches the room mocks `openCounterpartStream`, which
// means `lib/openrouter.ts` itself — the only code that ever speaks to the
// provider — had never made an HTTP request under test. The request body it
// sends was unverified: a wrong field name would leave the whole suite green
// and fail on first contact with a real key.
//
// So these run the real client against a loopback server that answers in
// OpenRouter's wire format. Nothing leaves the machine and no key is needed;
// `fetch` is shimmed to rewrite the provider host to 127.0.0.1 and is otherwise
// untouched, so the request under assertion is the one the real code built.
//
// This proves OUR SIDE of the integration: what we send, and what we do with
// what comes back — including the retry, the timeout and the failure paths. It
// proves NOTHING about how a model behaves. The counterpart holding its mandate
// under pressure is a live-model question and is answered by `evals/run.ts`
// against a real key, not here.

const PROVIDER_URL = 'https://openrouter.ai/api/v1/chat/completions'

interface Received {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}

let server: Server
let origin: string
let received: Received[] = []
let handler: (req: IncomingMessage, res: ServerResponse, call: number) => void
const realFetch = globalThis.fetch

/** An OpenRouter-shaped SSE frame. */
function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function deltaFrame(content: string) {
  return sse({ choices: [{ delta: { content } }] })
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {},
      })
      handler(req, res, received.length)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`

  // The shim rewrites the host and nothing else, so method, headers, body and
  // signal all arrive exactly as lib/openrouter.ts constructed them.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return realFetch(url === PROVIDER_URL ? origin + '/api/v1/chat/completions' : url, init)
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
  received = []
  process.env.OPENROUTER_API_KEY = 'test-key-not-a-real-credential'
  handler = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  }
})

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
})

describe('model selection', () => {
  // Pins the defaults. A model slug that quietly goes stale is the kind of
  // thing nothing catches until a deploy returns 400 from the provider.
  it('defaults both models to a current, correctly namespaced slug', () => {
    expect(ROOM_MODEL).toBe('anthropic/claude-sonnet-5')
    expect(DEBRIEF_MODEL).toBe('anthropic/claude-sonnet-5')
  })
})

describe('configuration', () => {
  it('reports configured only when a key is present', () => {
    expect(isConfigured()).toBe(true)
    delete process.env.OPENROUTER_API_KEY
    expect(isConfigured()).toBe(false)
  })

  it('makes no request at all without a key', async () => {
    delete process.env.OPENROUTER_API_KEY
    expect(await openCounterpartStream([{ role: 'user', content: 'hello' }])).toBeNull()
    expect(await complete([{ role: 'user', content: 'hello' }])).toBeNull()
    expect(received).toHaveLength(0)
  })
})

describe('the counterpart stream request', () => {
  it('sends what OpenRouter needs to stream a counterpart turn', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(deltaFrame('Hello.') + 'data: [DONE]\n\n')
    }

    const res = await openCounterpartStream([
      { role: 'system', content: 'You are the counterpart.' },
      { role: 'user', content: 'Eight per cent.' },
    ])
    expect(res).not.toBeNull()

    expect(received).toHaveLength(1)
    const call = received[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe('/api/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer test-key-not-a-real-credential')
    expect(call.headers['content-type']).toContain('application/json')
    // OpenRouter attributes traffic by these two; without them the account's
    // dashboard cannot tell this app's usage from anything else.
    expect(call.headers['http-referer']).toBeTruthy()
    expect(call.headers['x-title']).toBe('Parley')

    expect(call.body).toMatchObject({
      model: ROOM_MODEL,
      stream: true,
      // Without include_usage the terminal frame carries no token count and
      // the room's accounting silently falls back to an estimate.
      stream_options: { include_usage: true },
      max_tokens: 500,
      provider: { sort: 'latency', allow_fallbacks: true },
    })
    expect(call.body.temperature).toBeGreaterThan(0.5)
    expect(call.body.messages).toEqual([
      { role: 'system', content: 'You are the counterpart.' },
      { role: 'user', content: 'Eight per cent.' },
    ])
  })

  it('reads a real streamed body back into text and a usage figure', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      // Deliberately written across frames that split mid-sentence, which is
      // what the provider actually does.
      res.write(deltaFrame('That is a long way '))
      res.write(deltaFrame('from where we are.'))
      res.write(sse({ choices: [{ delta: {} }], usage: { total_tokens: 187 } }))
      res.end('data: [DONE]\n\n')
    }

    const res = await openCounterpartStream([{ role: 'user', content: 'hi' }])
    expect(res?.body).toBeTruthy()

    const reader = res!.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let tokens = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer = consumeSseChunk(
        buffer + decoder.decode(value, { stream: true }),
        delta => { text += delta },
        n => { tokens = n }
      )
    }

    expect(text).toBe('That is a long way from where we are.')
    expect(tokens).toBe(187)
  })

  it('retries once on 429 and returns the second response', async () => {
    handler = (_req, res, call) => {
      if (call === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'rate limited' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(deltaFrame('Second time.') + 'data: [DONE]\n\n')
    }

    const res = await openCounterpartStream([{ role: 'user', content: 'hi' }])
    expect(res?.ok).toBe(true)
    expect(received).toHaveLength(2)
    // The retry must carry the same payload, not a degraded one.
    expect(received[1].body).toEqual(received[0].body)
  })

  it('gives up rather than looping when the rate limit does not clear', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limited' }))
    }

    expect(await openCounterpartStream([{ role: 'user', content: 'hi' }])).toBeNull()
    expect(received).toHaveLength(2)
  })

  it('returns null on a provider error instead of throwing into the route', async () => {
    handler = (_req, res) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream' }))
    }

    expect(await openCounterpartStream([{ role: 'user', content: 'hi' }])).toBeNull()
    expect(received).toHaveLength(1)
  })

  it('aborts when the caller aborts, so a closed tab stops costing tokens', async () => {
    handler = () => {
      // Never responds. The caller's signal is what has to end this.
    }

    const controller = new AbortController()
    const pending = openCounterpartStream([{ role: 'user', content: 'hi' }], controller.signal)
    controller.abort()
    expect(await pending).toBeNull()
  })

  it('abandons a connection that never answers', async () => {
    // The 4.5s wait is the point of the test: CONNECT_TIMEOUT_MS is what stops
    // a dead provider holding a room open indefinitely.
    handler = () => {}
    const started = Date.now()
    expect(await openCounterpartStream([{ role: 'user', content: 'hi' }])).toBeNull()
    const waited = Date.now() - started
    expect(waited).toBeGreaterThan(3_000)
    expect(waited).toBeLessThan(9_000)
  }, 15_000)
})

describe('the debrief completion request', () => {
  it('asks for JSON at a low temperature and without streaming', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"overallScore":74}' } }],
          usage: { total_tokens: 4210 },
        })
      )
    }

    const result = await complete([{ role: 'user', content: 'Score this transcript.' }])
    expect(result).toEqual({ content: '{"overallScore":74}', tokensUsed: 4210 })

    const call = received[0]
    expect(call.body).toMatchObject({
      model: DEBRIEF_MODEL,
      max_tokens: 2000,
      temperature: 0.2,
      provider: { sort: 'throughput', allow_fallbacks: true },
    })
    // Streaming a call whose output is parsed as JSON buys nothing and
    // complicates the failure path.
    expect(call.body.stream).toBeUndefined()
  })

  it('honours an explicit model and token ceiling', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    }

    await complete([{ role: 'user', content: 'x' }], {
      model: 'anthropic/claude-opus-5',
      maxTokens: 64,
      temperature: 0,
    })
    expect(received[0].body).toMatchObject({
      model: 'anthropic/claude-opus-5',
      max_tokens: 64,
      temperature: 0,
    })
  })

  it('reports no usage as zero rather than as undefined', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    }
    expect(await complete([{ role: 'user', content: 'x' }])).toEqual({ content: 'ok', tokensUsed: 0 })
  })

  it('treats an empty completion as a failure', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }))
    }
    expect(await complete([{ role: 'user', content: 'x' }])).toBeNull()
  })

  it('treats a malformed envelope as a failure rather than reading undefined', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ unexpected: true }))
    }
    expect(await complete([{ role: 'user', content: 'x' }])).toBeNull()
  })

  it('retries once on a rate limit and returns the second answer', async () => {
    // The debrief is the payoff for a rehearsal the user has already spent
    // fifteen minutes on. Giving up on the first 429 handed the recovery back
    // to them as a button, for a condition that usually clears immediately.
    handler = (_req, res, call) => {
      if (call === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'rate limited' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 12 } }))
    }

    const result = await complete([{ role: 'user', content: 'score this' }])
    expect(result).toEqual({ content: '{"ok":true}', tokensUsed: 12 })
    expect(received).toHaveLength(2)
    // The retry must carry the same payload, not a degraded one.
    expect(received[1].body).toEqual(received[0].body)
  })

  it('retries a provider fault too, since nothing was generated to pay for', async () => {
    handler = (_req, res, call) => {
      if (call === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'upstream unavailable' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
    }

    expect(await complete([{ role: 'user', content: 'score this' }])).not.toBeNull()
    expect(received).toHaveLength(2)
  })

  it('does not retry a request the provider refused on its merits', async () => {
    // A 400 says we sent something wrong. Sending it again produces the same
    // answer more slowly, and doubles the latency of a failure either way.
    handler = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad request' }))
    }

    expect(await complete([{ role: 'user', content: 'score this' }])).toBeNull()
    expect(received).toHaveLength(1)
  })

  it('gives up rather than looping when the rate limit does not clear', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limited' }))
    }

    expect(await complete([{ role: 'user', content: 'score this' }])).toBeNull()
    expect(received).toHaveLength(2)
  })

  it('returns null on a provider error', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'boom' }))
    }
    expect(await complete([{ role: 'user', content: 'x' }])).toBeNull()
  })
})
