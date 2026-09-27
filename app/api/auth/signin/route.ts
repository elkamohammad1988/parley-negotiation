import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { rejectInvalidContentType } from "@/lib/validateRequest";
import { clientIp } from "@/lib/ownership";

// The sb_publishable_* anon key format is rejected by Supabase's REST auth endpoint.
// We proxy sign-in server-side using the service role key (which works), then return
// the resulting user-scoped session tokens to the browser.
export async function POST(req: Request) {
  try {
    const rl = checkRateLimit(`auth-signin:${clientIp(req)}`, 5, 15 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }
    const reject = rejectInvalidContentType(req);
    if (reject) return reject;

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.error("[auth/signin] SUPABASE_SERVICE_ROLE_KEY missing");
      return NextResponse.json({ error: "Auth service not configured" }, { status: 503 });
    }

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "apikey": serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      // Logged in full, returned as one sentence.
      //
      // This used to pass Supabase's own message straight through whenever it
      // did not contain the word "Invalid" — so "Email not confirmed" and
      // "User already registered" reached the browser verbatim. Both answer a
      // question the caller is not entitled to ask: whether an address has an
      // account here. That is the same enumeration oracle /api/send-reset goes
      // out of its way to avoid, reintroduced on the endpoint next to it.
      //
      // 429 is kept distinguishable because it is about the caller's own
      // behaviour and tells them nothing about anyone else; every other failure
      // is one answer.
      // The status and the provider's error code — not the whole body. The
      // body echoes the submitted address back alongside whatever else the
      // provider chose to include, and the response below is deliberately one
      // generic sentence precisely so this endpoint answers no question about
      // who has an account here. A log wider than the response keeps a second
      // copy of the thing the response is careful about.
      console.error(
        "[auth/signin] Supabase error:",
        res.status,
        data?.error_code ?? data?.error ?? "unspecified"
      );
      if (res.status === 429) {
        return NextResponse.json(
          { error: "Too many sign-in attempts. Please try again later." },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }

    return NextResponse.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      user: data.user,
    });
  } catch (err) {
    console.error("[auth/signin] Unexpected error:", err);
    return NextResponse.json({ error: "Sign in failed. Please try again." }, { status: 500 });
  }
}
