import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getScenario, SCENARIOS, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/negotiation/scenarios'
import { catalogueScenario } from '@/lib/negotiation/redact'
import BriefClient from './BriefClient'

// Scenario briefs are the product's public surface — "is my situation in
// here?" is the question that decides whether someone signs up — so they are
// statically generated and indexable, unlike rehearsals and debriefs.

export function generateStaticParams() {
  return SCENARIOS.map(s => ({ slug: s.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const scenario = getScenario(slug)
  if (!scenario) return { title: 'Scenario — Parley' }

  const description = `${scenario.premise} Rehearse it against ${scenario.counterpartRole.toLowerCase()} and get a scored debrief.`

  return {
    title: `${scenario.title} — Parley`,
    description,
    // Pinned per slug so a brief reached with a tracking parameter on the URL
    // does not compete with itself in the index.
    alternates: { canonical: `/library/${scenario.slug}` },
    openGraph: {
      title: `${scenario.title} — Parley`,
      description,
      url: `/library/${scenario.slug}`,
      type: 'article',
    },
  }
}

export default async function ScenarioBriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const scenario = getScenario(slug)
  if (!scenario) notFound()

  // The mandate is filtered out here, at the server boundary, rather than
  // being passed down and hidden in the UI — it must never be in the page
  // payload at all, where "view source" would find it.
  return (
    <BriefClient
      scenario={catalogueScenario(scenario, {
        categoryLabel: CATEGORY_LABELS[scenario.category],
        difficultyLabel: DIFFICULTY_LABELS[scenario.difficulty],
      })}
    />
  )
}
