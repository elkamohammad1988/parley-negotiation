import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/adminAuth'
import { PLAN_ORDER, PLAN_PRICES, type Plan } from '@/lib/plans'

// Matches PostgREST's default `db-max-rows` on hosted Supabase. Asking for more
// does not get more — the server clamps it — so this states the real ceiling
// rather than implying a larger one.
const STAT_SAMPLE = 1000

export const maxDuration = 30

// Operational stats.
//
// The measures are the product's own: rehearsals rather than messages, and
// completion rather than volume. "Messages sent" was the right metric for a
// product that wanted people talking as long as possible; here a rehearsal
// that runs forever is a failure, so what gets watched is how many rehearsals
// reach a debrief.
//
// MRR is derived from the same price table the pricing page renders, so the
// two cannot disagree.
//
// ── WHY THE PLAN COUNTS ARE COUNTS AND THE REST IS A DISCLOSED SAMPLE ───────
//
// Three of these figures used to be built by selecting an entire table and
// reducing it in JavaScript: every subscriptions row, every rehearsal's
// scenario_slug, every debrief's overall_score. PostgREST caps a response at
// `db-max-rows` — 1000 on hosted Supabase — and it does that SILENTLY, with no
// error and no flag. So the moment this project passed a thousand
// subscriptions, MRR started reporting a fraction of itself and looked exactly
// as authoritative as before. A dashboard that is quietly wrong is worse than
// one that is missing.
//
// MRR, the plan breakdown and the paid total are money, so they are now exact:
// one `head: true` count per plan, computed by Postgres, bounded by definition.
//
// The mean score and the scenario ranking are directional, and an exact answer
// needs a GROUP BY this schema has no RPC for — a migration, which is a
// reviewed change rather than something to slip into an audit. They are
// therefore an explicit most-recent-N sample, with N reported in the response
// so the number says what it is. Making the truncation visible is the fix;
// making it exact is ROADMAP work.

export async function GET(req: NextRequest) {
  const refusal = await requireAdmin(req)
  if (refusal) return refusal

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = today.toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    const [
      totalUsers,
      newUsersToday,
      totalRehearsals,
      rehearsalsToday,
      completedRehearsals,
      totalDebriefs,
      recentRehearsals,
      totalFlags,
      criticalFlags,
      scenarioRows,
      scoreRows,
    ] = await Promise.all([
      supabaseServer.from('users').select('*', { count: 'exact', head: true }),
      supabaseServer.from('users').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabaseServer.from('rehearsals').select('*', { count: 'exact', head: true }),
      supabaseServer.from('rehearsals').select('*', { count: 'exact', head: true }).gte('started_at', todayIso),
      // A rehearsal that reached the end of its life: closed, or closed and
      // then scored. 'ended' alone would undercount every rehearsal whose
      // debrief has been generated, which is most of them.
      supabaseServer.from('rehearsals').select('*', { count: 'exact', head: true }).in('status', ['ended', 'debriefed']),
      supabaseServer.from('debriefs').select('*', { count: 'exact', head: true }),
      // Distinct users are counted in JS from these rows, so this scan is
      // capped like the two below it and reports what it was taken over.
      supabaseServer
        .from('rehearsals')
        .select('user_id')
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(STAT_SAMPLE),
      supabaseServer.from('safety_flags').select('*', { count: 'exact', head: true }),
      supabaseServer
        .from('critical_violations')
        .select('*', { count: 'exact', head: true }),
      // Bounded and ordered, so the sample is "the most recent N" rather than
      // "whatever the database happened to return first".
      supabaseServer
        .from('rehearsals')
        .select('scenario_slug')
        .order('started_at', { ascending: false })
        .limit(STAT_SAMPLE),
      supabaseServer
        .from('debriefs')
        .select('overall_score')
        .order('created_at', { ascending: false })
        .limit(STAT_SAMPLE),
    ])

    // One exact count per plan. Postgres does the counting, so no row ever
    // crosses the wire and no cap can truncate the answer.
    const planCountResults = await Promise.all(
      PLAN_ORDER.map(plan =>
        supabaseServer
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('plan', plan)
          .eq('status', 'active')
      )
    )

    const activeUsers = new Set(
      (recentRehearsals.data || []).map((r: { user_id: string }) => r.user_id)
    ).size

    const planCounts: Record<string, number> = {}
    PLAN_ORDER.forEach((plan, i) => {
      planCounts[plan] = planCountResults[i].count ?? 0
    })

    // Prices are display strings ("$19"); parsed here rather than duplicated
    // as numbers, so a price change in one place cannot silently skew MRR.
    const mrr = PLAN_ORDER.reduce((sum, plan: Plan) => {
      const count = planCounts[plan] || 0
      const price = Number(PLAN_PRICES[plan].monthly.replace(/[^0-9.]/g, '')) || 0
      return sum + price * count
    }, 0)

    const scenarioCounts: Record<string, number> = {}
    ;(scenarioRows.data || []).forEach((r: { scenario_slug: string }) => {
      scenarioCounts[r.scenario_slug] = (scenarioCounts[r.scenario_slug] || 0) + 1
    })
    const topScenarios = Object.entries(scenarioCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([slug, count]) => ({ slug, count }))

    const scores = (scoreRows.data || [])
      .map((d: { overall_score: number }) => d.overall_score)
      .filter((s: number) => typeof s === 'number')
    const meanScore = scores.length > 0
      ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
      : null

    const started = totalRehearsals.count ?? 0
    const debriefed = totalDebriefs.count ?? 0

    return NextResponse.json({
      users: {
        total: totalUsers.count ?? 0,
        newToday: newUsersToday.count ?? 0,
        activeLast7Days: activeUsers,
        // Rows the distinct count was taken over, not the distinct count
        // itself. Equal to the ceiling means more rehearsals happened in the
        // window than were read, so this is a floor rather than a total.
        activeSampledFrom: (recentRehearsals.data || []).length,
      },
      rehearsals: {
        total: started,
        today: rehearsalsToday.count ?? 0,
        completed: completedRehearsals.count ?? 0,
        debriefed,
        // The number that matters: of everyone who opened a room, how many
        // reached the thing the product is actually for.
        debriefRate: started > 0 ? `${Math.round((debriefed / started) * 100)}%` : '—',
        meanScore,
        // How many debriefs the mean was taken over. Equal to STAT_SAMPLE means
        // it is a sample of the most recent N, not an all-time average.
        meanScoreSampledFrom: scores.length,
      },
      safety: {
        totalFlags: totalFlags.count ?? 0,
        criticalViolations: criticalFlags.count ?? 0,
      },
      subscriptions: {
        breakdown: planCounts,
        totalPaid: Object.values(planCounts).reduce((a, b) => a + b, 0),
        mrr: mrr.toFixed(2),
        arr: (mrr * 12).toFixed(2),
      },
      library: { topScenarios, sampledFrom: (scenarioRows.data || []).length },
      // The ceiling the two sampled figures above were computed under.
      sampleCeiling: STAT_SAMPLE,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[Admin Stats]', err)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
