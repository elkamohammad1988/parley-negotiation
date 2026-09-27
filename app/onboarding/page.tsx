import { SCENARIOS, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/negotiation/scenarios'
import { catalogueScenario } from '@/lib/negotiation/redact'
import OnboardingClient from './OnboardingClient'

// Server half of onboarding: the "closest match" step lists every scenario, and
// only the redacted projection may cross to the browser. See
// tests/client-bundle-secrets.test.ts.

export default function OnboardingPage() {
  return (
    <OnboardingClient
      scenarios={SCENARIOS.map(s =>
        catalogueScenario(s, {
          categoryLabel: CATEGORY_LABELS[s.category],
          difficultyLabel: DIFFICULTY_LABELS[s.difficulty],
        })
      )}
    />
  )
}
