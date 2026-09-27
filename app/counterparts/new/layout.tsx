import type { Metadata } from 'next'

// The builder describes a real person the user is about to face, often by
// name. Nothing about it belongs in a search result.
export const metadata: Metadata = {
  title: 'New counterpart — Parley',
  description: 'Describe the person you are about to negotiate with, and rehearse against them.',
  robots: { index: false, follow: false },
  // Cleared rather than inherited. The parent layout canonicalises to
  // /counterparts, and a noindex page pointing its canonical at an indexable
  // one is the combination that can get the noindex applied to the target
  // instead. A page nobody should index needs no canonical at all.
  alternates: { canonical: null },
}

export default function NewCounterpartLayout({ children }: { children: React.ReactNode }) {
  return children
}
