import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Support — Parley',
  description: 'Get help with a rehearsal, a debrief, your account or your plan.',
  alternates: { canonical: '/support' },
}

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children
}
