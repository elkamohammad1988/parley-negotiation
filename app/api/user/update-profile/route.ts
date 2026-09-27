import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'
import { checkContent } from '@/lib/safety'

// Display-name update.
//
// WHAT CHANGED AND WHY. This route used to take a userId on trust: the header
// comment said so plainly, on the reasoning that a display name is cosmetic.
// It is not cosmetic to the person whose account it is. Anyone who knew a
// uuid — and the client sends it as a query parameter on every read, so it is
// not a secret — could rewrite a stranger's name to anything, at any length,
// as often as they liked. The rate limit did not even slow that down: it was
// keyed on the caller-supplied userId, so rotating the value reset it.
//
// lib/ownership.ts exists now, which it did not when that comment was written,
// so the fix is the same gate every other user-scoped route already uses.
//
// Email changes are still deliberately NOT handled here. Supabase's
// admin.updateUserById() changes an address instantly with no confirmation to
// either side, which turns any weakness in this route into account takeover
// (change email → reset password). A display name is worth a session check; an
// email change is worth a dedicated, confirmed flow, and until one exists it
// stays with support.

const MAX_DISPLAY_NAME = 80

export async function POST(req: NextRequest) {
  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  // Keyed on the IP, not on the body's userId — see above.
  const rl = checkRateLimit(`update-profile:${clientIp(req)}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  let body: { userId?: string; displayName?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ownership = await verifyOwnership(req, body.userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  if (body.displayName === undefined) {
    return NextResponse.json({ success: true })
  }
  if (typeof body.displayName !== 'string') {
    return NextResponse.json({ error: 'A display name must be text.' }, { status: 400 })
  }

  // Bounded before it is stored. The column is unbounded text, so without this
  // one request could write a megabyte into a row that every admin lookup and
  // every account export then has to carry.
  const displayName = body.displayName.trim().slice(0, MAX_DISPLAY_NAME)
  if (checkContent(displayName).blocked) {
    return NextResponse.json({ error: 'That name cannot be saved.' }, { status: 400 })
  }

  const { error } = await supabaseServer
    .from('users')
    .update({ display_name: displayName })
    .eq('id', body.userId as string)

  if (error) {
    // The database's own message is not the caller's business — it names
    // columns and constraints.
    console.error('[Profile] Display-name update failed:', error.message)
    return NextResponse.json({ error: 'Could not save that name.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, displayName })
}
