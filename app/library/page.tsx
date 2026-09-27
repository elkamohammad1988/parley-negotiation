import { SCENARIOS, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/negotiation/scenarios'
import { catalogueScenario } from '@/lib/negotiation/redact'
import type { Category } from '@/lib/negotiation/types'
import LibraryClient from './LibraryClient'

// Server half of the library. The mandate is filtered out here, at the server
// boundary, so the client component never imports the scenario module and the
// secrets never reach a JS chunk. See tests/client-bundle-secrets.test.ts.

export default function LibraryPage() {
  const scenarios = SCENARIOS.map(s =>
    catalogueScenario(s, {
      categoryLabel: CATEGORY_LABELS[s.category],
      difficultyLabel: DIFFICULTY_LABELS[s.difficulty],
    })
  )
  const present = new Set<string>(SCENARIOS.map(s => s.category))
  const categories = (Object.keys(CATEGORY_LABELS) as Category[])
    .filter(c => present.has(c))
    .map(c => ({ id: c, label: CATEGORY_LABELS[c] }))

  return <LibraryClient scenarios={scenarios} categories={categories} />
}
