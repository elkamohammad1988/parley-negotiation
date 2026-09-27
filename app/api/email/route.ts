import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { welcomeEmail, conversationReminderEmail } from '@/lib/emails/templates'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp, verifyOwnership } from '@/lib/ownership'

// Transactional email send. Resend transport reused unchanged.
//
// The set of types this accepts is the whole policy: a welcome, a reminder
// about a conversation the user themselves scheduled, and billing. There is
// deliberately no re-engagement type — the endpoint could not send one if
// something asked it to.
//
// WHAT CHANGED AND WHY — THE RECIPIENT IS NO LONGER AN ARGUMENT. This route
// used to take `to` from the request body with no authentication of any kind.
// That is an open mail relay wearing Parley's verified sending domain: anyone
// could address a Parley-branded message to any inbox in the world, and the
// `billing` type let them choose the headline and most of the body too. The
// cost is not hypothetical — it is a phishing kit for the product's own users
// and a fast route to the sending domain being blocklisted.
//
// The fix is to stop treating the recipient as input. A caller proves which
// account they are (the same gate as every other user-scoped route) and the
// address is read from that account's own row. There is now no request this
// endpoint can be made to send anywhere except to the person making it.

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.EMAIL_FROM

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY || !FROM_EMAIL) {
    console.log('[Email] Resend not configured, skipping:', subject, '→', to)
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })
    return res.ok
  } catch (e) {
    console.error('[Email] Send failed:', e)
    return false
  }
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`email-send:${clientIp(req)}`, 10, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { type, userId, conversationTitle, daysOut } = await req.json()

    const ownership = await verifyOwnership(req, userId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const { data, error } = await supabaseServer
      .from('users')
      .select('email, display_name')
      .eq('id', userId as string)
      .maybeSingle()

    if (error) {
      console.error('[Email] Recipient lookup failed:', error.message)
      return NextResponse.json({ error: 'Could not send.' }, { status: 503 })
    }

    const to = typeof data?.email === 'string' ? data.email.trim() : ''
    // A guest account's address is `guest_<random>@parley-guest.local`, which
    // resolves nowhere. Refusing is more honest than handing Resend a bounce.
    if (!to || to.endsWith('@parley-guest.local')) {
      return NextResponse.json(
        { sent: false, error: 'This account has no address email can be sent to.' },
        { status: 400 }
      )
    }

    const name = typeof data?.display_name === 'string' ? data.display_name : ''
    let email: { subject: string; html: string }

    switch (type) {
      case 'welcome':
        email = welcomeEmail(name)
        break
      case 'conversation_reminder':
        if (!conversationTitle) {
          return NextResponse.json({ error: 'conversationTitle is required.' }, { status: 400 })
        }
        email = conversationReminderEmail(
          name,
          String(conversationTitle).slice(0, 200),
          Number.isFinite(Number(daysOut)) ? Number(daysOut) : 1
        )
        break
      // `billing` was here and is gone. It let the caller choose the heading
      // AND the subject line of a message signed by this product's sending
      // domain, which is a phishing template however well the body is escaped,
      // and nothing in the product ever called it. See lib/emails/templates.ts.
      default:
        return NextResponse.json({ error: 'Unknown email type.' }, { status: 400 })
    }

    const sent = await sendEmail(to, email.subject, email.html)
    return NextResponse.json({ sent })
  } catch (e) {
    console.error('[Email] Route threw:', e)
    return NextResponse.json({ error: 'Could not send.' }, { status: 500 })
  }
}
