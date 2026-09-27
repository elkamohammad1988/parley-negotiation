import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { claimDebrief, getUserPlan, loadRehearsal, releaseDebriefClaim, transitionRehearsal } from '@/lib/rehearsals'
import { canGenerateDebrief, mandateMayBeRevealed } from '@/lib/negotiation/lifecycle'
import { buildDebriefPrompt, parseDebrief } from '@/lib/negotiation/debrief'
import { debriefScenario } from '@/lib/negotiation/redact'
import { complete, type ChatMessage } from '@/lib/openrouter'
import { estimateTokens, isOverGlobalBudget, recordTokenUsage } from '@/lib/usageLimits'
import { trackEvent } from '@/lib/analytics'
import { scoreLevers } from '@/lib/negotiation/scenarios'
import type { Debrief, LeverKind, ScoredLever } from '@/lib/negotiation/types'

// Generating and reading a debrief.
//
// This is the only place the hidden mandate is allowed to reach the client,
// and only for a rehearsal that has actually ended. A debrief is generated
// once and then persisted: re-scoring the same transcript on every page view
// would produce different numbers each time, which would make the progress
// trend meaningless and destroy trust in the score.

interface DebriefRow {
  id: string
  rehearsal_id: string
  overall_score: number
  dimensions: unknown
  key_moments: unknown
  outcome: string
  one_thing: string
  mandate_reveal: string
  levers: unknown
  created_at: string
}

function rowToDebrief(row: DebriefRow): Debrief {
  return {
    id: row.id,
    rehearsalId: row.rehearsal_id,
    overallScore: row.overall_score,
    dimensions: Array.isArray(row.dimensions) ? row.dimensions : [],
    keyMoments: Array.isArray(row.key_moments) ? row.key_moments : [],
    mandateReveal: row.mandate_reveal,
    levers: readLevers(row.levers),
    outcome: row.outcome as Debrief['outcome'],
    oneThing: row.one_thing,
    createdAt: row.created_at,
  } as Debrief
}

const DEBRIEF_FIELDS =
  'id, rehearsal_id, overall_score, dimensions, key_moments, outcome, one_thing, mandate_reveal, levers, created_at'

const LEVER_KINDS: LeverKind[] = ['price', 'trade', 'intel', 'immovable']

/**
 * The stored lever snapshot, validated on the way out.
 *
 * Rows written by this route are well formed by construction, but a row is
 * still the oldest thing in the system: this column arrived after the table
 * did, so every debrief scored before it exists reads as an empty array, and
 * that has to render as "no ledger" rather than as a crash on a page the user
 * has already paid attention to. Anything malformed is dropped for the same
 * reason.
 */
function readLevers(raw: unknown): ScoredLever[] {
  if (!Array.isArray(raw)) return []
  const out: ScoredLever[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    if (typeof l.id !== 'string' || typeof l.label !== 'string') continue
    if (typeof l.unlockedBy !== 'string') continue
    if (!LEVER_KINDS.includes(l.kind as LeverKind)) continue
    out.push({
      id: l.id,
      label: l.label,
      kind: l.kind as LeverKind,
      unlockedBy: l.unlockedBy,
      found: l.found === true,
      ...(l.free === true ? { free: true as const } : {}),
    })
  }
  return out
}

