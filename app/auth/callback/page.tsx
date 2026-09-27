"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PAPER, FONT } from "@/lib/design";
import { supabase } from "@/lib/supabase-client";
import { migrateGuestData, safeNextPath, takeNext } from "@/lib/guest-migration";
import { clearGuestAccount } from "@/lib/hooks/useSignedIn";

// The server half of this — app/api/debug-oauth — was deleted when the
// redirect loop it was added to diagnose was fixed, so every call was posting
// to a 404 on each step of a sign-in. Now it is what its name says: a console
// line, in the browser where this page actually runs.
//
// Split by severity rather than silenced. The provider round trip only breaks
// against real redirect URIs, so the trace earns its keep — but the happy path
// printing twelve lines into the console of anyone who opens devtools during
// sign-up is developer tracing on a production surface. Progress lines are now
// development-only; failures still print, at error level, because production
// is exactly when someone needs to read them.
//
// Safe to log either way: every call site below passes ids, reasons and status
// codes. No token or session object is ever handed to this.
const OAUTH_FAILURE = /_failed$|_error$/;

function debugLog(event: string, data: Record<string, unknown> = {}) {
  if (OAUTH_FAILURE.test(event)) {
    console.error("[OAuth Callback]", event, data);
  } else if (process.env.NODE_ENV !== "production") {
    console.log("[OAuth Callback]", event, data);
  }
}

