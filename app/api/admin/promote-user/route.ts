import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { requireAdmin } from '@/lib/adminAuth'
import { isPlan } from '@/lib/plans'
import { clientIp, isValidUserId } from '@/lib/ownership'

// Manually set a user's plan — support cases, payment handled out of band,
// comped accounts.
//
// Writes exactly one row. The version this replaces wrote the plan to two
// places (users.subscription_status and subscriptions.plan) which had already
// drifted once in production, unlocking a promoted user everywhere except one
// page. The new schema has a single source of truth for entitlement —
// subscriptions.plan — and every read goes through it.
//
// /api/admin/* is not covered by the proxy's /admin/* cookie matcher, so this
// route carries its own guard.

export async function POST(req: NextRequest) {
  const refusal = await requireAdmin(req)
  if (refusal) return refusal

  const rl = checkRateLimit(`admin-promote:${clientIp(req)}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  const { identifier, plan } = await req.json()

  if (!isPlan(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }
  if (typeof identifier !== 'string' || !identifier.trim()) {
    return NextResponse.json({ error: 'Email or user ID required' }, { status: 400 })
  }

  const trimmed = identifier.trim()
  let targetUserId = isValidUserId(trimmed) ? trimmed : null

  if (!targetUserId) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id')
      .eq('email', trimmed)
      .maybeSingle()
    if (error) {
      // Logged, not returned — Postgres messages name tables and columns. Same
      // treatment every non-admin route in this codebase already gives them.
      console.error('[Admin] User lookup failed:', error.message)
      return NextResponse.json({ error: 'Could not look that user up.' }, { status: 500 })
    }
    targetUserId = data?.id ?? null
  }

  if (!targetUserId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error } = await supabaseServer.from('subscriptions').upsert(
    {
      user_id: targetUserId,
      plan,
      status: plan === 'free' ? 'inactive' : 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    console.error('[Admin] Plan change failed:', error.message)
    return NextResponse.json({ error: 'Could not change that plan.' }, { status: 500 })
  }

  console.log('[Admin] Plan set manually:', targetUserId, '→', plan)
  return NextResponse.json({ success: true, userId: targetUserId, plan })
}
