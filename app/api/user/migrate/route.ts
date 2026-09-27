// Migrates an anonymous device identity's data onto a real account id, so a
// guest's work is not orphaned when parley_uid is overwritten at sign-up or
// sign-in.
//
// The table list below was rewritten for Parley's schema. It previously moved
// `conversations`, `memories` and `relationships`, none of which exist any
// more — every call failed, and the tables that DO hold a guest's work were
// not being moved at all.
//
// Deliberately NOT migrated:
//   usage_daily      — a daily cost guard keyed (user_id, usage_date). Moving
//                      it can collide with an existing row for the same day on
//                      the destination account, and it resets daily anyway.
//   safety_flags,
//   critical_violations — audit records. They belong to the identity that
//                      produced them and must not be reattributed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, isValidUserId, verifyDeviceBinding, verifyOwnership } from '@/lib/ownership'

// Order is irrelevant — only user_id changes, and no foreign key between these
// references it (debriefs.rehearsal_id and playbook_entries.source_rehearsal_id
// both point at rehearsal ids, which are untouched).
const MIGRATED_TABLES = [
  'rehearsals',
  'debriefs',
  'playbook_entries',
  'custom_counterparts',
  'upcoming_conversations',
] as const

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`user-migrate:${clientIp(req)}`, 10, 60_000)
  if (!rl.allowed) return NextResponse.json({ migrated: false }, { status: 429 })

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { oldUserId, newUserId } = await req.json()

    if (!isValidUserId(oldUserId) || !isValidUserId(newUserId) || oldUserId === newUserId) {
      return NextResponse.json({ migrated: false })
    }

    // The caller has to own both sides. Until this check existed, two
    // well-formed uuids were enough to move anyone's rehearsals, debriefs and
    // playbook onto anyone's account.
    //
    // The destination is checked the way every route checks an id: a session
    // that resolves to it, or the device token bound to it. The source cannot
    // be checked the same way — this browser now holds a session for the NEW
    // account, which verifyOwnership would rightly refuse as someone else's —
    // so it is proven the only way a guest id ever could be: by the device
    // token its first request bound, or trivially if no row exists to bind.
    const destination = await verifyOwnership(req, newUserId)
    if (!destination.ok) {
      return NextResponse.json({ migrated: false, error: destination.error }, { status: destination.status })
    }
    const source = await verifyDeviceBinding(req, oldUserId)
    if (!source.ok) {
      return NextResponse.json({ migrated: false, error: source.error }, { status: source.status })
    }

    const results = await Promise.all(
      MIGRATED_TABLES.map(async table => {
        const { error } = await supabaseServer
          .from(table)
          .update({ user_id: newUserId })
          .eq('user_id', oldUserId)
        return { table, error }
      })
    )

    const failures = results.filter(r => r.error)
    if (failures.length > 0) {
      // Partial success is reported rather than swallowed: the caller has
      // already switched parley_uid, so a silent failure here would look like
      // the user's rehearsals had simply vanished.
      console.error(
        '[user/migrate] partial failure:',
        failures.map(f => `${f.table}: ${f.error!.message}`).join('; ')
      )
      return NextResponse.json(
        { migrated: false, failedTables: failures.map(f => f.table) },
        { status: 500 }
      )
    }

    return NextResponse.json({ migrated: true })
  } catch (err) {
    console.error('[user/migrate]', err)
    return NextResponse.json({ migrated: false }, { status: 500 })
  }
}
