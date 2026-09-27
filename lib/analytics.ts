import { supabaseServer as supabase } from './supabase-server'

// Every event this app tracks — a closed whitelist, not a generic logger.
//
// Properties are metadata only: plan, scenario SLUG, counterpart ID, counts,
// scores, booleans. NEVER transcript text, playbook notes, custom counterpart
// descriptions, or anything else the user typed. Rehearsal transcripts are
// unusually candid — what someone plans to say to their employer about their
// pay — and the single rule that keeps that safe is that free text never
// reaches this table. If you are tempted to add a string the user wrote, don't.
export type AnalyticsEvent =
  | { name: 'signup_started'; properties: { method: 'email' | 'guest' } }
  | { name: 'signup_completed'; properties: { method: 'email' | 'guest' } }
  | { name: 'onboarding_completed'; properties: { hasDatedConversation: boolean } }
  | { name: 'rehearsal_started'; properties: { scenario: string; counterpart: string; plan: string } }
  | { name: 'rehearsal_turn'; properties: { scenario: string; counterpart: string; plan: string } }
  | { name: 'rehearsal_ended'; properties: { status: string } }
  | { name: 'debrief_generated'; properties: { scenario: string; score: number; outcome: string } }
  | { name: 'rehearsal_repeated'; properties: { scenario: string; attempt: number } }
  | { name: 'playbook_entry_added'; properties: { fromDebrief: boolean } }
  | { name: 'counterpart_created'; properties: Record<string, never> }
  | { name: 'paywall_viewed'; properties: { source: 'pricing_page' | 'quota_exhausted' | 'progress_locked' } }
  | { name: 'checkout_started'; properties: { plan: string; interval: 'monthly' | 'annual' } }
  | { name: 'subscription_started'; properties: { plan: string } }
  | { name: 'subscription_canceled'; properties: Record<string, never> }

// Fire-and-forget. An analytics outage must never block or slow a product
// action — least of all a turn in a live rehearsal that is on a clock.
export async function trackEvent(
  event: AnalyticsEvent,
  userId: string | null | undefined
): Promise<void> {
  try {
    const { error } = await supabase.from('analytics_events').insert({
      event_name: event.name,
      user_id: userId || null,
      properties: event.properties,
    })
    if (error) {
      console.error('[Analytics] Failed to record event:', event.name, error.message)
    }
  } catch (e) {
    console.error('[Analytics] trackEvent threw:', event.name, e)
  }
}
