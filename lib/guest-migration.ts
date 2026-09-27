'use client'

// Moving a browser-only identity's work onto a real account, from the browser.
//
// There were three copies of this call — the sign-up form, the sign-in form and
// the OAuth callback — and all three had the same two defects.
//
//   They never read the response. `POST /api/user/migrate` answers 403 when it
//   refuses, 500 with a `failedTables` list when some tables moved and others
//   did not, and `{ migrated: false }` when it declined the ids. Every caller
//   discarded all of that and redirected. The browser's parley_uid had already
//   been overwritten with the new account's id by then, so the rehearsals the
//   person had just been reading were addressed under an id the browser no
//   longer held: from the user's side, creating an account deleted their work.
//
//   Two of the three did not await it. A redirect during an in-flight fetch is
//   a cancelled fetch, so the migration a user was promised might never have
//   been attempted.
//
// One definition, awaited, with the outcome reported back. Callers decide what
// to do about a failure; none of them may call it a success.

export type MigrationOutcome =
  | { ok: true }
  /** The server refused, or moved only part of it. Nothing may claim success. */
  | { ok: false; reason: 'refused' | 'partial' | 'unreachable'; failedTables?: string[] }

/**
 * Moves everything held under `oldUserId` to `newUserId`.
 *
 * Safe to call twice: the server's update is filtered on the old id, so a
 * repeat moves nothing and answers `{ migrated: true }` again. That matters
 * because the retry offered on failure is a second call with the same pair,
 * and because a user who signs in again on the same browser sends the same
 * request once more.
 */
export async function migrateGuestData(
  oldUserId: string,
  newUserId: string
): Promise<MigrationOutcome> {
  if (!oldUserId || !newUserId || oldUserId === newUserId) return { ok: true }

  try {
    const res = await fetch('/api/user/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldUserId, newUserId }),
    })

    let body: { migrated?: boolean; failedTables?: string[] } = {}
    try {
      body = await res.json()
    } catch {
      // A response with no JSON body is a failure like any other.
    }

    if (res.ok && body.migrated) return { ok: true }

    if (Array.isArray(body.failedTables) && body.failedTables.length > 0) {
      console.error('[Migrate] Partial failure:', body.failedTables.join(', '))
      return { ok: false, reason: 'partial', failedTables: body.failedTables }
    }

    console.error('[Migrate] Refused:', res.status)
    return { ok: false, reason: 'refused' }
  } catch (e) {
    console.error('[Migrate] Could not reach the server:', e)
    return { ok: false, reason: 'unreachable' }
  }
}

/**
 * The path to return to after signing in, from an untrusted `?next=`.
 *
 * The debrief asks people to create an account in order to keep the debrief
 * they are looking at, so it sends them where to come back to. That value
 * arrives in a query string, which means it arrives from anywhere — so it is
 * accepted only as a path on this site, never as a URL. A single leading slash
 * not followed by another slash or a backslash rules out `//evil.example` and
 * `/\evil.example`, both of which browsers resolve as protocol-relative
 * absolute URLs; the explicit scheme check rules out `javascript:` and friends
 * reaching a `location` assignment.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length > 512) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return value
}

const NEXT_KEY = 'parley_after_auth'

/**
 * Holds the return path across a round trip this app does not control.
 *
 * Google OAuth leaves the site and comes back to /auth/callback, and the email
 * confirmation link arrives from Supabase; neither carries a query string this
 * code put there. Appending `?next=` to the OAuth `redirectTo` would be the
 * obvious alternative, but that URL has to match the redirect allowlist on the
 * Supabase project, which is configuration this repository cannot see — so the
 * destination waits in localStorage instead, where nothing external has to
 * agree to it.
 */
export function rememberNext(path: string | null): void {
  try {
    if (path) localStorage.setItem(NEXT_KEY, path)
    else localStorage.removeItem(NEXT_KEY)
  } catch {
    // Unwritable storage just means the default destination is used.
  }
}

/** Reads and clears the remembered path, so it is honoured exactly once. */
export function takeNext(): string | null {
  try {
    const stored = localStorage.getItem(NEXT_KEY)
    localStorage.removeItem(NEXT_KEY)
    return safeNextPath(stored)
  } catch {
    return null
  }
}
