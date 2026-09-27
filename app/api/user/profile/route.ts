import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { clientIp, verifyOwnership } from '@/lib/ownership'

// The account's own name and email address.
//
// WHAT CHANGED AND WHY. This route carried a comment admitting it returned an
// account's email address given only its userId, with the device-token check
// inlined here as a "soft mitigation", and closing it properly deferred to a
// Supabase Auth migration. That migration has since landed — lib/auth-server.ts
// verifies a real session and lib/ownership.ts puts it in front of every other
// user-scoped route — so the deferral no longer applies.
//
// The inlined check was also weaker than the shared one in two ways that
// mattered: it accepted any string up to 100 characters as an id rather than a
// uuid, and it CLAIMED an unbound row's device token for whoever asked first,
// which handed a stranger the binding for any account that had never made a
// request. verifyOwnership only claims a token for an id whose row already
// exists and which has none, and it prefers a verified session over the token
// whenever one is presented.
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(`user-profile:${clientIp(req)}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const userId = req.nextUrl.searchParams.get('userId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const { data, error } = await supabaseServer
    .from('users')
    .select('display_name, email')
    .eq('id', userId as string)
    .maybeSingle()

  if (error) {
    console.error('[Profile] Lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not read your profile.' }, { status: 503 })
  }

  return NextResponse.json({
    displayName: data?.display_name || '',
    email: data?.email || '',
  })
}
