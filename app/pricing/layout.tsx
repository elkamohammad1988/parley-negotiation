import type { Metadata } from 'next'

// Pricing is in the sitemap and was inheriting the root title, so the page a
// visitor searches for by name did not carry its name.
//
// The description deliberately states no figure. Prices in lib/plans.ts are
// placeholder configuration until they are reconciled with the live Stripe
// products, and a number in a meta description is a claim that outlives the
// page it was copied from — search engines cache it, and so do people.
export const metadata: Metadata = {
  title: 'Pricing — Parley',
  description:
    'Parley meters rehearsals per month. Free to try one; paid plans add more rehearsals, custom counterparts and progress across sessions.',
  alternates: { canonical: '/pricing' },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
