import { NextRequest, NextResponse } from 'next/server'
import { checkSafety, OUTPUT_BLOCK_PATTERNS } from '@/lib/safety'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { appendTurn, getUserPlan, loadRehearsal } from '@/lib/rehearsals'
import { acceptsTurns } from '@/lib/negotiation/lifecycle'
import { buildCounterpartPrompt, buildMessageHistory } from '@/lib/negotiation/prompt'
import { createLeakDetector, LEAK_DEFLECTION, STREAM_HOLDBACK_WORDS, type LeakDetector } from '@/lib/negotiation/leakGuard'
import { consumeSseChunk, openCounterpartStream, type ChatMessage } from '@/lib/openrouter'
import {
  isOverDailyBudget,
  isOverGlobalBudget,
  recordTokenUsage,
  estimateTokens,
  DAILY_CAP_MESSAGE,
  GLOBAL_CAP_MESSAGE,
} from '@/lib/usageLimits'
import { trackEvent } from '@/lib/analytics'

// One turn of a live rehearsal: the user speaks, the counterpart answers.
//
// Streams token by token because the room is under a clock and a four-second
// pause before a reply changes how people negotiate. Safety runs against the
// ACCUMULATED text on every read rather than only at the end, so a blocked
// reply is cut mid-stream instead of arriving whole.

const MAX_MESSAGE_LENGTH = 4000

