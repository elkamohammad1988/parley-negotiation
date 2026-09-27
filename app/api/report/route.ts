import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, isValidUserId, verifyOwnership } from '@/lib/ownership'
import { isReportReason, MAX_REPORT_DETAIL } from '@/lib/negotiation/reports'

// Reporting a counterpart that behaved badly.
//
// The things worth reporting are specific to this product:
// a counterpart that broke role, revealed its own mandate, folded, produced
// something abusive, or behaved in a way that made the rehearsal useless. The
// reason codes are the actual failure modes — see lib/negotiation/reports.ts,
// which now declares them once for both this route and the form that posts to
// it, so the validation here and the options a user can pick cannot drift.
//
// ── TWO THINGS THIS ROUTE DID NOT DO, AND NOW DOES ──────────────────────────
//
// It had no caller. The route, the table and the reason codes were all built
// and nothing in the product could reach them — so the one signal a user can
// send about the behaviour this whole product depends on was never going to
// arrive. The debrief now carries the form; see app/debrief/[id]/DebriefClient.
//
// Being reachable is what makes the other two fixes matter:
//
//   ATTRIBUTION WAS TAKEN ON TRUST. `user_id` was written from whatever
//   well-formed uuid the body carried, with no check that the caller owned it.
//   Reports are read by a human deciding whether a scenario's prompt needs
//   work; rows attributed to people who did not file them make that reading
//   worse, and the uuid is not a secret — the client sends it as a query
//   parameter on nearly every read. It is now proven, and an unproven id is
//   DROPPED rather than refused, which is the policy app/api/analytics settled
//   on for the same trade-off: the report is still worth having, it just
//   counts for nobody.
//
//   FAILURE WAS REPORTED AS SUCCESS. A failed insert was logged and answered
//   `{ ok: true }`. With no UI that was invisible; with one it is the product
//   telling someone their report was filed when it was dropped, which is the
//   exact thing the debrief's "we have it" line must never say falsely.

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`report:${clientIp(req)}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'Too many reports at once.' }, { status: 429 })
  }

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { userId, rehearsalId, reason, detail } = await req.json()

    if (!isReportReason(reason)) {
      return NextResponse.json({ ok: false, error: 'A valid reason is required.' }, { status: 400 })
    }

    // Proven, or nobody. See the note above on why this drops rather than
    // refuses: someone reporting a counterpart that just went wrong should not
    // have their report thrown away because their session lapsed mid-read.
    let attributedTo: string | null = null
    if (isValidUserId(userId)) {
      const ownership = await verifyOwnership(req, userId)
      if (ownership.ok) attributedTo = userId
    }

    const { error } = await supabase.from('reports').insert({
      user_id: attributedTo,
      // A uuid column. A malformed value fails the whole insert, and a report
      // that cannot say which rehearsal it is about is still worth more than
      // no report.
      rehearsal_id: isValidUserId(rehearsalId) ? rehearsalId : null,
      reason,
      // Bounded and optional. The transcript itself is not copied in — it is
      // already stored against the rehearsal, and duplicating it here would
      // spread candid content into a second table with different retention.
      detail: typeof detail === 'string' ? detail.slice(0, MAX_REPORT_DETAIL) || null : null,
    })

    if (error) {
      console.error('[Report] Insert failed:', error.message)
      return NextResponse.json(
        { ok: false, error: 'That did not send. Try again in a moment.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[Report] Route threw:', e)
    return NextResponse.json(
      { ok: false, error: 'That did not send. Try again in a moment.' },
      { status: 500 }
    )
  }
}
