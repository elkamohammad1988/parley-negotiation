import type { Metadata } from 'next'

// A maintenance notice indexed as though it were the product would be the
// worst possible first impression, and it would outlive the outage.
export const metadata: Metadata = {
  title: 'Back shortly — Parley',
  description: 'Parley is briefly unavailable.',
  robots: { index: false, follow: false },
}

export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return children
}
