// Browser-side analytics helper — posts to /api/analytics, which validates
// the event name against a whitelist and does the actual Supabase insert
// server-side (see lib/analytics.ts). Genuinely fire-and-forget: unlike the
// server-side trackEvent() calls (which are awaited to survive serverless
// termination), a dropped client-side analytics call has no such risk and
// must never block or surface an error to the user over something this
// non-critical.
export function trackClientEvent(
  event:
    | 'signup_started'
    | 'signup_completed'
    | 'onboarding_completed'
    | 'paywall_viewed'
    | 'checkout_started'
    | 'playbook_entry_added'
    | 'counterpart_created',
  properties: Record<string, unknown>,
  userId?: string | null
): void {
  try {
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, properties, userId: userId || undefined }),
    }).catch(() => {})
  } catch {
    /* never throw over analytics */
  }
}
