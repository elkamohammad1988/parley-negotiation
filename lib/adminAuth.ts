// Admin session token signing/verification — Edge-compatible (Web Crypto,
// not Node's crypto module) since this runs inside proxy.ts middleware,
// which always executes on the Edge runtime, as well as regular Node-runtime
// /api/admin/* routes. Same crypto.subtle approach already used for Stripe
// webhook signature verification in app/api/stripe-webhook/route.ts.
//
// Replaces storing the raw ADMIN_PASSWORD directly as the admin_session
// cookie value. The cookie now holds a signed, time-limited token instead —
// a leaked cookie never hands over the actual admin password, and the token
// carries its own server-verified expiry rather than relying only on the
// browser-enforced cookie maxAge (a raw-password cookie copied out before
// its maxAge attribute would otherwise remain valid forever if replayed).
//
// The signing key is derived from ADMIN_PASSWORD itself — no separate secret
// to configure in Vercel — but the password never appears in the token.

const SESSION_DURATION_SECONDS = 60 * 60 * 8 // 8 hours, matches the existing cookie maxAge

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compares two secrets without leaking, through timing, how much of the first
 * one the caller got right.
 *
 * Double-HMAC rather than a byte loop over the raw strings, because a raw loop
 * has to return early on a length mismatch and therefore leaks the length of
 * the real password. Both sides are hashed under a key generated once per
 * process and never exported, so the digests are fixed length, an attacker
 * cannot precompute either side, and the comparison below is over two
 * equal-length hex strings.
 *
 * Used for ADMIN_PASSWORD, which is compared against a value taken straight out
 * of a request body in two places — app/api/admin/login and
 * app/api/stripe/setup-products — and was being compared with `!==` in both.
 */
const COMPARISON_KEY = crypto.getRandomValues(new Uint8Array(32))

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    COMPARISON_KEY,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = async (value: string) => {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
    return new Uint8Array(sig)
  }
  const [da, db] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i]
  return diff === 0
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  return atob(padded)
}

export async function createAdminSessionToken(adminPassword: string): Promise<string> {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS })
  const encodedPayload = base64UrlEncode(payload)
  const signature = await hmacHex(adminPassword, encodedPayload)
  return `${encodedPayload}.${signature}`
}

export async function verifyAdminSessionToken(token: string | undefined, adminPassword: string): Promise<boolean> {
  if (!token || !adminPassword) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [encodedPayload, signature] = parts

  const expectedSignature = await hmacHex(adminPassword, encodedPayload)
  if (expectedSignature.length !== signature.length) return false
  // Constant-time compare — Web Crypto has no built-in equivalent to Node's
  // crypto.timingSafeEqual, so this does it manually. Safe here because both
  // strings are already confirmed equal-length hex output of the same hash.
  let diff = 0
  for (let i = 0; i < expectedSignature.length; i++) {
    diff |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  if (diff !== 0) return false

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { exp?: number }
    if (!payload.exp || Date.now() / 1000 > payload.exp) return false
  } catch {
    return false
  }
  return true
}

/**
 * The guard on every /api/admin route.
 *
 * Returns a 401 to send back, or null when the caller holds a valid admin
 * session. Callers read it as `const refusal = await requireAdmin(req); if
 * (refusal) return refusal`.
 *
 * WHY THIS IS ONE FUNCTION AND NOT FIVE COPIES. /api/admin/* sits outside the
 * proxy's /admin/* matcher (see proxy.ts), so the check inside each route
 * handler is the ONLY thing in front of it — there is no second gate to catch
 * a route that forgets. The same four lines were pasted into five handlers,
 * which is five chances to mistype `!adminPassword ||` and one more with every
 * route added. tests/admin-routes.test.ts enumerates the directory rather than
 * a list, so an unguarded route fails the suite the moment it exists.
 *
 * A plain `Response`, not `NextResponse`: this module is imported by proxy.ts
 * and therefore runs on the Edge runtime, and it has so far needed nothing
 * beyond Web Crypto. NextResponse.json produces an ordinary Response anyway,
 * so the body and status callers emit are unchanged.
 *
 * proxy.ts deliberately does NOT use this. It guards the /admin/* PAGES and
 * answers a browser, so it redirects to the login screen instead of returning
 * JSON — a different refusal for a different caller, not a missed deduplication.
 */
export async function requireAdmin(
  req: { cookies: { get(name: string): { value: string } | undefined } }
): Promise<Response | null> {
  const adminPassword = process.env.ADMIN_PASSWORD
  const session = req.cookies.get('admin_session')
  if (!adminPassword || !(await verifyAdminSessionToken(session?.value, adminPassword))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}
