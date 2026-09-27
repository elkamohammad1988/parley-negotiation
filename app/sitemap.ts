import { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site-url'
import { SCENARIOS } from '@/lib/negotiation/scenarios'

// Scenario briefs are the highest-value indexable pages in the product —
// someone searching for their exact situation should be able to land directly
// on the brief for it — so they are generated from the library rather than
// hand-listed, and cannot drift out of sync when a scenario is added.
//
// Nothing under /room, /debrief, /dashboard, /playbook or /progress appears
// here: all of it is private working material.

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/library`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/counterparts`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/support`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/status`, lastModified: now, changeFrequency: 'weekly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  const scenarioPages: MetadataRoute.Sitemap = SCENARIOS.map(s => ({
    url: `${base}/library/${s.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))

  return [...staticPages, ...scenarioPages]
}
