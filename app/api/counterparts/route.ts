import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { BUILT_IN_COUNTERPARTS } from '@/lib/negotiation/counterparts'
import { checkCounterpartDefinition } from '@/lib/safety'
import { getUserPlan } from '@/lib/rehearsals'
import { planFeatures, withinLimit } from '@/lib/plans'
import type { Counterpart } from '@/lib/negotiation/types'

// Built-in and user-authored counterparts.
//
// A custom counterpart is how someone rehearses against the actual person they
// are about to face — "my director, who agrees with everything and then does
// nothing". That is the highest-value thing in the product and also the one
// place where user text becomes part of a system prompt, so every field is
// length-bounded and safety-checked before it is stored.

const MAX_NAME = 60
const MAX_ROLE = 120
const MAX_DISPOSITION = 600
const MAX_TACTIC = 200
const MAX_TACTICS = 4
const MAX_TELL = 300

interface CustomRow {
  id: string
  name: string
  role: string
  disposition: string
  tactics: unknown
  tell: string | null
}

function rowToCounterpart(row: CustomRow): Counterpart {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    disposition: row.disposition,
    tactics: Array.isArray(row.tactics) ? (row.tactics as string[]) : [],
    tell: row.tell ?? '',
    builtIn: false,
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  // The built-in bench is public — it is most of the pitch on the marketing
  // pages, so an unauthenticated read returns it rather than an error.
  if (!userId) {
    return NextResponse.json({ counterparts: BUILT_IN_COUNTERPARTS, custom: [] })
  }

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const { data, error } = await supabase
    .from('custom_counterparts')
    .select('id, name, role, disposition, tactics, tell')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) console.error('[Counterparts] List failed:', error.message)

  const custom = ((data ?? []) as CustomRow[]).map(rowToCounterpart)
  const plan = await getUserPlan(userId)

  return NextResponse.json({
    counterparts: BUILT_IN_COUNTERPARTS,
    custom,
    limit: planFeatures(plan).customCounterparts,
  })
}

export async function POST(req: NextRequest) {
  const invalid = rejectInvalidContentType(req)
  if (invalid) return invalid

  const rl = checkRateLimit(`counterpart-create:${clientIp(req)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  let body: {
    userId?: string
    name?: string
    role?: string
    disposition?: string
    tactics?: unknown
    tell?: string
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
  const userId = body.userId as string

  const name = (body.name ?? '').trim().slice(0, MAX_NAME)
  const role = (body.role ?? '').trim().slice(0, MAX_ROLE)
  const disposition = (body.disposition ?? '').trim().slice(0, MAX_DISPOSITION)
  const tell = (body.tell ?? '').trim().slice(0, MAX_TELL)

  if (!name || !role || !disposition) {
    return NextResponse.json(
      { error: 'A counterpart needs a name, a role, and how they behave under pressure.' },
      { status: 400 }
    )
  }

  const tactics = (Array.isArray(body.tactics) ? body.tactics : [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim().slice(0, MAX_TACTIC))
    .slice(0, MAX_TACTICS)

  // Safety check spans every free-text field at once, including the tactics —
  // all of them end up inside the counterpart's system prompt.
  const safety = checkCounterpartDefinition({
    name,
    role,
    disposition: `${disposition} ${tactics.join(' ')} ${tell}`,
  })
  if (!safety.safe) {
    return NextResponse.json({ error: safety.reason }, { status: 400 })
  }

  const plan = await getUserPlan(userId)
  const limit = planFeatures(plan).customCounterparts
  const { count } = await supabase
    .from('custom_counterparts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (!withinLimit(count ?? 0, limit)) {
    return NextResponse.json(
      {
        error:
          limit === 0
            ? 'Custom counterparts are available on Practitioner and above.'
            : `Your plan includes ${limit} custom counterparts.`,
        code: 'limit_reached',
      },
      { status: 402 }
    )
  }

  const { data, error } = await supabase
    .from('custom_counterparts')
    .insert({ user_id: userId, name, role, disposition, tactics, tell })
    .select('id, name, role, disposition, tactics, tell')
    .maybeSingle()

  if (error || !data) {
    console.error('[Counterparts] Insert failed:', error?.message)
    return NextResponse.json({ error: 'Could not save that counterpart.' }, { status: 500 })
  }

  return NextResponse.json({ counterpart: rowToCounterpart(data as CustomRow) })
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
    .from('custom_counterparts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId as string)

  if (error) {
    console.error('[Counterparts] Delete failed:', error.message)
    return NextResponse.json({ error: 'Could not delete that counterpart.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
