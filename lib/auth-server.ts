import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

// Server-side verification of a real Supabase Auth session.
//
// Every Parley user is a Supabase Auth user — email sign-up and the guest path
// both go through supabase.auth.signUp — but until now nothing on the server
// ever checked that. Ownership rested entirely on lib/ownership.ts's device
// token, which is a soft binding, not authentication. Rehearsal transcripts
// are candid work material and deserve better than "presented the right
// cookie once".
//
// WHY A COOKIE AND NOT AN AUTHORIZATION HEADER
// The session already lives in localStorage (supabase-js owns it, storageKey
// 'parley-auth-session'). Threading a bearer header through ~40 client call
// sites would be a large, error-prone diff whose failure mode is silent: miss
// one and that route quietly drops back to the weaker check. Mirroring the
// access token into a same-origin cookie is verified in ONE place instead, and
// it costs nothing in exposure — a token readable by JS in localStorage is
// equally readable in a non-httpOnly cookie, so this is not a new attack
// surface, just a different transport for the same secret.
//
// CSRF is covered by three things together: the cookie is SameSite=Lax so it
// is not sent on cross-site POSTs, every mutating route requires
// Content-Type: application/json (which forces a CORS preflight cross-origin),
// and no CORS headers are served, so the preflight fails.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

/** Name of the cookie the browser mirrors the access token into. */
export const ACCESS_TOKEN_COOKIE = 'parley_at'

// A client with the ANON key, used only to resolve a JWT to a user. The
// service-role client must never be used for this: service_role bypasses
// everything and would happily describe any user.
const authClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// getUser() is a network round trip to Supabase's auth server. Access tokens
// are valid for an hour and are immutable, so the answer for a given token
// cannot change within the TTL below — caching it turns a per-request hop into
// a per-token one on a warm instance. Deliberately short anyway, so a signed
// out or deleted user stops verifying quickly.
//
// Process-local, like lib/cache.ts: on serverless this only helps requests that
// land on the same warm instance, which is a bonus rather than a guarantee.
const TTL_MS = 60_000
const verified = new Map<string, { userId: string; expiresAt: number }>()

function readCache(token: string): string | null {
  const hit = verified.get(token)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    verified.delete(token)
    return null
  }
  return hit.userId
}

/**
 * Resolves an access token to the user id it belongs to, or null if the token
 * is absent, malformed, expired or revoked. Never throws.
 */
export async function userIdFromAccessToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null

  const cached = readCache(token)
  if (cached) return cached

  try {
    const { data, error } = await authClient.auth.getUser(token)
    if (error || !data?.user?.id) return null

    // Bounded so a burst of distinct tokens cannot grow this without limit.
    if (verified.size > 5000) verified.clear()
    verified.set(token, { userId: data.user.id, expiresAt: Date.now() + TTL_MS })
    return data.user.id
  } catch (e) {
    console.error('[Auth] Token verification failed:', e)
    return null
  }
}

/**
 * Pulls the access token off a request. Accepts an Authorization header too,
 * so non-browser callers (the eval harness, curl, a future mobile client) have
 * a way in that does not depend on cookies.
 */
export function accessTokenFrom(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    if (token) return token
  }
  return req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null
}

/** Convenience: the authenticated user id for this request, or null. */
export async function authenticatedUserId(req: NextRequest): Promise<string | null> {
  return userIdFromAccessToken(accessTokenFrom(req))
}
