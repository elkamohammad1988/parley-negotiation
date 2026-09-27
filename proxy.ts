import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSessionToken } from "@/lib/adminAuth";

// WHY THIS DUPLICATES lib/rateLimit.ts AND lib/ownership.ts's clientIp.
//
// It looks like something to deduplicate and is not. This file is the Edge
// middleware: it runs on every matched request, which makes it the hottest
// path in the app, and it is a separate runtime from the Node route handlers.
//
//   lib/ownership.ts imports lib/supabase-server.ts and lib/auth-server.ts,
//   both of which call createClient() AT MODULE SCOPE. Importing `clientIp`
//   from there — four lines of header reading — would instantiate two Supabase
//   clients and pull @supabase/supabase-js into the middleware bundle on every
//   cold start.
//
//   lib/rateLimit.ts registers a module-scope setInterval for cleanup, which
//   has no business running in middleware, and sharing the module would not
//   share the STORE in any case: Edge and Node are different processes, so the
//   two Maps are distinct either way. Only the code would be shared, not the
//   state — which is the thing that would have made merging worthwhile.
//
// So the copies below stay, and the reason is recorded here rather than
// rediscovered by the next person who greps for a duplicated rate limiter.
//
// In-memory rate limit store — resets on cold start, good for edge deployments
// Keys: IP or userId → { count, resetAt }
const RATE_STORE = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = RATE_STORE.get(key);
  if (!entry || now > entry.resetAt) {
    RATE_STORE.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect /admin sub-pages — require server-set httpOnly session cookie
  if (pathname.startsWith("/admin/") && pathname !== "/admin/") {
    const session = req.cookies.get("admin_session");
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || !(await verifyAdminSessionToken(session?.value, adminPassword))) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/admin";
      loginUrl.searchParams.set("unauthorized", "1");
      return NextResponse.redirect(loginUrl);
    }
  }

  // Only rate-limit API routes
  if (pathname.startsWith("/api/")) {
    const ip = getIp(req);
    const key = `${ip}:${pathname}`;

    // The two model-backed endpoints carry real per-call cost, so they get
    // their own ceilings. The room is generous — a rehearsal is a live
    // conversation and a user genuinely can send a turn every few seconds —
    // while the debrief reads a whole transcript and is far more expensive
    // per call, so it is much tighter.
    const limit =
      pathname === "/api/rehearsal" ? 40 :
      pathname === "/api/debrief" ? 12 :
      100;
    const windowMs = 60_000; // 1 minute

    if (!rateLimit(key, limit, windowMs)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(limit),
          },
        }
      );
    }
  }

  const res = NextResponse.next();

  // Security headers on all responses
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-XSS-Protection", "1; mode=block");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Rehearsal and debrief URLs contain an id that maps to a private
  // transcript. Same-origin referrer means that id never travels to an
  // external host in a Referer header if a page ever links out.
  if (pathname.startsWith("/room/") || pathname.startsWith("/debrief/")) {
    res.headers.set("Referrer-Policy", "same-origin");
  }

  // CSP. Every source below is one this app actually loads from.
  //
  // The Google Fonts allowances that used to sit on style-src and font-src are
  // gone: all three families are committed under app/fonts and served from this
  // origin (see the note in app/layout.tsx), so those were open doors nothing
  // walked through.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https://*.supabase.co",
    // The browser never calls the model provider directly — every generation
    // goes through this app's own API routes, which hold the key server-side.
    // So connect-src stays same-origin plus Supabase, and nothing more.
    "connect-src 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
