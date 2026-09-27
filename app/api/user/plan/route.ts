import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { toPlan } from '@/lib/plans'
import { verifyOwnership } from '@/lib/ownership'

// Server-authoritative plan lookup.
//
// Exists because the browser's anon-key client is subject to RLS, which needs
// a live matching Supabase Auth session — not merely the right id in local
// storage. When those diverge, a paying user's entitlements would read as free.
// Reads subscriptions (the row the Stripe webhook actually writes) via the
// service-role key.

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  // Entitlements are per-account and not public. This previously answered for
  // any well-formed uuid, which let anyone probe whether an id was a paying
  // customer. An unverified caller gets the same 'free' shape rather than an
  // error, so an unauthenticated page still renders as the free tier.
  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ plan: 'free' })
  }

  try {
    const { data, error } = await supabaseServer
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .maybeSingle()

    if (error) {
      console.error('[Plan] Lookup failed, defaulting to free:', error.message)
      return NextResponse.json({ plan: 'free' })
    }

    // toPlan resolves anything that is not a known plan — including a stale
    // value from an older schema — to 'free' rather than passing it through.
    return NextResponse.json({ plan: toPlan(data?.plan) })
  } catch (e) {
    console.error('[Plan] Lookup threw, defaulting to free:', e)
    return NextResponse.json({ plan: 'free' })
  }
}
