'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Opens a rehearsal and moves into its room.
//
// Shared by the brief page and the landing's one-click start, which used to be
// the only difference between "try it" and "read about it": a visitor had to
// go landing -> library -> brief -> counterpart before a single real turn.
// Both callers open a room the same way, so the failure handling lives here
// once rather than drifting apart in two copies.

export function useOpenRoom(userId: string) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  /**
   * `minDurationMs` holds the navigation until an entrance animation has had
   * time to finish, so the brief's closing door and the room arrive together.
   */
  async function open(scenarioSlug: string, counterpartId: string, minDurationMs = 0) {
    if (starting || !userId) return
    setStarting(true)
    setError('')
    const began = Date.now()

    // A request that never settles used to leave the button reading "Opening
    // the room", disabled, for as long as the page stayed open: the await
    // never returned, so neither the error branch below nor the catch ever
    // ran, and the only way out was a reload nothing suggested. This is the
    // product's most important control, so it now fails loudly instead.
    //
    // Thirty seconds because opening a room writes a row and asks the model
    // for an opening line; the ceiling is for a request that is never coming
    // back, not for a slow one.
    const abort = new AbortController()
    const timer = window.setTimeout(() => abort.abort(), 30_000)

    try {
      const res = await fetch('/api/rehearsal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, scenarioSlug, counterpartId }),
        signal: abort.signal,
      })
      // A non-JSON body (a proxy's HTML error page, a gateway timeout) would
      // otherwise throw here and be reported as "could not reach the server",
      // which is wrong and unactionable when the server answered.
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(
          data.code === 'quota_exceeded'
            ? `${data.error} Upgrade to keep rehearsing, or come back next month.`
            : data.error || 'Could not open the room.'
        )
        setStarting(false)
        return
      }

      const remaining = Math.max(0, minDurationMs - (Date.now() - began))
      await new Promise(resolve => window.setTimeout(resolve, remaining))
      router.push(`/room/${data.rehearsalId}`)
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'AbortError'
          ? 'The room is taking too long to open. Nothing has been counted against your quota — try again.'
          : 'Could not reach the server. Check your connection and try again.'
      )
      setStarting(false)
    } finally {
      window.clearTimeout(timer)
    }
  }

  return { open, starting, error }
}
