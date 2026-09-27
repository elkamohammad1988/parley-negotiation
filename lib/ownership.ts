import { NextRequest } from 'next/server'
import { supabaseServer } from './supabase-server'
import { accessTokenFrom, userIdFromAccessToken } from './auth-server'

// The ownership gate for every route that reads or writes a user's rehearsals,
// debriefs, playbook and account data.
//
// Two mechanisms, in priority order:
//
//   1. SESSION AUTH (authoritative). If the request carries a Supabase access
//      token — cookie or Authorization header — it is verified against
//      Supabase and must resolve to the same user id the caller claims. A
//      token that resolves to someone else is refused outright. This is real
//      authentication: the caller proved they hold a signed, unexpired session
//      for that account.
//
//   2. DEVICE TOKEN (fallback). For requests with no session — a guest whose
//      token has expired mid-rehearsal, the eval harness — the older binding
//      still applies: once a userId's first request records a device token,
//      later requests for that id must present a matching cookie.
//
// Fallback exists so an expiring token cannot drop someone out of a live
// rehearsal they are twelve minutes into. It is weaker than (1) and is why
// `authenticated` is reported back: routes that do something destructive or
// financial should require the real thing.
//
// WHAT CHANGED AND WHY: this used to fail OPEN on a database error, on the
// reasoning that a blip should not lock people out. That reasoning does not
// survive contact with the rest of the request — every caller immediately
// queries the same database for the rehearsal itself, so a genuine outage
// fails anyway and the open door bought nothing except a window in which the
// check was absent. It now fails closed with a 503.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && UUID_RE.test(userId)
}

export type OwnershipResult =
  | { ok: true; authenticated: boolean }
  | { ok: false; status: 400 | 403 | 503; error: string }

export async function verifyOwnership(req: NextRequest, userId: unknown): Promise<OwnershipResult> {
  if (!isValidUserId(userId)) {
    return { ok: false, status: 400, error: 'A valid userId is required.' }
  }

  // ── 1. Real session, if one was presented ────────────────────────────────
  const token = accessTokenFrom(req)
  if (token) {
    const tokenUserId = await userIdFromAccessToken(token)
    if (tokenUserId) {
      if (tokenUserId !== userId) {
        // A valid session for a different account. Not a mistake worth
        // explaining — the same opaque refusal as any other failure.
        return { ok: false, status: 403, error: 'Forbidden' }
      }
      if (await isBanned(userId)) {
        return { ok: false, status: 403, error: 'This account has been suspended.' }
      }
      return { ok: true, authenticated: true }
    }
    // A token that does not verify is treated as no token rather than as an
    // attack: the common cause is an expired session on a page left open, and
    // the device-token path below still protects the id.
  }

  // ── 2. Device-token fallback ─────────────────────────────────────────────
  return verifyDeviceBinding(req, userId)
}

/**
 * The device-token half of verifyOwnership on its own, with the session step
 * skipped rather than failed.
 *
 * Exists for exactly one caller: the guest → account migration, which has to
 * prove the id being migrated AWAY from while the browser legitimately holds
 * a session for a different account — the new one. verifyOwnership would
 * refuse that as "a valid session for someone else", which is the right
 * answer for a read and the wrong one here. A guest id can only ever be
 * proven the way a guest ever proved it: the device token its first request
 * bound it to, or nothing at all if no row exists to bind.
 *
 * Never a substitute for verifyOwnership on a read or a write of the id's
 * own data.
 */
export async function verifyDeviceBinding(req: NextRequest, userId: unknown): Promise<OwnershipResult> {
  if (!isValidUserId(userId)) {
    return { ok: false, status: 400, error: 'A valid userId is required.' }
  }

  const presented = req.cookies.get('parley_dt')?.value ?? null

  const { data, error } = await supabaseServer
    .from('users')
    .select('device_token, banned')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[Ownership] Lookup failed, refusing:', error.message)
    return { ok: false, status: 503, error: 'Could not verify this request. Try again in a moment.' }
  }

  if (data?.banned) {
    return { ok: false, status: 403, error: 'This account has been suspended.' }
  }

  if (data?.device_token) {
    if (!presented || presented !== data.device_token) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
    return { ok: true, authenticated: false }
  }

  // First sighting of this user — claim the token so later requests are bound
  // to it. Only claims when the row already exists; a userId with no row has
  // nothing to protect yet, and every real account gets its row at sign-up.
  if (presented && data) {
    await supabaseServer.from('users').update({ device_token: presented }).eq('id', userId)
  }

  return { ok: true, authenticated: false }
}

