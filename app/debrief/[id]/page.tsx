import type { Metadata } from 'next'
import DebriefClient from './DebriefClient'

export const metadata: Metadata = {
  title: 'Debrief — Parley',
  // A debrief contains the full transcript of a private rehearsal.
  robots: { index: false, follow: false },
}

export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DebriefClient rehearsalId={id} />
}
