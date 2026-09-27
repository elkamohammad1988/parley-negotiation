import { SITE_URL } from '@/lib/site-url'

// Transactional email templates.
//
// Two of them, and neither is a re-engagement nudge: nothing here exists to
// manufacture return visits. Parley emails when it has finished work for the
// user, or when their own deadline is close. Nothing else.
//
// ── EVERY INTERPOLATED VALUE IS ESCAPED ─────────────────────────────────────
//
// None of them were. Each template built its HTML by dropping values straight
// into a string, and two of those values are things a user types:
//
//   name               users.display_name, set through /api/user/update-profile.
//                      It is length-bounded and passes the safety filter, but
//                      that filter looks for abuse, not for markup — so a
//                      display name of `<a href="...">Click here</a>` was a
//                      link in a Parley-branded, DKIM-signed message.
//   conversationTitle  taken from the request body.
//
// A mail template is the worst place in a product for this. The message is
// signed by the sending domain, so anything injected into it inherits the
// product's authenticity, and it lands somewhere the recipient cannot inspect
// the way they would a page. `escape` below is applied at every HTML site.
//
// The `billing` template is gone rather than escaped. It took a caller-supplied
// headline and used it as BOTH the heading and the SUBJECT LINE, and escaping
// does nothing about a subject: "Your payment failed — action required",
// genuinely signed by this domain, is a phishing email whatever its body says.
// It had no caller anywhere in the product, so nothing is lost by removing the
// ability. Billing states are confirmed on /billing, which reads Stripe.

/**
 * HTML-escapes a value for interpolation into a template.
 *
 * Subjects deliberately do NOT go through this: they are plain text, not
 * markup, and an escaped subject would show a literal `&amp;` in the client's
 * inbox list. `subjectText` handles that case instead.
 */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A value safe to put in a Subject header: one line, bounded.
 *
 * The transport is JSON over HTTPS rather than SMTP, so a newline here cannot
 * forge a header the way it could in a hand-built message — but a subject is a
 * single line by definition, and a value that arrived from a request body
 * should not be the thing relied on to remember that.
 */
function subjectText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160)
}

const BASE_STYLE = `
  body { margin: 0; padding: 0; background: #f5f3ef; font-family: -apple-system, 'Segoe UI', sans-serif; }
  .wrapper { max-width: 560px; margin: 0 auto; background: #ffffff; }
  .header { padding: 28px 36px 20px; border-bottom: 1px solid rgba(21,23,28,0.10); }
  .logo { font-family: Georgia, serif; font-size: 21px; font-weight: 600; color: #15171c; letter-spacing: -0.02em; }
  .logo span { color: #b4472a; }
  .body { padding: 32px 36px; }
  .h1 { font-family: Georgia, serif; font-size: 24px; font-weight: 600; color: #15171c; margin: 0 0 12px; letter-spacing: -0.02em; }
  .p { font-size: 15px; color: rgba(21,23,28,0.68); line-height: 1.65; margin: 0 0 16px; }
  .btn { display: inline-block; background: #b4472a; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 15px; border-radius: 5px; margin: 6px 0 18px; font-weight: 500; }
  .divider { height: 1px; background: rgba(21,23,28,0.10); margin: 26px 0; }
  .footer { padding: 18px 36px 28px; font-size: 12px; color: rgba(21,23,28,0.38); line-height: 1.65; }
  .footer a { color: rgba(180,71,42,0.85); text-decoration: none; }
`

function shell(title: string, inner: string, footerNote?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${BASE_STYLE}</style></head><body>
<div class="wrapper">
  <div class="header"><span class="logo">Parley<span>.</span></span></div>
  <div class="body">${inner}</div>
  <div class="divider" style="margin:0"></div>
  <div class="footer">
    ${footerNote ?? 'You are receiving this because you have a Parley account.'}
    <br /><a href="${SITE_URL}/settings">Manage what we send you</a>
  </div>
</div>
</body></html>`
}

export function welcomeEmail(name: string): { subject: string; html: string } {
  const greeting = name ? `${escape(name)}, ` : ''
  return {
    subject: 'Welcome to Parley — pick the conversation you are dreading',
    html: shell(
      'Welcome to Parley',
      `<h1 class="h1">One take is not enough</h1>
<p class="p">${greeting}Parley puts you across the table from a counterpart with a real position and a mandate they will not hand over. You rehearse. Then you find out what your version of the conversation actually cost.</p>
<p class="p">Start with whatever is closest to the thing on your calendar. The counterpart is what makes it feel like yours.</p>
<a class="btn" href="${SITE_URL}/library">Open the library</a>
<p class="p" style="font-size:13px;">Your rehearsal transcripts are private to your account and are not used to train models.</p>`
    ),
  }
}

export function conversationReminderEmail(
  name: string,
  conversationTitle: string,
  daysOut: number
): { subject: string; html: string } {
  const when = daysOut <= 0 ? 'today' : daysOut === 1 ? 'tomorrow' : `in ${daysOut} days`
  const greeting = name ? `${escape(name)}, y` : 'Y'
  const title = escape(conversationTitle)

  return {
    subject: subjectText(`“${conversationTitle}” is ${when}`),
    html: shell(
      'An upcoming conversation',
      `<h1 class="h1">${when.charAt(0).toUpperCase()}${when.slice(1)}</h1>
<p class="p">${greeting}ou told us about this one: <strong>${title}</strong>.</p>
<p class="p">${
        daysOut >= 5
          ? 'There is still time to run it more than once. The second attempt, after you know what they were holding, is where scores actually move.'
          : 'One run now is worth more than reading about it one more time.'
      }</p>
<a class="btn" href="${SITE_URL}/dashboard">Rehearse it</a>`,
      'You are getting this because you asked Parley to remind you about this conversation.'
    ),
  }
}

