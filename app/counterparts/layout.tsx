import type { Metadata } from 'next'

// The built-in bench is public — it is most of the pitch, and the API returns
// it to an unauthenticated caller for that reason. A signed-in visitor also
// sees their own custom counterparts here, but those are fetched client-side
// and are never in the crawled document.
export const metadata: Metadata = {
  title: 'Counterparts — Parley',
  description:
    'Who the vendor puts on the call: the measured account director, the quarter-end closer, the one who agrees with everything and then does nothing. Or describe your own.',
  alternates: { canonical: '/counterparts' },
}

export default function CounterpartsLayout({ children }: { children: React.ReactNode }) {
  return children
}