export default function AuthCallback() {
  const router = useRouter();
  // Set when the account is established but its guest data did not move. The
  // page stops and says so rather than redirecting as though it had.
  const [stranded, setStranded] = useState<{ oldUserId: string; newUserId: string; destination: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    // Shared by every path that ends up with a real user (code exchange, hash
    // token, or an already-live session) — this app's identity model is
    // localStorage-based (parley_uid), not the Supabase session itself, so
    // every path needs the same sync before it's safe to redirect anywhere.
    async function completeSignIn(user: { id: string; email?: string | null }) {
      const anonymousId = localStorage.getItem("parley_uid");
      localStorage.setItem("parley_uid", user.id);
      localStorage.setItem("parley_authenticated", "true");
      if (user.email) localStorage.setItem("parley_email", user.email);
      // Whatever this browser held before, it now holds a real account reached
      // through a real provider. See lib/hooks/useSignedIn for what the mark
      // means and why leaving it set would misreport where the work lives.
      clearGuestAccount();

      // Only creates a row for a genuinely new user — onConflict+ignoreDuplicates
      // skips silently for a returning sign-in so nothing is stomped.
      //
      // Previously wrote subscription_status and trial_ends_at, neither of
      // which exists on users any more (entitlement lives in subscriptions).
      // The upsert failed silently inside this try/catch, which meant no users
      // row was ever created for an OAuth sign-in — breaking the device-token
      // ownership binding and the migration below it.
      try {
        await supabase.from("users").upsert({
          id: user.id,
          email: user.email ?? null,
          created_at: new Date().toISOString(),
        }, { onConflict: "id", ignoreDuplicates: true });
      } catch (e) {
        console.error("[auth/callback] users upsert failed:", e);
      }

      // The response is read, not discarded. A refusal or a partial move used
      // to be indistinguishable from success from here, and the browser had
      // already switched parley_uid — so the person arrived at an empty
      // dashboard with their rehearsals addressed under an id they no longer
      // held. Determining the destination comes after, because a just-migrated
      // guest only counts as having history once the rows have actually moved.
      const migrated =
        anonymousId && anonymousId !== user.id
          ? await migrateGuestData(anonymousId, user.id)
          : { ok: true as const };

      let hasHistory = false;
      try {
        // The access token, not an id. /api/user/has-history answers only for
        // the session that asks — see the note there on why the id it used to
        // take was an oracle. Read from the live session rather than relying on
        // SessionSync having already mirrored the cookie, because that
        // mirroring races with this call.
        const { data: current } = await supabase.auth.getSession();
        const token = current.session?.access_token;
        if (token) {
          const histRes = await fetch("/api/user/has-history", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const histData = await histRes.json();
          hasHistory = !!histData.hasHistory;
        }
      } catch {}

      // Where the person was before they were sent to a provider — the debrief
      // sends one so that keeping a rehearsal returns you to that rehearsal.
      // Taken from storage first (see rememberNext: the provider round trip
      // does not carry our query string), with ?next= honoured if some path
      // does manage to deliver it.
      const asked = takeNext() ?? safeNextPath(new URLSearchParams(window.location.search).get("next"));
      const destination = asked ?? (hasHistory ? "/dashboard" : "/onboarding");

      if (!migrated.ok && anonymousId) {
        debugLog("migration_failed", { reason: migrated.reason });
        setStranded({ oldUserId: anonymousId, newUserId: user.id, destination });
        return;
      }

      debugLog("redirecting", { destination });
      router.replace(destination);
    }

    async function handleCallback() {
      // If a session is already live (e.g. this page re-ran after already
      // succeeding, or the browser restored it independently of the URL),
      // skip straight to sync+redirect rather than re-parsing the URL.
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session?.user) {
        debugLog("session_already_present", { userId: existing.session.user.id });
        await completeSignIn(existing.session.user);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const oauthError = params.get("error");
      const oauthErrorDesc = params.get("error_description");

      if (oauthError) {
        debugLog("provider_error", { oauthError, oauthErrorDesc });
        router.replace(`/signup?error=${encodeURIComponent(oauthError)}`);
        return;
      }

      if (code) {
        debugLog("exchanging_code");
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        const user = data?.session?.user;
        if (error || !user) {
          debugLog("exchange_failed", { errorMessage: error?.message, errorStatus: error?.status, hasUser: !!user });
          router.replace(`/signup?error=${encodeURIComponent(error?.message || "exchange_failed")}`);
          return;
        }
        debugLog("exchange_succeeded", { userId: user.id });
        await completeSignIn(user);
        return;
      }

      // Fallback: implicit-flow tokens can arrive in the URL hash instead of
      // a ?code= query param (e.g. if a provider/proxy strips query params
      // along the redirect chain but leaves the fragment intact, since the
      // fragment never leaves the browser). setSession (not just a bare
      // redirect) is required here — the client has no session yet until this
      // call actually establishes one.
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        debugLog("hash_token_found");
        const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        const user = data?.session?.user;
        if (error || !user) {
          debugLog("hash_setsession_failed", { errorMessage: error?.message });
          router.replace(`/signup?error=${encodeURIComponent(error?.message || "hash_exchange_failed")}`);
          return;
        }
        debugLog("hash_setsession_succeeded", { userId: user.id });
        await completeSignIn(user);
        return;
      }

      debugLog("no_code");
      router.replace("/signup?error=no_code");
    }
    handleCallback();
  }, [router]);

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: "40px 20px",
    textAlign: "center",
    background: PAPER.bg,
    color: PAPER.inkMuted,
    fontFamily: FONT.sans,
    fontSize: 15,
  };

  // Signed in, but the guest rehearsals did not come across. Saying so is the
  // whole point: the redirect this replaces was the step that made a failed
  // migration look like a successful one.
  if (stranded) {
    return (
      <div style={shell}>
        <p style={{ margin: 0, maxWidth: "46ch", lineHeight: 1.6, color: PAPER.ink }}>
          You are signed in, but what you rehearsed in this browser has not moved
          onto the account yet. It is still here — do not clear this
          browser&apos;s data.
        </p>
        <button
          type="button"
          disabled={retrying}
          className="pl-btn pl-btn--primary"
          onClick={async () => {
            setRetrying(true);
            const outcome = await migrateGuestData(stranded.oldUserId, stranded.newUserId);
            setRetrying(false);
            if (outcome.ok) {
              router.replace(stranded.destination);
              return;
            }
            setRetryFailed(true);
          }}
        >
          {retrying ? "Moving them across..." : "Try again"}
        </button>
        {retryFailed && (
          <p style={{ margin: 0, maxWidth: "46ch", lineHeight: 1.6, fontSize: 13.5 }} role="alert">
            Still not going through. Write to support from this browser and we
            will move them across.
          </p>
        )}
        <a href={stranded.destination} className="pl-link" style={{ fontSize: 13.5 }}>
          Carry on without them
        </a>
      </div>
    );
  }

  return <div style={shell}>Signing you in...</div>;
}
