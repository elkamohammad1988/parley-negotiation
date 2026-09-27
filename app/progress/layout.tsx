import type { Metadata } from 'next'

// See app/dashboard/layout.tsx.
export const metadata: Metadata = {
  title: 'Progress — Parley',
  description: 'Your scores across the five dimensions, and what keeps getting left on the table.',
  robots: { index: false, follow: false },
}

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return children
}
