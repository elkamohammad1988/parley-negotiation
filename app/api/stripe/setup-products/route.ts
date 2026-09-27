// Admin-only: create/reconcile the Parley subscription products + prices in Stripe.
// Safe to re-run — looks up existing prices by lookup_key before creating anything.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { rejectInvalidContentType } from "@/lib/validateRequest";
import { constantTimeEqual } from "@/lib/adminAuth";
import { clientIp } from "@/lib/ownership";

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

// Amounts in minor units. Annual is the discounted monthly rate x 12, and it
// must stay consistent with PLAN_PRICES in lib/plans.ts — that table is what
// the pricing page renders and what admin stats derives MRR from, so a
// divergence here would mean the site advertises one number and Stripe charges
// another. Re-running this route is safe: existing prices are found by
// lookup_key and left alone.
const PLANS: Record<string, { name: string; description: string; monthly: number; annual: number }> = {
  practitioner: {
    name: "Parley Practitioner",
    description: "25 rehearsals a month, every one scored, 2 custom counterparts, progress trends",
    monthly: 1900,
    annual: 18000,
  },
  // Descriptions name only entitlements that exist — see PlanFeatures in
  // lib/plans.ts. "Custom scenarios", "transcript export" and "a shared
  // scenario library" were removed from these lines for the same reason they
  // were removed from the pricing page: a Stripe product description is a
  // customer-facing claim, and none of the three is built.
  professional: {
    name: "Parley Professional",
    description: "Unlimited rehearsals, each with its scored debrief, unlimited custom counterparts, progress trends",
    monthly: 3900,
    annual: 37200,
  },
  // Team is deliberately absent. Its description read "Per seat. Everything in
  // Professional, for several people on one account" — but there is no seat, no
  // shared account and no team view anywhere in this codebase, and it was
  // priced BELOW Professional for entitlements identical to Professional's. It
  // is no longer sold (see PUBLIC_PLANS in lib/plans.ts), so this route no
  // longer creates or reconciles a product for it. Any product already in
  // Stripe is left exactly as it is: this route only ever adds, and an existing
  // subscription still resolves to full access through PLAN_FEATURES.
};

async function stripeRequest(path: string, params: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Stripe error on ${path}`);
  return json;
}

async function findPriceByLookupKey(lookupKey: string) {
  const res = await fetch(
    `https://api.stripe.com/v1/prices?${new URLSearchParams({ "lookup_keys[]": lookupKey, limit: "1" })}`,
    { headers: { Authorization: `Bearer ${STRIPE_SECRET}` } }
  );
  const json = await res.json();
  return json.data?.[0] || null;
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`stripe-setup-products:${clientIp(req)}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  const reject = rejectInvalidContentType(req);
  if (reject) return reject;

  const adminPassword = process.env.ADMIN_PASSWORD;
  const body = await req.json().catch(() => ({}));
  const secret = typeof body?.secret === "string" ? body.secret : "";
  // constantTimeEqual, not `!==` — the same admin password gates this route and
  // app/api/admin/login, so the two compare it the same way. See lib/adminAuth.
  if (!adminPassword || !(await constantTimeEqual(secret, adminPassword))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!STRIPE_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  try {
    const result: Record<string, { productId: string; priceId: string; created: boolean }> = {};

    for (const [tier, plan] of Object.entries(PLANS)) {
      let productId: string | null = null;

      for (const [interval, amount] of [["month", plan.monthly], ["year", plan.annual]] as const) {
        const lookupKey = `${tier}_${interval === "month" ? "monthly" : "annual"}`;
        const existing = await findPriceByLookupKey(lookupKey);

        if (existing) {
          result[lookupKey] = { productId: existing.product, priceId: existing.id, created: false };
          productId = existing.product;
          continue;
        }

        if (!productId) {
          const product = await stripeRequest(
            "products",
            new URLSearchParams({ name: plan.name, description: plan.description, "metadata[tier]": tier })
          );
          productId = product.id;
        }

        const price = await stripeRequest(
          "prices",
          new URLSearchParams({
            product: productId as string,
            currency: "usd",
            unit_amount: String(amount),
            "recurring[interval]": interval,
            lookup_key: lookupKey,
            "metadata[tier]": tier,
          })
        );

        result[lookupKey] = { productId: productId as string, priceId: price.id, created: true };
      }
    }

    const envVars = Object.fromEntries(
      Object.entries(result).map(([lookupKey, { priceId }]) => [`STRIPE_PRICE_${lookupKey.toUpperCase()}`, priceId])
    );

    return NextResponse.json({ ok: true, prices: result, envVars });
  } catch (e) {
    // Logged, not returned. `String(e)` here was Stripe's own error text —
    // which names accounts, objects and occasionally a key prefix — handed
    // straight back over HTTP. Post-auth, but the admin password is a single
    // shared secret and this is the one route that talks to Stripe's write API,
    // so it is the wrong place to be generous with internals.
    console.error("[Stripe setup-products] failed:", e);
    return NextResponse.json(
      { error: "Could not reconcile products. Check the server logs." },
      { status: 500 }
    );
  }
}
