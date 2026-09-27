import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, requireAuthenticated, verifyOwnership } from '@/lib/ownership'
import { loadTurns, listRehearsals } from '@/lib/rehearsals'

// Account export and deletion.
//
// Both are self-serve and immediate. No email round-trip, no retention offer,
// no cooling-off period — anyone who has typed what they actually plan to say
// to their employer into this product is entitled to take it back without
// negotiating for it.

/** Everything the account holds, as one JSON document. */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  const rl = checkRateLimit(`account-export:${clientIp(req)}`, 5, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const uid = userId as string

  try {
    const [rehearsals, debriefs, playbook, counterparts, conversations, user] = await Promise.all([
      listRehearsals(uid, 500),
      supabase.from('debriefs').select('*').eq('user_id', uid),
      supabase.from('playbook_entries').select('*').eq('user_id', uid),
      supabase.from('custom_counterparts').select('*').eq('user_id', uid),
      supabase.from('upcoming_conversations').select('*').eq('user_id', uid),
      supabase.from('users').select('id, email, display_name, created_at').eq('id', uid).maybeSingle(),
    ])

    // Transcripts are the point of the export — a list of rehearsals without
    // what was actually said would not be the user's data in any meaningful
    // sense.
    const withTranscripts = await Promise.all(
      rehearsals.map(async r => ({
        ...r,
        turns: (await loadTurns(r.id)).map(t => ({
          side: t.side,
          content: t.content,
          position: t.position,
          createdAt: t.createdAt,
        })),
      }))
    )

    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        account: user.data ?? null,
        rehearsals: withTranscripts,
        debriefs: debriefs.data ?? [],
        playbook: playbook.data ?? [],
        customCounterparts: counterparts.data ?? [],
        upcomingConversations: conversations.data ?? [],
      },
      {
        headers: {
          'Content-Disposition': `attachment; filename="parley-export-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      }
    )
  } catch (e) {
    console.error('[Account] Export failed:', e)
    return NextResponse.json({ error: 'Could not build the export.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const rl = checkRateLimit(`account-delete:${clientIp(req)}`, 3, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { userId, confirm } = await req.json()
    if (confirm !== 'DELETE_MY_ACCOUNT') {
      return NextResponse.json({ error: 'Missing confirmation.' }, { status: 400 })
    }

    // Irreversible and total. A device token only proves this browser once
    // used the id; erasing someone's entire history needs a current session.
    const ownership = await requireAuthenticated(req, userId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }
    const uid = userId as string

    // rehearsal_turns is not listed: it cascades from rehearsals. Deleting it
    // separately would be a no-op at best and a partial delete at worst if the
    // rehearsals delete failed.
    //
    // critical_violations is deliberately NOT deleted. Retaining it is a legal
    // obligation (18 U.S.C. §2258A), it is disclosed on the privacy page, and
    // it holds a hash and a short excerpt rather than a readable transcript.
    const tables = [
      'debriefs',
      'rehearsals',
      'playbook_entries',
      'custom_counterparts',
      'upcoming_conversations',
      'usage_daily',
      'safety_flags',
      'analytics_events',
      'subscriptions',
    ]

    const results = await Promise.allSettled(
      tables.map(t => supabase.from(t).delete().eq('user_id', uid))
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error('[Account] Delete failed for', tables[i], r.reason)
    })

    await supabase.from('users').delete().eq('id', uid)
    await supabase.auth.admin.deleteUser(uid).catch(() => {})

    return NextResponse.json({ deleted: true })
  } catch (e) {
    console.error('[Account] Deletion failed:', e)
    return NextResponse.json({ error: 'Could not complete the deletion.' }, { status: 500 })
  }
}
