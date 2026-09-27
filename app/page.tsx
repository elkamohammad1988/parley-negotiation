import { SCENARIOS, CATEGORY_LABELS, DIFFICULTY_LABELS, getScenario } from '@/lib/negotiation/scenarios'
import { catalogueScenario, landingScenario } from '@/lib/negotiation/redact'
import type { Scenario } from '@/lib/negotiation/types'
import LandingClient from './LandingClient'

// The landing is interactive, so it lives in LandingClient. This server page
// exists for one reason: the scenario library holds every counterpart's hidden
// mandate, and a client component that imports it ships all of them in a
// public JS chunk. The projections below are the only scenario data that
// crosses to the browser. tests/client-bundle-secrets.test.ts holds the line.

const labels = (s: Scenario) => ({
  categoryLabel: CATEGORY_LABELS[s.category],
  difficultyLabel: DIFFICULTY_LABELS[s.difficulty],
})

export default function Home() {
  const hero = getScenario('renewal-uplift') ?? SCENARIOS[0]
  return (
    <LandingClient
      hero={landingScenario(hero, labels(hero))}
      scenarios={SCENARIOS.map(s => catalogueScenario(s, labels(s)))}
    />
  )
}
