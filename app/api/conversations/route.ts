import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { checkContent } from '@/lib/safety'
import { getScenario } from '@/lib/negotiation/scenarios'

// Upcoming conversations — the real, dated thing the user is preparing for.
//
// This is what the dashboard is built around, and it is the reason the product
// has a sense of urgency that does not come from streaks or notifications
// nagging someone back into the app. The deadline is the user's own.

const MAX_TITLE = 200
const MAX_NOTES = 2000

interface ConversationRow {
  id: string
  title: string
  happens_on: string | null
  scenario_slug: string | null
  notes: string | null
  resolved: boolean
  created_at: string
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const { data, error } = await supabase
    .from('upcoming_conversations')
    .select('id, title, happens_on, scenario_slug, notes, resolved, created_at')
    .eq('user_id', userId as string)
    .eq('resolved', false)
    // Nulls last so dated conversations lead — an undated one has no urgency
    // and should not sit above something happening on Thursday.
    .order('happens_on', { ascending: true, nullsFirst: false })
    .limit(20)

  if (error) {
    console.error('[Conversations] List failed:', error.message)
    return NextResponse.json({ conversations: [] })
  }

  const conversations = ((data ?? []) as ConversationRow[]).map(row => ({
    id: row.id,
    title: row.title,
    happensOn: row.happens_on,
    scenarioSlug: row.scenario_slug,
    scenarioTitle: row.scenario_slug ? (getScenario(row.scenario_slug)?.title ?? null) : null,
    notes: row.notes,
    createdAt: row.created_at,
  }))

  return NextResponse.json({ conversations })
}

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  const rl = checkRateLimit(`conversations:${clientIp(req)}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  let body: {
    userId?: string
    title?: string
    happensOn?: string | null
    scenarioSlug?: string | null
    notes?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, body.userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const title = (body.title ?? '').trim().slice(0, MAX_TITLE)
  if (!title) {
    return NextResponse.json({ error: 'Give it a name.' }, { status: 400 })
  }

  const notes = (body.notes ?? '').trim().slice(0, MAX_NOTES) || null
  const safety = checkContent(`${title} ${notes ?? ''}`)
  if (safety.blocked) {
    return NextResponse.json({ error: 'This cannot be saved.' }, { status: 400 })
  }

  // Rejected rather than silently dropped: a date that fails to save without
  // telling anyone is worse than an error, because the whole dashboard is
  // ordered by it.
  const happensOn = body.happensOn?.trim() || null
  if (happensOn && !/^\d{4}-\d{2}-\d{2}$/.test(happensOn)) {
    return NextResponse.json({ error: 'Use a YYYY-MM-DD date.' }, { status: 400 })
  }

  const scenarioSlug = body.scenarioSlug && getScenario(body.scenarioSlug) ? body.scenarioSlug : null

  const { data, error } = await supabase
    .from('upcoming_conversations')
    .insert({
      user_id: body.userId as string,
      title,
      happens_on: happensOn,
      scenario_slug: scenarioSlug,
      notes,
    })
    .select('id, title, happens_on, scenario_slug, notes, resolved, created_at')
    .maybeSingle()

  if (error || !data) {
    console.error('[Conversations] Insert failed:', error?.message)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }

  const row = data as ConversationRow
  return NextResponse.json({
    conversation: {
      id: row.id,
      title: row.title,
      happensOn: row.happens_on,
      scenarioSlug: row.scenario_slug,
      scenarioTitle: row.scenario_slug ? (getScenario(row.scenario_slug)?.title ?? null) : null,
      notes: row.notes,
      createdAt: row.created_at,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  let body: { userId?: string; id?: string; resolved?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, body.userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  const { error } = await supabase
    .from('upcoming_conversations')
    .update({ resolved: body.resolved !== false })
    .eq('id', body.id)
    .eq('user_id', body.userId as string)

  if (error) {
    console.error('[Conversations] Update failed:', error.message)
    return NextResponse.json({ error: 'Could not update that.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