// Above this the counterpart starts closing regardless of the clock. A
// rehearsal that runs to sixty turns has stopped being a negotiation and
// become a chat, which is the exact failure mode this product exists to avoid.
const MAX_TURNS = 60

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  const ip = clientIp(req)
  const rl = checkRateLimit(`rehearsal:${ip}`, 40, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Give it a moment.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  let body: { rehearsalId?: string; userId?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { rehearsalId, userId, message } = body

  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Say something first.' }, { status: 400 })
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'That turn is too long for one exchange.' }, { status: 400 })
  }
  if (typeof rehearsalId !== 'string' || !rehearsalId) {
    return NextResponse.json({ error: 'rehearsalId is required.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const uid = userId as string

  const loaded = await loadRehearsal(rehearsalId, uid)
  if (!loaded) {
    return NextResponse.json({ error: 'Rehearsal not found.' }, { status: 404 })
  }
  const { rehearsal, scenario, counterpart, turns } = loaded

  // Only a live rehearsal takes turns. A draft has no opening line yet, and
  // everything else has stopped — including 'debriefed', where a new turn
  // would invalidate a score that has already been shown to the user.
  if (!acceptsTurns(rehearsal.status)) {
    return NextResponse.json(
      { error: 'This rehearsal has already ended.', code: 'not_live', status: rehearsal.status },
      { status: 409 }
    )
  }
  if (turns.length >= MAX_TURNS) {
    return NextResponse.json(
      { error: 'This rehearsal has run its length. End it to see your debrief.' },
      { status: 409 }
    )
  }
  // A custom counterpart deleted mid-rehearsal. There is no disposition left
  // to build a prompt from, and inventing one would put words in the mouth of
  // someone the user described. The transcript so far still scores.
  if (counterpart.retired) {
    return NextResponse.json(
      {
        error: 'The counterpart you were rehearsing against has been deleted. End the rehearsal to read your debrief.',
        code: 'counterpart_retired',
      },
      { status: 409 }
    )
  }

  // ── Safety on the way in ─────────────────────────────────────────────────
  const safety = await checkSafety(message, `rehearsal:${scenario.slug}`, uid)
  if (!safety.safe) {
    return NextResponse.json(
      { error: safety.refusal, category: safety.category },
      { status: safety.criticalViolation ? 451 : 400 }
    )
  }

  const plan = await getUserPlan(uid)
  if (await isOverDailyBudget(uid, plan)) {
    return NextResponse.json({ error: DAILY_CAP_MESSAGE, code: 'daily_cap' }, { status: 429 })
  }
  if (await isOverGlobalBudget()) {
    return NextResponse.json({ error: GLOBAL_CAP_MESSAGE, code: 'global_cap' }, { status: 429 })
  }

  // Persist the user's turn before generating. If generation fails they should
  // still see what they said rather than losing the turn entirely.
  //
  // A failure here used to be logged and ignored, which meant a turn could
  // vanish from the transcript while the counterpart still answered it — and
  // the debrief would then score a conversation that never happened. It is now
  // fatal to the request.
  const userPosition = turns.length
  const saved = await appendTurn(rehearsalId, 'you', message.trim(), userPosition)
  if (!saved) {
    return NextResponse.json(
      { error: 'That turn could not be saved. Say it again — nothing was lost on their side.' },
      { status: 503 }
    )
  }

  const elapsedMinutes = Math.max(
    0,
    (Date.now() - new Date(rehearsal.startedAt).getTime()) / 60_000
  )
  const userTurnCount = turns.filter(t => t.side === 'you').length + 1

  let systemPrompt = buildCounterpartPrompt({
    scenario,
    counterpart,
    elapsedMinutes,
    userTurnCount,
  })

  // Someone disclosing real distress mid-rehearsal gets met, not negotiated
  // with. The counterpart drops the pressure and the room surfaces resources
  // alongside the reply.
  if (safety.selfHarmDetected) {
    systemPrompt += `\n\nIMPORTANT — OVERRIDE: the person has just said something suggesting they are genuinely struggling, outside the fiction of this negotiation. Stop negotiating. Step out of the pressure entirely, respond as one decent human being to another, briefly and without performing concern, and do not return to the scenario unless they clearly take it back there themselves.`
  }
  if (safety.violenceMentionDetected) {
    systemPrompt += `\n\nIMPORTANT — OVERRIDE: the person has expressed anger about hurting someone. Do not escalate, do not mirror it, and do not treat it as a negotiating position. Acknowledge the frustration plainly and bring the conversation back to what they actually want out of this situation.`
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...buildMessageHistory(turns),
    { role: 'user', content: message.trim() },
  ]

  // Owned by the relay below, which aborts it when the client disconnects or a
  // timeout fires. Without this the provider call outlives the request and we
  // pay for tokens nobody will read.
  const abort = new AbortController()

  const upstream = await openCounterpartStream(messages, abort.signal)
  if (!upstream) {
    return NextResponse.json(
      { error: 'The counterpart could not be reached. Your turn was saved — try sending it again.' },
      { status: 503 }
    )
  }

  await trackEvent(
    { name: 'rehearsal_turn', properties: { scenario: scenario.slug, counterpart: counterpart.id, plan } },
    uid
  )

  return relayCounterpartStream({
    upstream,
    abort,
    // Bound to this scenario's secret. The prompt asks the counterpart not to
    // disclose; this is what makes it so.
    detectLeak: createLeakDetector(scenario),
    userId: uid,
    plan,
    rehearsalId,
    counterpartPosition: userPosition + 1,
    promptTokenEstimate: estimateTokens(messages.map(m => m.content).join('\n')),
    emergencyResources: safety.selfHarmDetected ? safety.emergencyResources ?? null : null,
  })
}

// Strips stage directions the model occasionally reaches for despite the
// prompt ("*leans back*", "[pauses]"). A counterpart who narrates their own
// body language reads as fiction, and the whole point is that this feels like
// a call. Applied to the accumulated text on every read, so it is stable
// rather than flickering as tokens arrive.
function cleanTurn(text: string): string {
  return text
    .replace(/\*[^*\n]{1,120}\*/g, '')
    .replace(/\[[^\]\n]{1,120}\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Emits only up to the last sentence boundary while a stream is still open.
 * Without this the client sees half-formed words from a partial cleanup
 * pattern — an unclosed asterisk, for instance, would flash the raw stage
 * direction before the closing one arrived and removed it.
 */
function safeCutoff(cleaned: string): number {
  const openAsterisk = cleaned.lastIndexOf('*')
  const openBracket = cleaned.lastIndexOf('[')
  let cutoff = cleaned.length
  if (openAsterisk !== -1) cutoff = Math.min(cutoff, openAsterisk)
  if (openBracket !== -1) cutoff = Math.min(cutoff, openBracket)
  return Math.max(0, cutoff)
}

/**
 * The end of the text that is safe to emit while the stream is still open:
 * everything except the last STREAM_HOLDBACK_WORDS words, so the leak guard
 * sees the whole of any phrase before any of it reaches the client. Words are
 * whitespace-separated here, which is never more than the guard's own count
 * (it also splits on punctuation), so this errs towards holding back more.
 */
function holdbackCutoff(cleaned: string): number {
  const starts = [...cleaned.matchAll(/\S+/g)].map(m => m.index ?? 0)
  if (starts.length <= STREAM_HOLDBACK_WORDS) return 0
  return starts[starts.length - STREAM_HOLDBACK_WORDS]
}

interface RelayParams {
  upstream: Response
  /** Aborts the upstream provider call. Fired on disconnect and on timeout. */
  abort: AbortController
  /** Server-side check that the reply is not disclosing the mandate or prompt. */
  detectLeak: LeakDetector
  userId: string
  plan: Parameters<typeof recordTokenUsage>[1]
  rehearsalId: string
  counterpartPosition: number
  /**
   * What the prompt cost to send, estimated. The provider bills the whole
   * prompt the moment the call starts, but reports usage only in the stream's
   * final frame, so any stream cut short (a closed tab, a timeout, a block)
   * arrives with no usage figure. Charging only the characters that came back
   * made that the cheap way to spend: open a turn, abort after one token, and
   * the ceiling recorded a handful of tokens for a ~15k-token prompt.
   */
  promptTokenEstimate: number
  emergencyResources: string | null
}

// A model that stops sending mid-reply used to hang the room forever: the
// connect timeout in lib/openrouter only bounds the phase up to response
// headers, and nothing bounded the body. These two do.
//
// The idle timeout is the one that matters — a healthy stream emits tokens
// continuously, so twenty seconds of silence means it is not coming back. The
// total cap is a backstop against a stream that dribbles indefinitely.
const STREAM_IDLE_TIMEOUT_MS = 20_000
const STREAM_TOTAL_TIMEOUT_MS = 120_000

function relayCounterpartStream(params: RelayParams): Response {
  const { upstream, abort, detectLeak, userId, plan, rehearsalId, counterpartPosition, promptTokenEstimate, emergencyResources } = params
  // The provider's own figure when the stream got far enough to send it,
  // otherwise the prompt plus whatever came back.
  const charge = (reportedTokens: number, output: string) =>
    reportedTokens || promptTokenEstimate + estimateTokens(output)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = upstream.body!.getReader()

  // Set by the stream's cancel(), which fires when the client goes away.
  let clientGone = false

  return new Response(
    new ReadableStream({
      async start(controller) {
        let sseBuffer = ''
        let raw = ''
        let emitted = 0
        let tokensUsed = 0
        let blocked = false
        // Distinguished from `blocked` because the two need different replies:
        // a safety block says so plainly, while a leak must be indistinguishable
        // from the counterpart simply declining. Telling someone their
        // injection tripped a filter confirms there is something to find.
        let leaked = false
        // Why the stream stopped. Separate booleans rather than one union,
        // because they are set inside timer callbacks and TypeScript cannot
        // narrow a union across those — and a flag that lies about why a reply
        // was cut short would show the user the wrong message.
        let timedOut = false
        let errored = false

        // Enqueueing on a closed controller throws, and after a disconnect that
        // is the normal case rather than an exception worth propagating.
        const send = (payload: Record<string, unknown>) => {
          if (clientGone) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          } catch {
            clientGone = true
          }
        }

        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          try { controller.close() } catch { /* already closed */ }
        }

        // Output safety is checked against everything accumulated so far, on
        // every read. A block can only ever leak the single delta that
        // completed the pattern — inherent to true token streaming, and the
        // trade accepted here for a room that feels live.
        const process = (): boolean => {
          if (!blocked) {
            for (const pattern of OUTPUT_BLOCK_PATTERNS) {
              if (pattern.test(raw)) {
                blocked = true
                break
              }
            }
          }
          if (blocked) return false

          // Checked against the ACCUMULATED reply on every read, like the safety
          // filter, so a disclosure is cut mid-sentence instead of arriving
          // whole. A phrase is only detectable once its last word arrives, so
          // the emission below always holds back the trailing words the guard
          // has not yet been able to judge: nothing of a recited mandate is
          // sent before the check that stops it. See STREAM_HOLDBACK_WORDS.
          if (!leaked) {
            const verdict = detectLeak(raw)
            if (verdict.leaked) {
              leaked = true
              console.error('[Rehearsal] Mandate/prompt disclosure blocked:', verdict.reason)
              return false
            }
          }

          const cleaned = cleanTurn(raw)
          const cutoff = Math.min(safeCutoff(cleaned), holdbackCutoff(cleaned))
          if (cutoff > emitted) {
            const chunk = cleaned.slice(emitted, cutoff)
            if (chunk) {
              send({ chunk, done: false })
              emitted = cutoff
            }
          }
          return true
        }

        const totalTimer = setTimeout(() => {
          timedOut = true
          console.warn('[Rehearsal] Stream exceeded the total cap; cutting it off.')
          abort.abort()
        }, STREAM_TOTAL_TIMEOUT_MS)

        let idleTimer: ReturnType<typeof setTimeout> | undefined
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            timedOut = true
            console.warn('[Rehearsal] Stream went idle mid-reply; cutting it off.')
            abort.abort()
          }, STREAM_IDLE_TIMEOUT_MS)
        }
        resetIdle()

        // Resolves the moment anything aborts the stream. The read loop races
        // against it rather than trusting the body to notice: aborting the
        // fetch normally errors the reader, but "normally" is not a guarantee
        // worth hanging a live room on, and a read that never settles would
        // hold the request open until the platform killed it.
        const aborted = new Promise<'aborted'>(resolve => {
          if (abort.signal.aborted) return resolve('aborted')
          abort.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })

        try {
          while (true) {
            const next = await Promise.race([reader.read(), aborted])
            if (next === 'aborted') break
            const { done, value } = next
            if (done) break
            resetIdle()
            sseBuffer += decoder.decode(value, { stream: true })
            sseBuffer = consumeSseChunk(
              sseBuffer,
              delta => { raw += delta },
              tokens => { tokensUsed = tokens }
            )
            if (!process()) break
            // No point generating into a closed connection.
            if (clientGone) break
          }
        } catch (e) {
          // An abort we asked for is not an error; anything else is.
          if (!timedOut && !clientGone) {
            errored = true
            console.error('[Rehearsal] Stream read failed mid-turn:', e)
          }
        } finally {
          clearTimeout(totalTimer)
          if (idleTimer) clearTimeout(idleTimer)
          abort.abort()
          try { await reader.cancel() } catch { /* already closing */ }
        }

        // ── Finalise ──────────────────────────────────────────────────────
        // Every path below persists a counterpart turn. That is the point: the
        // user's turn is already in the transcript, so returning without one
        // would leave the rehearsal permanently lopsided — and the debrief
        // would later score a conversation where the counterpart never answered.

        if (blocked) {
          console.error('[Rehearsal] Output filter triggered. Preview:', raw.slice(0, 60))
          const substitute = 'Let us keep this to the matter at hand.'
          await appendTurn(rehearsalId, 'counterpart', substitute, counterpartPosition)
          // Charged even though the reply was discarded. The provider generated
          // it and we paid for it; the daily ceiling is a cost guard, and a
          // guard that ignores the one path someone can trigger on purpose is
          // not guarding anything. The leak path below already does this.
          await recordTokenUsage(userId, plan, charge(tokensUsed, raw))
          send({ chunk: '', done: true, fullReply: substitute, filtered: true, resources: null })
          close()
          return
        }

        if (leaked) {
          // The partial text is discarded rather than salvaged — it is the one
          // case where what arrived is exactly what must not be kept. The
          // replacement reads as the counterpart declining, and `filtered` is
          // deliberately false: the client is told nothing that distinguishes
          // this from an ordinary short answer.
          await appendTurn(rehearsalId, 'counterpart', LEAK_DEFLECTION, counterpartPosition)
          await recordTokenUsage(userId, plan, charge(tokensUsed, raw))
          send({
            chunk: '',
            done: true,
            fullReply: LEAK_DEFLECTION,
            filtered: false,
            resources: null,
            truncated: false,
          })
          close()
          return
        }

        const partial = cleanTurn(raw).trim()

        // Whatever arrived before the interruption is kept if it is a usable
        // turn. Throwing away three sentences because the fourth never came
        // would be worse for the transcript than an abrupt ending, which is a
        // thing real people do anyway.
        const salvageable = partial.length >= 40
        const finalReply = salvageable
          ? partial
          : partial || 'Say that again — I want to make sure I have understood you.'

        await appendTurn(rehearsalId, 'counterpart', finalReply, counterpartPosition)
        await recordTokenUsage(userId, plan, charge(tokensUsed, finalReply))

        if (clientGone) {
          // Nobody is listening. The turn is saved, so a refresh rehydrates it.
          close()
          return
        }

        send({
          chunk: '',
          done: true,
          fullReply: finalReply,
          filtered: false,
          resources: emergencyResources,
          // The room says the counterpart was cut off rather than pretending
          // the reply ended where it meant to.
          truncated: timedOut || errored,
        })
        close()
      },

      // Fires when the client disconnects — a closed tab, a navigation, a
      // dropped connection.
      cancel() {
        clientGone = true
        abort.abort()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }
  )
}