/**
 * Gives a browser-only identity a row to be bound to, at the moment it first
 * creates something worth keeping.
 *
 * WHY THIS EXISTS. `verifyDeviceBinding` can only refuse a caller when the id
 * already carries a device token, and it only claims a token when a `users`
 * row is already there — "a userId with no row has nothing to protect yet".
 * That would hold if every id came from a sign-up. It is not true here. The landing and pricing CTAs open a room on a
 * uuid minted in localStorage, and `rehearsals.user_id` is deliberately not a
 * foreign key, so a silent guest accumulates a full transcript history under
 * an id that has no row, is bound to nothing, and therefore passes the source
 * check of `POST /api/user/migrate` for ANY caller. Knowing the uuid was
 * enough to move a stranger's rehearsals, debriefs and playbook onto your own
 * account — and the uuid is not a secret the product can rely on, since the
 * client sends it as a query parameter on every read.
 *
 * The fix is not a new mechanism. It is to make the existing one apply: create
 * the row, carrying the device token this browser is presenting, before the
 * first rehearsal is inserted. From then on the id behaves like every other —
 * later reads must present the same cookie, and the migration refuses a source
 * proven by nothing.
 *
 * Best effort by design. A browser with cookies blocked presents no token and
 * gets no row, which leaves it exactly where it was rather than locking it out
 * of a product it can otherwise use; that residual case is recorded in
 * docs/phase-2-plan.md. `ignoreDuplicates` means an id that already has a row —
 * every real account, and every guest after their first rehearsal — is never
 * touched, so an account's own token can never be overwritten from here.
 */
export async function bindGuestIdentity(req: NextRequest, userId: string): Promise<void> {
  if (!isValidUserId(userId)) return
  const presented = req.cookies.get('parley_dt')?.value
  if (!presented) return

  const { error } = await supabaseServer
    .from('users')
    .upsert({ id: userId, device_token: presented }, { onConflict: 'id', ignoreDuplicates: true })

  if (error) {
    // Not fatal to the caller: the rehearsal is still worth opening. Logged
    // because an id that never got bound is an id the migration cannot refuse.
    console.error('[Ownership] Could not bind guest identity:', error.message)
  }
}

async function isBanned(userId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from('users')
    .select('banned')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[Ownership] Ban lookup failed:', error.message)
    return false
  }
  return data?.banned === true
}

/**
 * Stricter gate for destructive or financial actions — account deletion, the
 * Stripe billing portal. A device token is a browser that once used this id;
 * that is not enough to cancel someone's subscription or erase their history.
 */
export async function requireAuthenticated(
  req: NextRequest,
  userId: unknown
): Promise<OwnershipResult> {
  const result = await verifyOwnership(req, userId)
  if (!result.ok) return result
  if (!result.authenticated) {
    return {
      ok: false,
      status: 403,
      error: 'Sign in again to continue — this action needs a current session.',
    }
  }
  return result
}

/**
 * Client IP for rate-limit keys.
 *
 * Takes a plain `Request` rather than a `NextRequest` because it only reads
 * headers, and two of its callers (app/api/auth/signin and app/api/send-reset)
 * declare the narrower type. Widening the parameter is backward compatible —
 * every existing caller passes a NextRequest, which is a Request — and it is a
 * smaller change than altering two route signatures.
 *
 * Seven routes used to inline the first line of this themselves and stop there,
 * without the `x-real-ip` fallback. On a host that sets only that header they
 * all resolved to the literal 'anon', which is one shared bucket for every
 * caller — not a way past the limit, but a way for one caller to exhaust it for
 * everyone (five sign-in attempts per fifteen minutes, globally).
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anon'
  )
}
