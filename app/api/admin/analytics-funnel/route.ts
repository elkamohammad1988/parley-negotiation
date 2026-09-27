import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/adminAuth'
import type { AnalyticsEvent } from '@/lib/analytics'

/** PostgREST's default row ceiling on hosted Supabase. Asking for more is clamped. */
const SAMPLE_CEILING = 1000

// The funnel that matters for this product.
//
// Not sessions or daily actives — the question is whether people get from
// signing up to a scored debrief, because that is the first moment Parley has
// delivered anything. The steps below are in that order deliberately, and the
// biggest drop is expected between starting a rehearsal and finishing one.
//
// /api/admin/* is outside the proxy's /admin/* cookie matcher, so this route
// carries its own guard.
//
// The step COUNTS below are exact — Postgres counts them, nothing crosses the
// wire. The breakdowns underneath are not: they read `properties` row by row,
// and PostgREST caps a response at db-max-rows (1000 on hosted Supabase)
// without saying so. Past that, a scenario ranking built from "every start in
// thirty days" is really built from the most recent thousand while still
// presenting itself as the whole window. Same defect as app/api/admin/stats,
// same treatment: bound it explicitly, order it so the sample is the most
// recent rather than the arbitrary, and report N so the figure states its own
// basis. An exact answer wants a GROUP BY this schema has no RPC for.

const FUNNEL: AnalyticsEvent['name'][] = [
  'signup_started',
  'signup_completed',
  'onboarding_completed',
  'rehearsal_started',
  'rehearsal_ended',
  'debrief_generated',
  'rehearsal_repeated',
  'paywall_viewed',
  'checkout_started',
  'subscription_started',
  'subscription_canceled',
]

export async function GET(req: NextRequest) {
  const refusal = await requireAdmin(req)
  if (refusal) return refusal

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    const counts = Object.fromEntries(
      await Promise.all(
        FUNNEL.map(async name => {
          const { count } = await supabaseServer
            .from('analytics_events')
            .select('id', { count: 'exact', head: true })
            .eq('event_name', name)
            .gte('created_at', thirtyDaysAgo)
          return [name, count || 0]
        })
      )
    )

    // Which scenarios people actually pick. Tells us what to write more of,
    // and which briefs are being opened but not rehearsed.
    const { data: startRows } = await supabaseServer
      .from('analytics_events')
      .select('properties')
      .eq('event_name', 'rehearsal_started')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(SAMPLE_CEILING)

    const byScenario: Record<string, number> = {}
    const byCounterpart: Record<string, number> = {}
    for (const row of startRows || []) {
      const props = (row.properties ?? {}) as { scenario?: string; counterpart?: string }
      if (props.scenario) byScenario[props.scenario] = (byScenario[props.scenario] || 0) + 1
      if (props.counterpart) byCounterpart[props.counterpart] = (byCounterpart[props.counterpart] || 0) + 1
    }

    // Score distribution — a health signal for the debrief prompt itself. If
    // everything clusters in one band, the scoring has stopped discriminating
    // and the debrief is no longer telling anyone anything.
    const { data: debriefRows } = await supabaseServer
      .from('analytics_events')
      .select('properties')
      .eq('event_name', 'debrief_generated')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(SAMPLE_CEILING)

    const scoreBands = { costly: 0, leaking: 0, workable: 0, strong: 0 }
    const outcomes: Record<string, number> = {}
    for (const row of debriefRows || []) {
      const props = (row.properties ?? {}) as { score?: number; outcome?: string }
      const score = typeof props.score === 'number' ? props.score : null
      if (score !== null) {
        if (score >= 75) scoreBands.strong++
        else if (score >= 55) scoreBands.workable++
        else if (score >= 35) scoreBands.leaking++
        else scoreBands.costly++
      }
      if (props.outcome) outcomes[props.outcome] = (outcomes[props.outcome] || 0) + 1
    }

    return NextResponse.json({
      windowDays: 30,
      // Exact.
      counts,
      // Derived from a bounded sample — see the header. `sampledFrom` equal to
      // `sampleCeiling` means the window was larger than what was read.
      byScenario,
      byCounterpart,
      scoreBands,
      outcomes,
      sampleCeiling: SAMPLE_CEILING,
      sampledFrom: {
        starts: (startRows || []).length,
        debriefs: (debriefRows || []).length,
      },
    })
  } catch (e) {
    console.error('[Admin] Funnel query failed:', e)
    return NextResponse.json({ error: 'Could not build the funnel.' }, { status: 500 })
  }
}
