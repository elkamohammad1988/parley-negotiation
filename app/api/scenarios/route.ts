import { NextRequest, NextResponse } from 'next/server'
import { CATEGORY_LABELS, DIFFICULTY_LABELS, SCENARIOS } from '@/lib/negotiation/scenarios'
import { catalogueScenario } from '@/lib/negotiation/redact'

// The scenario library.
//
// Everything here is public and static — a scenario's premise, objective and
// constraints are exactly what a visitor should be able to read before signing
// up, because "is my situation in here?" is the question that decides whether
// they try the product at all.
//
// The hidden mandate is never included. The projection lives in
// lib/negotiation/redact.ts, which is an allow-list whose return type cannot
// hold a mandate — so adding a field to Scenario cannot start leaking the
// answer here or at any other boundary.

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category')
  const slug = req.nextUrl.searchParams.get('slug')

  const source = slug
    ? SCENARIOS.filter(s => s.slug === slug)
    : category
      ? SCENARIOS.filter(s => s.category === category)
      : SCENARIOS

  const scenarios = source.map(s =>
    catalogueScenario(s, {
      categoryLabel: CATEGORY_LABELS[s.category],
      difficultyLabel: DIFFICULTY_LABELS[s.difficulty],
    })
  )

  if (slug && scenarios.length === 0) {
    return NextResponse.json({ error: 'Unknown scenario.' }, { status: 404 })
  }

  return NextResponse.json({
    scenarios,
    categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
  })
}
