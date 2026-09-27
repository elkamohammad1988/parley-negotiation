import { NextRequest, NextResponse } from 'next/server'
import { checkSafety } from '@/lib/safety'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'

// Standalone safety check, for surfaces that want to validate text before it
// reaches a generation path.
// The live rehearsal route does NOT call this; it calls checkSafety directly so
// the check and the generation cannot drift apart.
//
// ── WHY THIS ROUTE IS AUTHENTICATED ─────────────────────────────────────────
//
// It was not, and that was a hole with teeth. checkSafety() is not a pure
// function: on a CRITICAL match it writes an immutable row to
// critical_violations for the userId it is handed, and on the third such row
// it upserts banned_users and sets users.banned = true. lib/ownership.ts then
// refuses every request from that account.
//
// This route read `userId` straight out of the request body and passed it
// through, with no session check and no ownership check. So three unauthenticated
// POSTs carrying a victim's uuid and any string matching a CRITICAL pattern
// permanently suspended their account — and seeded a log this codebase treats
// as 18 U.S.C. §2258A evidence with someone else's identifier. The uuid is not
// a secret that could have protected it: the client sends it as a query
// parameter on nearly every read, so it sits in browser history, proxy logs and
// any Referer that escapes.
//
// The fix is that attribution now requires proof. A caller who names a userId
// must own it, by the same gate every other user-scoped route uses; a caller
// who names nobody gets an unattributed check that writes no user row. There is
// no longer any request that can attach a violation — or a ban — to an account
// the caller has not proven is theirs.
//
// The check itself stays available without a session, because it is advisory
// and the enforcement point is elsewhere.

// The patterns in lib/safety.ts are regexes run over both the raw message and a
// leet-normalised copy. Unbounded input means unbounded scanning on an
// unauthenticated endpoint, which is a CPU cost anyone can impose. The rehearsal
// route caps a turn at 4000 for the same reason; nothing legitimate calling a
// pre-flight check is longer than that.
const MAX_MESSAGE = 4000
const MAX_CONTEXT = 120

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`safety-check:${clientIp(req)}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ safe: true }, { status: 429 })

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  let body: { message?: unknown; context?: unknown; userId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) return NextResponse.json({ safe: true })
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: 'That is too long to check.' }, { status: 400 })
  }

  const context =
    typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : 'standalone-check'

  // Attribution is opt-in and must be proven. An unproven id is refused rather
  // than quietly downgraded to anonymous: a caller naming someone else's
  // account is not making a mistake worth being helpful about.
  let attributedTo: string | undefined
  if (body.userId !== undefined && body.userId !== null && body.userId !== '') {
    const ownership = await verifyOwnership(req, body.userId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }
    attributedTo = body.userId as string
  }

  try {
    const result = await checkSafety(message, context, attributedTo)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[Safety] Check threw:', e)
    // Fails safe-open: this endpoint is a convenience for client-side
    // validation, never the enforcement point.
    return NextResponse.json({ safe: true })
  }
}
