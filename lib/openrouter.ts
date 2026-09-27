import 'server-only' // a client import of the provider key is a build error

// Shared OpenRouter client.
//
// Two callers with genuinely different needs sit on top of this:
//
//   The ROOM streams. Time-to-first-token is the thing that matters — a
//   counterpart that pauses four seconds before answering breaks the pressure
//   the rehearsal depends on.
//
//   The DEBRIEF does not stream. It is a single analytical call that must
//   return parseable JSON, so it runs at a low temperature, with a long
//   timeout, and its output is validated before anything is persisted.
//
// The connect-timeout-and-retry handling here is carried over from a prior
// codebase where it was tuned against live traffic; the reasoning held up and
// is preserved rather than re-derived.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Counterpart model. Needs to hold a role and improvise under pressure. */
export const ROOM_MODEL = process.env.OPENROUTER_ROOM_MODEL || 'anthropic/claude-sonnet-5'

/** Debrief model. Needs instruction-following and clean JSON over flair. */
export const DEBRIEF_MODEL = process.env.OPENROUTER_DEBRIEF_MODEL || 'anthropic/claude-sonnet-5'

// Bounds the CONNECTION phase only — DNS/TLS/routing up to response headers.
// Long enough that a healthy connection never trips it, short enough to leave
// room for a retry inside a reasonable total wait.
const CONNECT_TIMEOUT_MS = 4500

// The debrief reads a full transcript and returns structured JSON, so it is
// allowed to take its time. Note this bounds the WHOLE call, not just the
// connection phase — there is no stream to go idle, so a completion that never
// arrives is caught here and nowhere else.
const DEBRIEF_TIMEOUT_MS = 60_000

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // The caller's signal is combined rather than replacing the timeout: the room
  // needs to abort a stream when the user closes the tab, and the connect
  // timeout still has to apply until then.
  const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal
  try {
    return await fetch(url, { ...init, signal })
  } finally {
    clearTimeout(timer)
  }
}

function baseHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    'X-Title': 'Parley',
  }
}

export function isConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

/**
 * Opens a streaming counterpart completion. Returns the raw Response so the
 * caller can relay the SSE body directly, running safety checks against the
 * accumulated text as it arrives rather than buffering the whole reply first.
 * Returns null on any failure — the caller surfaces that as a room error.
 *
 * `signal` lets the caller abort the whole thing. That matters for cost as much
 * as for tidiness: without it, a user closing the tab mid-turn left this
 * request running to completion against the provider, and we paid for tokens
 * nobody would ever read.
 */
export async function openCounterpartStream(
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<Response | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('[OpenRouter] OPENROUTER_API_KEY is not configured')
    return null
  }

  const init: RequestInit = {
    method: 'POST',
    headers: baseHeaders(apiKey),
    body: JSON.stringify({
      model: ROOM_MODEL,
      messages,
      // A counterpart turn is dialogue, not an essay. The cap is a backstop
      // against a model that starts monologuing; the prompt asks for two to
      // five sentences and that is what normally lands.
      max_tokens: 500,
      // High enough that repeated runs of the same scenario diverge — which
      // matters, because re-rehearsing is the core loop and an identical
      // counterpart the second time teaches nothing.
      temperature: 0.85,
      stream: true,
      stream_options: { include_usage: true },
      // 'latency' rather than 'throughput': these are short completions where
      // time-to-first-token dominates the felt experience.
      provider: { sort: 'latency', allow_fallbacks: true },
    }),
  }

  try {
    let res = await fetchWithTimeout(OPENROUTER_URL, init, CONNECT_TIMEOUT_MS, signal)
    if (res.status === 429 && !signal?.aborted) {
      console.warn('[OpenRouter] 429 on room stream — retrying once after 1s')
      await new Promise(resolve => setTimeout(resolve, 1000))
      res = await fetchWithTimeout(OPENROUTER_URL, init, CONNECT_TIMEOUT_MS, signal)
    }
    if (!res.ok) {
      console.error('[OpenRouter] Room stream error:', res.status, (await res.text()).slice(0, 200))
      return null
    }
    if (!res.body) {
      console.error('[OpenRouter] Room stream response had no body')
      return null
    }
    return res
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`[OpenRouter] Connection phase exceeded ${CONNECT_TIMEOUT_MS}ms`)
    } else {
      console.error('[OpenRouter] Room stream request failed:', e)
    }
    return null
  }
}

export interface CompletionResult {
  content: string
  tokensUsed: number
}

/**
 * Whether a failed completion is worth sending again.
 *
 * A 429 or a 5xx means the provider did not generate anything, so a retry
 * costs nothing beyond the wait. A 4xx means we sent something wrong, and
 * sending it again would produce the same answer more slowly.
 */
function worthRetrying(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * Non-streaming completion, used by the debrief. Low temperature because the
 * output is parsed as JSON and creativity here is purely a liability.
 *
 * Retried once on a rate limit or a provider fault, mirroring the room's
 * stream. The debrief is the whole payoff of a rehearsal someone has just spent
 * fifteen minutes on, and it used to be given up on after a single 429 — which
 * put the recovery on the user, as a "try generating it again" button on an
 * error screen, for a condition that usually clears in under a second.
 */
export async function complete(
  messages: ChatMessage[],
  options: { model?: string; maxTokens?: number; temperature?: number } = {}
): Promise<CompletionResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('[OpenRouter] OPENROUTER_API_KEY is not configured')
    return null
  }

  try {
    const init: RequestInit = {
      method: 'POST',
      headers: baseHeaders(apiKey),
      body: JSON.stringify({
        model: options.model || DEBRIEF_MODEL,
        messages,
        max_tokens: options.maxTokens ?? 2000,
        temperature: options.temperature ?? 0.2,
        provider: { sort: 'throughput', allow_fallbacks: true },
      }),
    }

    let res = await fetchWithTimeout(OPENROUTER_URL, init, DEBRIEF_TIMEOUT_MS)
    if (!res.ok && worthRetrying(res.status)) {
      console.warn('[OpenRouter] Completion got', res.status, '— retrying once after 1s')
      await new Promise(resolve => setTimeout(resolve, 1000))
      res = await fetchWithTimeout(OPENROUTER_URL, init, DEBRIEF_TIMEOUT_MS)
    }

    if (!res.ok) {
      console.error('[OpenRouter] Completion error:', res.status, (await res.text()).slice(0, 200))
      return null
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      console.error('[OpenRouter] Completion returned no content')
      return null
    }
    return { content, tokensUsed: json.usage?.total_tokens ?? 0 }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.error(`[OpenRouter] Completion exceeded ${DEBRIEF_TIMEOUT_MS}ms`)
    } else {
      console.error('[OpenRouter] Completion request failed:', e)
    }
    return null
  }
}

/**
 * Parses one chunk of an OpenRouter SSE body, appending any content deltas and
 * capturing the usage figure from the terminal event. Returns the leftover
 * partial line for the next read.
 */
export function consumeSseChunk(
  buffer: string,
  onDelta: (text: string) => void,
  onUsage: (tokens: number) => void
): string {
  const lines = buffer.split('\n')
  const remainder = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') continue
    let evt: { choices?: { delta?: { content?: string } }[]; usage?: { total_tokens?: number } }
    try {
      evt = JSON.parse(data)
    } catch {
      continue
    }
    const delta = evt.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta) onDelta(delta)
    if (evt.usage?.total_tokens) onUsage(evt.usage.total_tokens)
  }
  return remainder
}
