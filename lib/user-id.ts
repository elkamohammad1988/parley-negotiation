const KEY = "parley_uid";
const DT_KEY = "parley_dt";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the persistent anonymous device ID stored in localStorage.
 * Generates a new UUID on first call and on every call where the stored
 * value is missing or in the old uid_xxx format. Safe to call on every render.
 * Must only be called client-side (requires localStorage).
 */
export function getUserId(): string {
  ensureDeviceToken();
  const stored = localStorage.getItem(KEY) || "";
  if (UUID_RE.test(stored)) return stored;
  const uid = crypto.randomUUID();
  localStorage.setItem(KEY, uid);
  return uid;
}

/**
 * Ensures a device-token cookie exists. Sent automatically on same-origin
 * requests and checked server-side (see app/api/user/profile and
 * lib/ownership.ts) as an IDOR mitigation: once a userId's first request
 * records this token, later requests for that same userId must present a
 * matching cookie. This is a soft ownership hint, not real auth — it does
 * nothing for a userId that's never been used yet, and is lost if cookies
 * are cleared or the user switches browsers/devices.
 */
function ensureDeviceToken() {
  if (typeof document === "undefined") return;
  if (/(?:^|; )parley_dt=/.test(document.cookie)) return;
  const token = crypto.randomUUID();
  const oneYear = 365 * 24 * 60 * 60;
  // `secure` over https, matching what SessionSync already does for the access
  // token beside it. This one was sent in the clear on any plain-http request
  // to the origin — and it is the whole of the ownership check for a browser
  // with no session, so an observer who captured it could read that id's
  // rehearsals. HSTS (see next.config.ts) makes such a request unlikely in
  // production; the flag is what makes it impossible.
  //
  // Conditional rather than unconditional: a `secure` cookie is dropped
  // outright on http://localhost, which would leave development with no device
  // token and no way to exercise the binding at all.
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${DT_KEY}=${token}; path=/; max-age=${oneYear}; samesite=lax${secure}`;
}
