import { describe, expect, it } from 'vitest'
import { conversationReminderEmail, welcomeEmail } from '@/lib/emails/templates'
import * as templates from '@/lib/emails/templates'

// Mail is the worst surface in this product for an injection.
//
// A transactional message is signed by the sending domain, so anything that
// gets into its body inherits the product's own authenticity, and it arrives
// somewhere the reader cannot inspect the way they would a page. Every
// template built its HTML by dropping values into a string, and two of those
// values are things a user types: `display_name`, set through
// /api/user/update-profile, and `conversationTitle`, taken from a request body.
// Both are length-bounded and the name passes the safety filter, but that
// filter looks for abuse, not for markup.
//
// So a display name of `<a href="https://elsewhere.example">Click here</a>` was
// a working link in a Parley-branded email.

const PAYLOAD = '<a href="https://elsewhere.example">Click here</a>'

describe('email templates escape everything a user can type', () => {
  it('escapes a display name in the welcome mail', () => {
    const { html } = welcomeEmail(PAYLOAD)

    expect(html).not.toContain('<a href="https://elsewhere.example"')
    expect(html).toContain('&lt;a href=&quot;https://elsewhere.example&quot;&gt;')
  })

  it('escapes both the name and the title in the reminder mail', () => {
    const { html } = conversationReminderEmail(PAYLOAD, PAYLOAD, 3)

    expect(html).not.toContain('<a href="https://elsewhere.example"')
    // The template's own markup is still markup — this is an escaping test, not
    // a "no tags anywhere" test.
    expect(html).toContain('<strong>')
  })

  it('keeps the subject one line and bounded', () => {
    // Plain text, so deliberately NOT html-escaped — an escaped subject shows a
    // literal &amp; in the inbox list. It is normalised instead.
    const { subject } = conversationReminderEmail('Mo', `Renewal\r\ncall${'x'.repeat(400)}`, 1)

    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject.length).toBeLessThanOrEqual(160)
  })

  it('renders normal text untouched', () => {
    const { html, subject } = conversationReminderEmail('Mo', 'Renewal with Northwind', 2)

    expect(html).toContain('Mo, you told us about this one')
    expect(html).toContain('<strong>Renewal with Northwind</strong>')
    expect(subject).toBe('“Renewal with Northwind” is in 2 days')
  })

  it('no longer ships a template whose subject the caller chooses', () => {
    // `billingEmail` took a caller-supplied headline and used it as both the
    // heading and the SUBJECT. Escaping does nothing about a subject line:
    // "Your payment failed — action required", genuinely signed by this domain,
    // is a phishing email whatever the body says. It had no caller.
    expect('billingEmail' in templates).toBe(false)
  })
})
