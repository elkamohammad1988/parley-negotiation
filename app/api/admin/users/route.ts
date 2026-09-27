import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/adminAuth'
import { toPlan } from '@/lib/plans'

// Recent accounts, for support lookups.
//
// Uses the service-role client rather than the browser's anon-key client,
// which is RLS-scoped and cannot see other users' rows — that was a real bug
// where new signups existed but never appeared here.
//
// The select previously asked for users.subscription_status and
// users.trial_ends_at. Neither column exists any more (entitlement moved to
// the subscriptions table), so this route returned a 500 on every call. Plan
// is now joined from where it actually lives.
//
// /api/admin/* sits outside the proxy's /admin/* cookie matcher, so this route
// carries its own guard.

export async function GET(req: NextRequest) {
  const refusal = await requireAdmin(req)
  if (refusal) return refusal

  const { data, error } = await supabaseServer
    .from('users')
    .select('id, email, display_name, banned, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[Admin users] Query failed:', error.message)
    return NextResponse.json({ error: 'Could not load users.' }, { status: 500 })
  }

  const users = data ?? []

  // Separate query rather than a PostgREST embed: subscriptions has no
  // declared foreign key to users, so an embedded select would not resolve.
  const { data: subs } = await supabaseServer
    .from('subscriptions')
    .select('user_id, plan, status')
    .in(
      'user_id',
      users.map(u => u.id)
    )

  const planByUser = new Map<string, string>()
  for (const sub of subs ?? []) {
    if (sub.status === 'active' || sub.status === 'trialing') {
      planByUser.set(sub.user_id, toPlan(sub.plan))
    }
  }

  return NextResponse.json({
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      banned: u.banned,
      createdAt: u.created_at,
      plan: planByUser.get(u.id) ?? 'free',
    })),
  })
}
