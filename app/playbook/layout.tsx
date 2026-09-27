import type { Metadata } from 'next'

// See app/dashboard/layout.tsx for why this exists. Playbook entries are the
// user's own notes, written in their own words about their own negotiations.
export const metadata: Metadata = {
  title: 'Playbook — Parley',
  description: 'Your own notes on what works, traced back to the rehearsal that earned each one.',
  robots: { index: false, follow: false },
}

export default function PlaybookLayout({ children }: { children: React.ReactNode }) {
  return children
}
