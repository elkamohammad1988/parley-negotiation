import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { authenticatedUserId } from '@/lib/auth-server'

// Has this user rehearsed before?
//
// Used to route a sign-in: someone with history goes to their dashboard,
// a first-timer goes to onboarding. A head-only count, so it stays cheap on
// the auth path.
//
// ── WHY THE userId QUERY PARAM IS GONE ──────────────────────────────────────
//
// It used to take `?userId=` and answer for whoever was named, with no session
// check of any kind. That is a small leak with a wide reach: it turns any uuid
// into a yes/no on "does this person use Parley, and have they rehearsed" —
// and the uuid is not a secret the product protects, because the client sends
// it as a query parameter on nearly every other read, so it lands in browser
// history, proxy logs and any Referer that escapes the same-origin rule.
//
// The answer is now derived from the session rather than asked about someone:
// the caller's own verified access token names the account, and the parameter
// is not read at all. There is no id an attacker can substitute, because there
// is no id in the request.
//
// A caller with no verified session gets `false`, which is the same answer the
// route already gives on a lookup failure and routes to onboarding — the
// direction its own comment calls the safer one. Both client call sites send
// the token explicitly (see lib/analyticsClient's neighbours in app/signup and
// app/auth/callback) rather than relying on SessionSync having already mirrored
// the cookie, so the common path does not depend on that race.

export async function GET(req: NextRequest) {
  const userId = await authenticatedUserId(req)
  if (!userId) {
    return NextResponse.json({ hasHistory: false })
  }

  try {
    const { count, error } = await supabaseServer
      .from('rehearsals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1)

    if (error) {
      console.error('[HasHistory] Lookup failed:', error.message)
      // Fail toward onboarding: showing a returning user the intro is a much
      // smaller failure than dropping a first-timer onto an empty dashboard.
      return NextResponse.json({ hasHistory: false })
    }

    return NextResponse.json({ hasHistory: (count ?? 0) > 0 })
  } catch (e) {
    console.error('[HasHistory] Lookup threw:', e)
    return NextResponse.json({ hasHistory: false })
  }
}
