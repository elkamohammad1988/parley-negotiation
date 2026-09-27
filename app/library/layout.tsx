import type { Metadata } from 'next'

// The library is the product's most valuable indexable page after the landing:
// someone searching for their exact renewal should be able to land on the list
// of deals and recognise it. It is a client component, so it could not carry
// its own metadata and was inheriting the root title — every scenario page had
// a specific title in search results and the page that links to all of them did
// not.
export const metadata: Metadata = {
  title: 'Deal library — Parley',
  description:
    'Every renewal Parley can rehearse: the 22% uplift, the "best and final" that is an approval limit, the upsell bundled in to hide the baseline. Pick the one that looks like yours.',
  alternates: { canonical: '/library' },
  openGraph: {
    title: 'Deal library — Parley',
    description: 'Vendor renewal scenarios to rehearse, each with a counterpart holding a mandate you cannot see.',
    url: '/library',
  },
}

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return children
}