/** The stored debrief for a rehearsal, or null. */
async function readDebrief(rehearsalId: string): Promise<Debrief | null> {
  const { data, error } = await supabase
    .from('debriefs')
    .select(DEBRIEF_FIELDS)
    .eq('rehearsal_id', rehearsalId)
    .maybeSingle()
  if (error) {
    console.error('[Debrief] Read failed:', error.message)
    return null
  }
  return data ? rowToDebrief(data as DebriefRow) : null
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  const rehearsalId = req.nextUrl.searchParams.get('rehearsalId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  if (!rehearsalId) {
    return NextResponse.json({ error: 'rehearsalId is required.' }, { status: 400 })
  }

  const loaded = await loadRehearsal(rehearsalId, userId as string)
  if (!loaded) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  // The debrief row carries the mandate prose AND the lever ledger, so it is
  // gated on the same predicate as the scenario projection below rather than
  // on the fact that a row cannot exist any earlier. That fact is true today;
  // making it an argument rather than an inference means a future write path
  // that creates a row sooner cannot turn this into a leak silently.
  const mayReveal = mandateMayBeRevealed(loaded.rehearsal.status)

  return NextResponse.json({
    debrief: mayReveal ? await readDebrief(rehearsalId) : null,
    rehearsal: loaded.rehearsal,
    counterpart: loaded.counterpart,
    // Safe here and only here, and only once the rehearsal has ended — the
    // status is a required argument to the projection so it cannot be
    // forgotten. See lib/negotiation/redact.ts.
    scenario: debriefScenario(loaded.scenario, loaded.rehearsal.status),
    turns: loaded.turns.map(t => ({ side: t.side, content: t.content, position: t.position })),
  })
}

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  // Debriefs are the expensive call in this product — a full transcript in,
  // structured analysis out — so the limit is tighter than the room's.
  const rl = checkRateLimit(`debrief:${clientIp(req)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many debriefs at once. Give it a minute.' }, { status: 429 })
  }

  let body: { userId?: string; rehearsalId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, body.userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const userId = body.userId as string

  if (typeof body.rehearsalId !== 'string' || !body.rehearsalId) {
    return NextResponse.json({ error: 'rehearsalId is required.' }, { status: 400 })
  }

  const loaded = await loadRehearsal(body.rehearsalId, userId)
  if (!loaded) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const { rehearsal, scenario, turns } = loaded

  // Already generated — return it rather than re-scoring. This is the fast
  // path for a refresh, a second tab, or a client retrying after a timeout.
  //
  // Gated on the same predicate as GET, for the same reason: the row carries
  // the mandate and the lever ledger, and "a row cannot exist while the room
  // is live" is a fact about today's write paths, not an argument. The later
  // reads below run only after canGenerateDebrief() has passed, which implies
  // this predicate.
  if (mandateMayBeRevealed(rehearsal.status)) {
    const existing = await readDebrief(body.rehearsalId)
    if (existing) {
      return NextResponse.json({ debrief: existing })
    }
  }

  // 'draft' and 'live' are too early; 'debriefed' is already handled above by
  // the read, and 'failed' has nothing worth scoring.
  if (!canGenerateDebrief(rehearsal.status)) {
    return NextResponse.json(
      {
        error:
          rehearsal.status === 'live' || rehearsal.status === 'draft'
            ? 'End the rehearsal before asking for a debrief.'
            : 'There is no transcript here to score.',
        code: 'not_scoreable',
        status: rehearsal.status,
      },
      { status: 409 }
    )
  }

  const userTurns = turns.filter(t => t.side === 'you')
  if (userTurns.length < 2) {
    return NextResponse.json(
      { error: 'There is not enough here to score. Rehearsals need a few turns before a debrief is worth reading.', code: 'too_short' },
      { status: 422 }
    )
  }

  // The deployment-wide ceiling covers debriefs too. They used to be exempt on
  // the grounds that no new rehearsal can open once it trips, but rehearsals
  // opened earlier can be stockpiled and ended afterwards, and each debrief is
  // the largest single call the product makes. The transcript is kept, so the
  // same request succeeds once the day resets.
  if (await isOverGlobalBudget()) {
    return NextResponse.json(
      {
        error: 'Parley has reached its usage limit for today, so this debrief cannot be written yet. Your transcript is saved; come back after midnight UTC and it will be scored then.',
        code: 'global_cap',
      },
      { status: 429 }
    )
  }

  // Claim the right to generate before paying for it. The unique index on
  // debriefs.rehearsal_id already makes a duplicate row impossible, but it only
  // fires at INSERT — by which point both callers have paid for a full
  // transcript-in, analysis-out model call. This is the cheap half of that
  // guarantee; the constraint below is the real one.
  const claimed = await claimDebrief(body.rehearsalId, userId)
  if (!claimed) {
    const alreadyThere = await readDebrief(body.rehearsalId)
    if (alreadyThere) return NextResponse.json({ debrief: alreadyThere })
    // Someone else is mid-generation. Tell the client to wait rather than
    // starting a second identical model call alongside theirs.
    return NextResponse.json(
      { error: 'This debrief is already being written. Give it a few seconds.', code: 'generating' },
      { status: 409, headers: { 'Retry-After': '5' } }
    )
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a negotiation analyst. You read transcripts and return strictly valid JSON. You never wrap output in markdown fences and never add commentary outside the JSON object.',
    },
    {
      role: 'user',
      content: buildDebriefPrompt({
        scenario,
        turns,
        durationSeconds: rehearsal.durationSeconds,
      }),
    },
  ]
  const result = await complete(messages)

  // Every attempt is charged, not only the ones that parse. A timeout, a
  // provider fault after the prompt was accepted, or malformed output were all
  // paid for, and the claim is released on each so the user can retry — which
  // made failed attempts an uncounted way to spend. With no usage figure the
  // charge is an estimate of the prompt plus whatever came back.
  const plan = await getUserPlan(userId)
  const promptTokens = estimateTokens(messages.map(m => m.content).join('\n'))
  await recordTokenUsage(
    userId,
    plan,
    result?.tokensUsed || promptTokens + estimateTokens(result?.content ?? '')
  )

  // Nothing to persist on either failure below, so the claim is handed back at
  // once. Without that the user's own "Try again" — which the error screen
  // invites — would be refused as "already being written" until the claim's
  // three-minute stale window lapsed, for a generation that had already died.
  if (!result) {
    await releaseDebriefClaim(body.rehearsalId, userId)
    return NextResponse.json(
      { error: 'The debrief could not be generated. Your transcript is safe — try again in a moment.' },
      { status: 503 }
    )
  }

  const maxPosition = turns.length > 0 ? turns[turns.length - 1].position : 0
  const parsed = parseDebrief(
    result.content,
    maxPosition,
    scenario.mandateLevers.map(l => l.id)
  )
  if (!parsed) {
    console.error('[Debrief] Unparseable model output. Preview:', result.content.slice(0, 200))
    await releaseDebriefClaim(body.rehearsalId, userId)
    return NextResponse.json(
      { error: 'The debrief came back malformed. Try generating it again.' },
      { status: 502 }
    )
  }

  const { data: inserted, error: insertError } = await supabase
    .from('debriefs')
    .insert({
      rehearsal_id: body.rehearsalId,
      user_id: userId,
      overall_score: parsed.overallScore,
      dimensions: parsed.dimensions,
      key_moments: parsed.keyMoments,
      outcome: parsed.outcome,
      one_thing: parsed.oneThing,
      mandate_reveal: scenario.hiddenMandate,
      // The whole set, marked — snapshotted for the same reason the mandate
      // prose above it is. See the note on Debrief.levers in types.ts.
      levers: scoreLevers(scenario, parsed.leversFound),
    })
    .select(DEBRIEF_FIELDS)
    .maybeSingle()

  if (insertError || !inserted) {
    // 23505 is the one-debrief-per-rehearsal unique index doing its job: a
    // concurrent request beat us to it despite the claim (a lapsed claim, or a
    // retry after a crash). The right answer is the debrief that exists, not a
    // 500 — the caller asked for a debrief and there is one.
    if (insertError?.code === '23505') {
      const winner = await readDebrief(body.rehearsalId)
      if (winner) return NextResponse.json({ debrief: winner })
    }
    console.error('[Debrief] Failed to persist:', insertError?.message)
    await releaseDebriefClaim(body.rehearsalId, userId)
    return NextResponse.json({ error: 'The debrief could not be saved.' }, { status: 500 })
  }

  // Denormalised onto the rehearsal so history and progress views do not have
  // to join every row just to render a score.
  await supabase
    .from('rehearsals')
    .update({ overall_score: parsed.overallScore })
    .eq('id', body.rehearsalId)
    .eq('user_id', userId)

  // Terminal state. The machine refuses every transition out of 'debriefed',
  // so the rehearsal can never be reopened, re-ended and re-scored — which is
  // what keeps the progress trend meaningful.
  const scored = await transitionRehearsal(body.rehearsalId, userId, 'debriefed')
  if (!scored.ok) {
    // The debrief itself is saved and correct, so this is not worth failing the
    // request over — but it does mean the row is out of step with reality.
    console.error('[Debrief] Persisted but could not mark debriefed:', scored.reason, scored.detail)
  }

  await trackEvent(
    {
      name: 'debrief_generated',
      properties: { scenario: scenario.slug, score: parsed.overallScore, outcome: parsed.outcome },
    },
    userId
  )

  return NextResponse.json({ debrief: rowToDebrief(inserted as DebriefRow) })
}
