import type { Metadata } from 'next'
import RoomClient from './RoomClient'

// `params` is a Promise in this version of Next — awaited here in a server
// component so the client component below receives a plain string and never
// has to deal with unwrapping it.

export const metadata: Metadata = {
  title: 'Rehearsal — Parley',
  // A live rehearsal is private working material and there is nothing here
  // worth indexing even if a URL leaked.
  robots: { index: false, follow: false },
}

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoomClient rehearsalId={id} />
}
