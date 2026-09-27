import { NextResponse } from "next/server";
import { supabaseServer as supabaseAdmin } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/rateLimit";

import { rejectInvalidContentType } from "@/lib/validateRequest";
import { clientIp } from "@/lib/ownership";

export async function POST(req: Request) {
  // Tight limit — this is a classic email-bombing vector (repeatedly reset-request
  // a victim's inbox) as well as an email-enumeration probe if left unprotected.
  const rl = checkRateLimit(`send-reset:${clientIp(req)}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const reject = rejectInvalidContentType(req);
  if (reject) return reject;

  try {
    // Explicit check kept even though the shared client already has its own
    // fallback — a clean 503 here is a clearer failure mode than letting
    // auth.resetPasswordForEmail fail against a placeholder client downstream.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[SendReset] SUPABASE_SERVICE_ROLE_KEY missing");
      return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
    }

    const { email } = await req.json();
    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/reset-password`,
    });

    if (error) {
      // Logged, never returned. Supabase's message distinguishes "no user with
      // that address" from a transport failure, and handing that to the caller
      // turns this endpoint into an account-enumeration oracle — ask for a
      // reset, read the error, learn who has an account here. The answer below
      // is the same either way.
      console.error("[SendReset] Error:", error.message);
    }

    // Deliberately unconditional: the only honest thing this endpoint can say
    // is what it says to everyone.
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[SendReset] Unexpected error:", err);
    return NextResponse.json({ error: "Failed to send reset email" }, { status: 500 });
  }
}
