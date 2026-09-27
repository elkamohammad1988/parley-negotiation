import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, isValidUserId, verifyOwnership } from '@/lib/ownership'
import { isDimensionId } from '@/lib/negotiation/dimensions'
import { checkContent } from '@/lib/safety'
import type { PlaybookEntry } from '@/lib/negotiation/types'

// The playbook: the user's own accumulated notes on what works.
//
// The system does not remember things about the user. The user records things
// about themselves, in their own words, and the system only stores them. An entry is
// most useful when it carries the rehearsal it came from, so a line can always
// be traced back to the moment it earned its place.

const MAX_NOTE = 1000

interface PlaybookRow {
  id: string
  user_id: string
  note: string
  dimension: string | null
  source_rehearsal_id: string | null
  source_scenario_title: string | null
  created_at: string
}

function rowToEntry(row: PlaybookRow): PlaybookEntry {
  return {
    id: row.id,
    userId: row.user_id,
    note: row.note,
    dimension: isDimensionId(row.dimension) ? row.dimension : null,
    sourceRehearsalId: row.source_rehearsal_id,
    sourceScenarioTitle: row.source_scenario_title,
    createdAt: row.created_at,
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const { data, error } = await supabase
    .from('playbook_entries')
    .select('id, user_id, note, dimension, source_rehearsal_id, source_scenario_title, created_at')
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[Playbook] List failed:', error.message)
    return NextResponse.json({ entries: [] })
  }

  return NextResponse.json({ entries: ((data ?? []) as PlaybookRow[]).map(rowToEntry) })
}

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  const rl = checkRateLimit(`playbook:${clientIp(req)}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  let body: {
    userId?: string
    note?: string
    dimension?: string
    sourceRehearsalId?: string
    sourceScenarioTitle?: string
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

  const note = (body.note ?? '').trim().slice(0, MAX_NOTE)
  if (!note) {
    return NextResponse.json({ error: 'Write the note first.' }, { status: 400 })
  }

  const safety = checkContent(note)
  if (safety.blocked) {
    return NextResponse.json({ error: 'This note cannot be saved.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('playbook_entries')
    .insert({
      user_id: body.userId as string,
      note,
      dimension: isDimensionId(body.dimension) ? body.dimension : null,
      // A uuid column with a foreign key to rehearsals. An unchecked value is
      // not a security hole — the link it produces resolves through
      // /api/debrief, which verifies ownership — but a malformed one fails the
      // whole insert, so the note the user just wrote is lost to a 500. Same
      // treatment as /api/report and /api/feedback give their id columns:
      // attribute it if it is well formed, drop the attribution if not, never
      // lose the row.
      source_rehearsal_id: isValidUserId(body.sourceRehearsalId) ? body.sourceRehearsalId : null,
      source_scenario_title: body.sourceScenarioTitle?.slice(0, 200) ?? null,
    })
    .select('id, user_id, note, dimension, source_rehearsal_id, source_scenario_title, created_at')
    .maybeSingle()

  if (error || !data) {
    console.error('[Playbook] Insert failed:', error?.message)
    return NextResponse.json({ error: 'Could not save that note.' }, { status: 500 })
  }

  return NextResponse.json({ entry: rowToEntry(data as PlaybookRow) })
}

export async function DELETE(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  const id = req.nextUrl.searchParams.get('id')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

  const { error } = await supabase
    .from('playbook_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId as string)

  if (error) {
    console.error('[Playbook] Delete failed:', error.message)
    return NextResponse.json({ error: 'Could not delete that note.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
