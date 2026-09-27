import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'
import { verifyOwnership } from '@/lib/ownership'
import { DIMENSION_IDS } from '@/lib/negotiation/dimensions'
import { getUserPlan } from '@/lib/rehearsals'
import { hasFeature } from '@/lib/plans'
import type { DimensionId, DimensionScore, LeverKind } from '@/lib/negotiation/types'

// Skill trajectory across rehearsals.
//
// The unit of progress here is a dimension score over time, not a streak or a
// total. That is the point of difference worth protecting: a user should be
// able to see that their Information gain has moved from the 30s to the 60s
// over eleven rehearsals, and that their Close has not moved at all. A count
// of sessions completed would tell them nothing they could act on.

interface DebriefHistoryRow {
  overall_score: number
  dimensions: unknown
  levers: unknown
  created_at: string
  rehearsal_id: string
}

/**
 * What the user has and has not been getting out of counterparts, summed
 * across every rehearsal they have been scored on.
 *
 * A dimension trend answers "am I improving"; this answers "at what". Because
 * the levers are a closed, authored set with a kind on each, the answer is a
 * specific, checkable sentence — "you have surfaced eleven of the forty-five
 * things that were on the table, and you have never once found a non-price
 * trade" — rather than a number that moved. It is also the one figure here
 * that cannot be produced by reading transcripts: it needs the ground truth
 * the scenarios were written with.
 */
export interface LeverHistory {
  found: number
  total: number
  /** Per lever kind, so a blind spot has a name. Only kinds actually faced. */
  byKind: { kind: LeverKind; found: number; total: number }[]
  /** Rehearsals where a lever that cost the counterpart nothing went unfound. */
  freeMissRehearsals: number
  /** Rehearsals that carried a ledger at all. Pre-levers debriefs have none. */
  rehearsals: number
}

const LEVER_KINDS: LeverKind[] = ['price', 'trade', 'intel', 'immovable']

/** Reads one stored ledger, ignoring anything malformed. */
function ledgerOf(raw: unknown): { kind: LeverKind; found: boolean; free: boolean }[] {
  if (!Array.isArray(raw)) return []
  const out: { kind: LeverKind; found: boolean; free: boolean }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    if (!LEVER_KINDS.includes(l.kind as LeverKind)) continue
    out.push({ kind: l.kind as LeverKind, found: l.found === true, free: l.free === true })
  }
  return out
}

function leverHistoryOf(rows: DebriefHistoryRow[]): LeverHistory {
  const totals = new Map<LeverKind, { found: number; total: number }>()
  let found = 0
  let total = 0
  let freeMissRehearsals = 0
  let rehearsals = 0

  for (const row of rows) {
    const ledger = ledgerOf(row.levers)
    if (ledger.length === 0) continue
    rehearsals += 1
    if (ledger.some(l => l.free && !l.found)) freeMissRehearsals += 1
    for (const lever of ledger) {
      total += 1
      if (lever.found) found += 1
      const bucket = totals.get(lever.kind) ?? { found: 0, total: 0 }
      bucket.total += 1
      if (lever.found) bucket.found += 1
      totals.set(lever.kind, bucket)
    }
  }

  return {
    found,
    total,
    // Ordered by the kind list rather than by insertion, so the breakdown reads
    // the same way on every visit.
    byKind: LEVER_KINDS.filter(k => totals.has(k)).map(kind => ({ kind, ...totals.get(kind)! })),
    freeMissRehearsals,
    rehearsals,
  }
}

export interface DimensionTrend {
  dimension: DimensionId
  /** Chronological scores, oldest first. */
  series: number[]
  latest: number | null
  /** Mean of the first third vs the last third. Null until there are enough. */
  movement: number | null
}

/**
 * Compares the earliest third of the history against the most recent third.
 * A plain first-vs-last comparison swings wildly on one bad session; thirds
 * are stable enough to be worth showing and simple enough to explain.
 */
function movementOf(series: number[]): number | null {
  if (series.length < 6) return null
  const size = Math.floor(series.length / 3)
  const early = series.slice(0, size)
  const recent = series.slice(-size)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.round(mean(recent) - mean(early))
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  const ownership = await verifyOwnership(req, userId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const uid = userId as string

  const plan = await getUserPlan(uid)

  const { data, error } = await supabase
    .from('debriefs')
    .select('overall_score, dimensions, levers, created_at, rehearsal_id')
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[Progress] History load failed:', error.message)
    return NextResponse.json(
      { error: 'Could not read your history.' },
      { status: 503 }
    )
  }

  const rows = (data ?? []) as DebriefHistoryRow[]

  const byDimension = new Map<DimensionId, number[]>()
  for (const id of DIMENSION_IDS) byDimension.set(id, [])

  for (const row of rows) {
    const dims = Array.isArray(row.dimensions) ? (row.dimensions as DimensionScore[]) : []
    for (const d of dims) {
      const bucket = byDimension.get(d.dimension)
      if (bucket && typeof d.score === 'number') bucket.push(d.score)
    }
  }

  const trends: DimensionTrend[] = DIMENSION_IDS.map(id => {
    const series = byDimension.get(id) ?? []
    return {
      dimension: id,
      series,
      latest: series.length > 0 ? series[series.length - 1] : null,
      movement: movementOf(series),
    }
  })

  // Trends are a paid feature, but the count and the latest scores are not —
  // showing someone the shape of what they are missing is more honest than an
  // empty page, and it is the only place the paywall appears in this flow.
  const locked = !hasFeature(plan, 'progressTrends')

  return NextResponse.json({
    trends: locked ? trends.map(t => ({ ...t, series: t.series.slice(-1) })) : trends,
    overall: locked ? [] : rows.map(r => ({ score: r.overall_score, at: r.created_at, rehearsalId: r.rehearsal_id })),
    rehearsalCount: rows.length,
    // Not gated. The lever history is the clearest evidence in the product
    // that a second rehearsal is worth running, which makes it the wrong thing
    // to hide from someone deciding whether to keep going — and unlike the
    // trends it says nothing about movement over time, which is what the paid
    // feature actually is.
    levers: leverHistoryOf(rows),
    locked,
    plan,
  })
}
