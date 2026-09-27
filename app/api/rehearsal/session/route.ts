import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { bindGuestIdentity, clientIp, verifyOwnership } from '@/lib/ownership'
import { getScenario } from '@/lib/negotiation/scenarios'
import { publicScenario } from '@/lib/negotiation/redact'
import {
  appendTurn,
  getUserPlan,
  listRehearsals,
  loadRehearsal,
  resolveCounterpart,
  transitionRehearsal,
} from '@/lib/rehearsals'
import { isEndReason, type EndReason } from '@/lib/negotiation/lifecycle'
import { getRehearsalQuota, isOverGlobalBudget, GLOBAL_CAP_MESSAGE, QUOTA_MESSAGE } from '@/lib/usageLimits'
import { trackEvent } from '@/lib/analytics'

// Rehearsal lifecycle: open a room, list past rooms, close a room.
//
// The counterpart speaks first. That is a deliberate product decision rather
// than a UI detail — opening with their move means the user is responding
// under pressure from turn one, instead of composing an opening statement at
// leisure into an empty box, which is not what the real conversation will be.

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  const rl = checkRateLimit(`rehearsal-start:${clientIp(req)}`, 15, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many rehearsals started. Slow down.' }, { status: 429 })
  }

  let body: { userId?: string; scenarioSlug?: string; counterpartId?: string }
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

  const scenario = getScenario(body.scenarioSlug ?? '')
  if (!scenario) {
    return NextResponse.json({ error: 'Unknown scenario.' }, { status: 400 })
  }
  // A built-in, or one of this user's own custom counterparts. The lookup is
  // scoped to the verified user id, so someone else's counterpart resolves to
  // nothing — the same answer as an id that does not exist.
  const counterpart = await resolveCounterpart(body.counterpartId ?? '', userId)
  if (!counterpart) {
    return NextResponse.json({ error: 'Unknown counterpart.' }, { status: 400 })
  }

  // Quota is checked here so the user gets a civil message with a number in it.
  // It is NOT what enforces the limit — a BEFORE INSERT trigger on rehearsals
  // does that, because this read-then-insert lets two rooms opened at the same
  // moment both pass. If this check is somehow wrong or skipped, the insert
  // below still fails.
  const plan = await getUserPlan(userId)
  const quota = await getRehearsalQuota(userId, plan)
  if (!quota.allowed) {
    return NextResponse.json(
      { error: QUOTA_MESSAGE, code: 'quota_exceeded', used: quota.used, limit: quota.limit },
      { status: 402 }
    )
  }

  // The deployment-wide cost guard. Checked at the door as well as per turn, so
  // nobody is let into a room whose counterpart cannot answer.
  if (await isOverGlobalBudget()) {
    return NextResponse.json({ error: GLOBAL_CAP_MESSAGE, code: 'global_cap' }, { status: 429 })
  }

  // This is the moment a browser-only id starts holding something worth
  // stealing, so it is the moment it gets bound to this browser. Before this
  // call a silent guest's uuid had no `users` row, which meant no device token,
  // which meant the guest → account migration would accept it as a source from
  // anyone who knew the uuid. See bindGuestIdentity in lib/ownership.ts.
  //
  // Runs before the insert, not after: a rehearsal that exists for even a
  // moment under an unbound id is the thing being prevented.
  await bindGuestIdentity(req, userId)

  // Created as 'draft', not 'live'. A rehearsal is only live once the
  // counterpart's opening turn is actually in the transcript — previously an
  // insert that succeeded while the opening turn failed left a live room with
  // no opening line in it, and nothing could tell that apart from a real one.
  const { data, error } = await supabase
    .from('rehearsals')
    .insert({
      user_id: userId,
      scenario_slug: scenario.slug,
      scenario_title: scenario.title,
      counterpart_id: counterpart.id,
      status: 'draft',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()

  if (error || !data) {
    // The database's own quota guard fired — either because two rooms were
    // opened at once and this one lost, or because the check above was wrong.
    // Answer it exactly as the check above would have.
    if (error?.message?.includes('rehearsal_quota_exceeded')) {
      const [, used, limit] = error.message.match(/rehearsal_quota_exceeded:(\d+):(-?\d+)/) ?? []
      return NextResponse.json(
        {
          error: QUOTA_MESSAGE,
          code: 'quota_exceeded',
          used: Number(used ?? quota.used),
          limit: Number(limit ?? quota.limit),
        },
        { status: 402 }
      )
    }
    console.error('[Rehearsal] Failed to create session:', error?.message)
    return NextResponse.json({ error: 'Could not open the room. Try again.' }, { status: 500 })
  }

  // The scenario's scripted opening is stored as turn 0 so the transcript and
  // the debrief both see the conversation the user actually had.
  const openingSaved = await appendTurn(data.id, 'counterpart', scenario.opening, 0)
  if (!openingSaved) {
    // Mark it failed rather than leaving a draft that looks openable. Failed
    // rows are excluded from the quota count on both sides, so a room that
    // never opened does not cost the user a rehearsal.
    await transitionRehearsal(data.id, userId, 'failed', 'failed')
    return NextResponse.json({ error: 'Could not open the room. Try again.' }, { status: 500 })
  }

  const live = await transitionRehearsal(data.id, userId, 'live')
  if (!live.ok) {
    console.error('[Rehearsal] Could not bring the room live:', live.reason, live.detail)
    // Same reasoning as the opening-turn failure above: a draft the user never
    // entered must not sit in their history looking openable, or count against
    // their month. Best effort — if the database is what failed, so will this.
    await transitionRehearsal(data.id, userId, 'failed', 'failed')
    return NextResponse.json({ error: 'Could not open the room. Try again.' }, { status: 500 })
  }

  await trackEvent(
    { name: 'rehearsal_started', properties: { scenario: scenario.slug, counterpart: counterpart.id, plan } },
    userId
  )

  return NextResponse.json({
    rehearsalId: data.id,
    opening: scenario.opening,
    quota: { used: quota.used + 1, limit: quota.limit },
  })
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  const rehearsalId = req.nextUrl.searchParams.get('rehearsalId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const uid = userId as string

  // Single rehearsal — used by the room to rehydrate after a refresh.
  if (rehearsalId) {
    const loaded = await loadRehearsal(rehearsalId, uid)
    if (!loaded) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const { rehearsal, scenario, counterpart, turns } = loaded
    return NextResponse.json({
      rehearsal,
      counterpart,
      turns: turns.map(t => ({ side: t.side, content: t.content, position: t.position })),
      // The mandate is withheld here unconditionally — the room is never the
      // reveal surface, even after the fact. Sending it to a live room would
      // put the answer in the browser's network tab and quietly destroy the
      // only thing this product measures. See lib/negotiation/redact.ts.
      scenario: publicScenario(scenario),
    })
  }

  const plan = await getUserPlan(uid)
  const [rehearsals, quota] = await Promise.all([listRehearsals(uid), getRehearsalQuota(uid, plan)])
  return NextResponse.json({ rehearsals, quota, plan })
}

export async function PATCH(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  let body: { userId?: string; rehearsalId?: string; status?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, body.userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  if (typeof body.rehearsalId !== 'string' || !body.rehearsalId) {
    return NextResponse.json({ error: 'rehearsalId is required.' }, { status: 400 })
  }

  // The wire contract takes a REASON, not a target state: the only end a
  // client may ask for is 'ended', and the reason distinguishes closing the
  // room from walking out of it. `status` is still accepted for the older
  // spelling so an in-flight client or the eval harness keeps working.
  const legacy = body.status === 'abandoned' ? 'abandoned' : body.status === 'complete' ? 'completed' : null
  const reason: EndReason = isEndReason(body.reason) ? body.reason : (legacy ?? 'completed')

  const outcome = await transitionRehearsal(body.rehearsalId, body.userId as string, 'ended', reason)

  if (!outcome.ok) {
    if (outcome.reason === 'not_found') {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    }
    if (outcome.reason === 'illegal') {
      // Ending something already scored, for instance. The state is the
      // answer, not an error the user can act on — so report where it is.
      const current = await loadRehearsal(body.rehearsalId, body.userId as string)
      return NextResponse.json(
        {
          error: 'This rehearsal has already finished.',
          code: 'illegal_transition',
          status: current?.rehearsal.status ?? null,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Could not end the rehearsal.' }, { status: 500 })
  }

  // Only count it once. A retried request reports success without re-firing
  // the analytics event, which would otherwise inflate the ended count.
  if (outcome.changed) {
    await trackEvent({ name: 'rehearsal_ended', properties: { status: reason } }, body.userId as string)
  }

  return NextResponse.json({ ok: true, status: outcome.status, reason, changed: outcome.changed })
}
