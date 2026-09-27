'use client'
import { useSyncExternalStore } from 'react'

// Whether this browser holds an account the person could sign back into.
//
// Sign-in state lives in localStorage — parley_uid plus the parley_authenticated
// flag that sign-up, sign-in and the OAuth callback all set — so it is read as
// the external store it is, the same way lib/hooks/useUserId reads the id. The
// server snapshot is false so the markup rendered on the server and the markup
// hydrated in the browser agree, and the value is re-read on every render, so
// navigating after a sign-in updates without a remount.
//
// This is a display hint and nothing more: every route that matters checks
// authorisation on the server. What it decides is which chrome to draw — the
// Nav's signed-in links, and whether a debrief says it is saved to this
// browser only. It used to be a private function inside Nav; it lives here so
// there is one definition of "signed in" rather than two that can drift.
//
// THE GUEST EXCEPTION. "Try one without an account" on the sign-up page does
// create a Supabase user — `guest_<random>@parley-guest.local`, with a password
// generated on the spot and shown to nobody. That address cannot receive mail,
// so the reset link cannot be used, so there is no sequence of actions by which
// anyone signs into that account ever again. It is reachable from exactly one
// browser's localStorage and from nowhere else, which is the same position as
// having no account at all.
//
// It nevertheless set parley_authenticated, and this hook believed it. The
// product therefore drew its signed-in chrome and, worse, suppressed the
// debrief's "saved to this browser only" notice for the one user whose work was
// most precariously held. A flag that says "an account is keeping this safe"
// must not be true for an account that cannot be returned to, so the guest path
// now marks itself and this hook reads that mark. Every path that produces a
// real, recoverable account clears it.
//
// The mark is absent for browsers that took the guest path before 2026-09-14;
// nothing can be inferred retroactively, and those sessions keep reading as
// signed in until they sign in for real.

/**
 * Set while this browser is on a throwaway guest account. Exported so the
 * sign-up page marks and clears it through one name rather than a literal
 * repeated across five call sites.
 */
export const GUEST_KEY = 'parley_guest'

/** Marks this browser as holding a guest account that cannot be signed back into. */
export function markGuestAccount(): void {
  try {
    localStorage.setItem(GUEST_KEY, 'true')
  } catch {
    // Same reasoning as getSnapshot: unwritable storage reads as no account,
    // which is the conservative answer here too.
  }
}

/** Clears the mark. Called by every path that produces a recoverable account. */
export function clearGuestAccount(): void {
  try {
    localStorage.removeItem(GUEST_KEY)
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

/**
 * The decision itself, over a plain reader, so the three keys it weighs can be
 * tested without a browser or a React renderer. `getSnapshot` is then only the
 * part that knows where the keys live.
 */
export function signedInFrom(read: (key: string) => string | null): boolean {
  return (
    !!read('parley_uid') &&
    read('parley_authenticated') === 'true' &&
    read(GUEST_KEY) !== 'true'
  )
}

function getSnapshot(): boolean {
  try {
    return signedInFrom(key => localStorage.getItem(key))
  } catch {
    // Storage can throw in a private window or with site data blocked. No
    // storage means no account this browser can vouch for.
    return false
  }
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * True when this browser holds an account that can be signed back into. False
 * during SSR, for a browser-only identity, and for a throwaway guest account.
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
