'use client'
import { useSyncExternalStore } from 'react'
import { getUserId } from '@/lib/user-id'

// Reads the anonymous device id.
//
// The id lives in localStorage, so it cannot be read during server rendering —
// which is why every page previously did `useState('')` plus a mount effect
// that immediately called `setUserId`. That works, but it is a setState inside
// an effect body, which cascades an extra render on every page and is exactly
// what `useSyncExternalStore` exists to replace.
//
// The store never changes during a session (the id is generated once and then
// stable), so `subscribe` is a no-op that returns an empty unsubscribe. The
// server snapshot is the empty string, matching what the browser renders
// before hydration, so there is no mismatch.

const EMPTY = ''

function subscribe(): () => void {
  return () => {}
}

function getSnapshot(): string {
  // getUserId is idempotent and returns the same string on every call after
  // the first, which is what keeps this snapshot stable — an unstable
  // snapshot here would loop forever.
  return getUserId()
}

function getServerSnapshot(): string {
  return EMPTY
}

/**
 * Returns the device id, or an empty string during SSR and the first paint.
 * Callers should treat the empty string as "not ready yet" and skip fetching.
 */
export function useUserId(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
