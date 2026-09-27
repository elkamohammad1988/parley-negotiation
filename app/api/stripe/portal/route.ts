// Stripe Customer Portal — self-serve subscription management (cancel, update payment, view invoices)
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/rateLimit";
import { rejectInvalidContentType } from "@/lib/validateRequest";
import { clientIp, requireAuthenticated } from "@/lib/ownership";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  if (!STRIPE_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  const reject = rejectInvalidContentType(req);
  if (reject) return reject;

  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // This route used to take a userId and hand back a billing portal link for
    // it, with no check at all: anyone who knew or guessed an id could cancel
    // that person's subscription, change their card, and read their invoices.
    // A device token is not enough for that either, so this requires a real,
    // current Supabase session rather than the softer ownership check.
    const auth = await requireAuthenticated(req, userId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const rl = checkRateLimit(`stripe-portal:${userId || clientIp(req)}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const { data: sub } = await supabaseServer
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single();

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    const params = new URLSearchParams({
      customer: sub.stripe_customer_id,
      return_url: `${SITE_URL}/billing`,
    });

    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await response.json();
    if (!response.ok) {
      // Stripe's own message named the customer object and occasionally the
      // key prefix, and it was being returned over HTTP. Logged instead — the
      // caller can do nothing with it, and app/api/stripe/setup-products was
      // corrected the same way.
      console.error("[Stripe portal] Session creation failed:", session?.error?.message);
      return NextResponse.json({ error: "Could not open the billing portal." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[Stripe portal] Threw:", e);
    return NextResponse.json({ error: "Could not open the billing portal." }, { status: 500 });
  }
}
