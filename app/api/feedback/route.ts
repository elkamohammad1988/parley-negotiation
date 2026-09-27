import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, isValidUserId } from '@/lib/ownership'
import { checkContent } from '@/lib/safety'

// Feedback from the support form.
//
// Previously took { character, rating, comment } and wrote character_id/rating/
// comment — none of which exist on the feedback table any more. Every insert
// failed, and because the handler swallowed errors and returned { ok: true },
// the support form reported success while saving nothing. Now matches the
// schema (user_id, message, page) and reports real failures.

const MAX_MESSAGE = 3000

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`feedback:${clientIp(req)}`, 20, 60_000)
  if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429 })

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { userId, message, page } = await req.json()

    const body = typeof message === 'string' ? message.trim().slice(0, MAX_MESSAGE) : ''
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Write something first.' }, { status: 400 })
    }

    // Free text from an unauthenticated form, so it goes through the same
    // content check as everything else a user writes.
    if (checkContent(body).blocked) {
      return NextResponse.json({ ok: false, error: 'This cannot be submitted.' }, { status: 400 })
    }

    const { error } = await supabase.from('feedback').insert({
      // A uuid column: a malformed id would fail the insert and lose the
      // message, which is exactly the failure this route was rewritten to stop.
      user_id: isValidUserId(userId) ? userId : null,
      message: body,
      page: typeof page === 'string' ? page.slice(0, 200) : null,
    })

    if (error) {
      console.error('[Feedback] Insert failed:', error.message)
      return NextResponse.json({ ok: false, error: 'Could not send that.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[Feedback] Route threw:', e)
    return NextResponse.json({ ok: false, error: 'Could not send that.' }, { status: 500 })
  }
}
