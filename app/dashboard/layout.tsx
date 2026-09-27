import type { Metadata } from 'next'

// A client component cannot export metadata, so the private surfaces each get
// a layout whose only job is to say "not for search". robots.txt already
// disallows these paths, but a Disallow only stops the crawl — a URL that is
// linked from anywhere can still be indexed without being fetched, which is
// exactly how a private page ends up in a result with no snippet. The header
// this emits is the part that actually keeps it out.
export const metadata: Metadata = {
  title: 'Dashboard — Parley',
  description: 'The conversation you are preparing for, and the rehearsals behind it.',
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
