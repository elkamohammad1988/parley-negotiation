"use client";
import { PAPER, SIGNAL, FONT, RADIUS, SHADOW } from "@/lib/design";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

// Password recovery, both halves of it.
//
// This page used to render only the second half — a "set new password" form
// that called supabase.auth.updateUser. That call needs a recovery session,
// and the only link into here is "Forgot your password?" on the sign-in page,
// which is followed by someone who has no session at all. So the journey was:
// click the link, type a new password twice, and get told "the link may have
// expired — request a new one", with nowhere in the product to request one.
// Recovery was unreachable in both directions.
//
// Meanwhile /api/send-reset — rate limited, and already pointing its
// redirectTo back at this page — was called from nowhere. The two halves were
// built and never joined. This page now decides which half it is:
//
//   no recovery session  → ask for the email address and send the link
//   recovery session     → set the new password
//
// The client also changed. This file imported lib/supabase.ts, which was the
// only importer of it and configured no storageKey, while every other auth
// surface (signup, the OAuth callback, SessionSync) uses lib/supabase-client
// with storageKey 'parley-auth-session'. Two clients meant two session stores,
// so a session established anywhere else was invisible here. lib/supabase.ts
// has been deleted rather than left as a second way to be signed in.

type Phase = "checking" | "request" | "set";

export default function ResetPassword() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [password, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  // Supabase turns the recovery link's URL fragment into a session as the
  // client initialises, which has usually not finished on first paint. The
  // auth event is the reliable signal; getSession covers the case where it
  // landed before this effect ran.
  useEffect(() => {
    let settled = false;
    const decide = (hasSession: boolean) => {
      if (settled) return;
      settled = true;
      setPhase(hasSession ? "set" : "request");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) decide(true);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        // A recovery fragment that has not been consumed yet should not be read
        // as "no session" — give the listener above the first word.
        const recovering = typeof window !== "undefined" && window.location.hash.includes("type=recovery");
        if (data.session) decide(true);
        else if (!recovering) decide(false);
      })
      .catch(() => decide(false));

    // If a recovery fragment never resolves into a session, the link is spent.
    // Falling back to the request form is the useful end state: it is the thing
    // they would have to do next anyway.
    const timer = window.setTimeout(() => decide(false), 2500);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const sendLink = async () => {
    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/send-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setError("Too many requests. Wait a minute and try again.");
        return;
      }
      if (res.status === 503) {
        setError("Password reset is not configured on this deployment yet.");
        return;
      }
      // Anything else reports the same thing either way. Saying "no account
      // with that address" here would turn this form into a way to find out
      // who has an account, which is worth more to an attacker than it is to
      // the person who mistyped their own address.
      setSent(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 1600);
    } catch {
      // The recovery session is the thing that expires, so this drops back to
      // the form that can get them a fresh link rather than leaving them on a
      // form that will fail the same way again.
      setError("Could not set your password. The link may have expired — request a new one below.");
      setPhase("request");
    } finally {
      setLoading(false);
    }
  };

  /**
   * The heading each state opens with, and the page's only `h1`.
   *
   * These were `div`s carrying serif at 24px — the title was a visual fact and
   * not a structural one, so the page reported no heading at all. Someone
   * arriving from a reset email on a screen reader got a form with no
   * announced subject, and "skip to main content" landed them in unlabelled
   * prose. The success state's `h2` had the opposite half of the same problem:
   * a second-level heading with no first.
   */
  const titleStyle: React.CSSProperties = {
    fontFamily: FONT.serif,
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: PAPER.ink,
    margin: "0 0 8px",
  };

  const labelStyle: React.CSSProperties = {
    color: PAPER.ink,
    fontSize: 13.5,
    fontWeight: 500,
    display: "block",
    marginBottom: 8,
  };

  const buttonStyle = (busy: boolean): React.CSSProperties => ({
    width: "100%",
    background: SIGNAL.clay,
    border: "none",
    borderRadius: RADIUS.md,
    padding: 13,
    color: SIGNAL.onClay,
    fontSize: 15,
    fontFamily: FONT.sans,
    fontWeight: 500,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.7 : 1,
  });

  // The site's chrome, as on sign-up and onboarding. Someone who followed a
  // reset link that has expired, or who opened this page by mistake, had no
  // way anywhere from here except "Back to sign in". A flex column rather than
  // a 100vh div, so the card stays centred between the two.
  const shell = (children: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: PAPER.bg }}>
      <Nav variant="marketing" />
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT.sans, color: PAPER.ink }}>
        <div style={{ width: "100%", maxWidth: 420, background: PAPER.surface, borderRadius: RADIUS.lg, padding: 32, border: `1px solid ${PAPER.line}`, boxShadow: SHADOW.raised }}>
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );

  const backToSignIn = (
    <div style={{ marginTop: 16, textAlign: "center" }}>
      <a href="/signup" style={{ fontSize: 13, color: PAPER.inkFaint, textDecoration: "none" }}>
        Back to sign in
      </a>
    </div>
  );

  const errorBox = error && (
    <div style={{ background: SIGNAL.claySoft, border: `1px solid ${SIGNAL.clay}`, borderRadius: RADIUS.md, padding: "12px 15px", color: PAPER.ink, marginBottom: 16, fontSize: 14 }}>
      {error}
    </div>
  );

  if (success) {
    return (
      <div style={{ minHeight: "100vh", background: PAPER.bg, display: "flex", alignItems: "center", justifyContent: "center", color: PAPER.ink, fontFamily: FONT.sans }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: SIGNAL.gain, marginBottom: 16, display: "flex", justifyContent: "center" }}><CheckCircle2 size={52} strokeWidth={1.5} /></div>
          <h1 style={titleStyle}>Password updated</h1>
          <p style={{ color: PAPER.inkMuted }}>Taking you to your dashboard...</p>
        </div>
      </div>
    );
  }

  if (phase === "checking") {
    return shell(
      <p style={{ color: PAPER.inkMuted, fontSize: 14.5, textAlign: "center", margin: 0 }}>Checking your link…</p>
    );
  }

  if (sent) {
    return shell(
      <>
        <div style={{ color: SIGNAL.gain, marginBottom: 14, display: "flex" }}><CheckCircle2 size={40} strokeWidth={1.5} /></div>
        <h1 style={titleStyle}>Check your email</h1>
        <p style={{ color: PAPER.inkMuted, marginBottom: 8, fontSize: 14.5, lineHeight: 1.6 }}>
          If there is an account for <strong style={{ color: PAPER.ink }}>{email.trim()}</strong>, a reset link is on its way. It
          opens this page with the form for setting a new password.
        </p>
        <p style={{ color: PAPER.inkFaint, fontSize: 13, lineHeight: 1.6 }}>
          The link is single use and expires. Nothing about your account has changed yet.
        </p>
        {backToSignIn}
      </>
    );
  }

  if (phase === "request") {
    return shell(
      <>
        <h1 style={titleStyle}>Reset your password</h1>
        <p style={{ color: PAPER.inkMuted, marginBottom: 24, fontSize: 14.5, lineHeight: 1.6 }}>
          We will email you a link that opens this page with a form for setting a new one.
        </p>

        {errorBox}

        <div style={{ marginBottom: 24 }}>
          {/* Two fixes on every field on this page, both inherited rather than
              invented — app/signup carries the same pair for the same reasons.

              `.pl-input` replaces an inline style object that redrew the box by
              hand, `outline: "none"` included. An inline outline beats the
              stylesheet's `:focus-visible` rule at any specificity, and without
              the class the fields never picked up the box-shadow ring meant to
              replace it — so nothing on the page a password reset lands on
              showed focus at all, and a keyboard user tabbing between "New
              password" and "Confirm password" could not tell which box they
              were in.

              `htmlFor`/`id` makes the label the field's name rather than text
              sitting above it. Without the pair the only accessible name these
              inputs had was the placeholder, which is announced once and then
              disappears the moment anything is typed — and clicking the word
              "Email" did not focus the box. */}
          <label style={labelStyle} htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="pl-input"
            onKeyDown={e => e.key === "Enter" && !loading && sendLink()}
          />
        </div>

        <button type="button" onClick={sendLink} disabled={loading} style={buttonStyle(loading)}>
          {loading ? "Sending..." : "Email me a reset link"}
        </button>

        {backToSignIn}
      </>
    );
  }

  return shell(
    <>
      <h1 style={titleStyle}>Set new password</h1>
      <p style={{ color: PAPER.inkMuted, marginBottom: 24, fontSize: 14.5, lineHeight: 1.6 }}>
        Choose a strong password for your account.
      </p>

      {errorBox}

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="reset-new-password">New password</label>
        <input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="pl-input"
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle} htmlFor="reset-confirm-password">Confirm password</label>
        <input
          id="reset-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Same password again"
          className="pl-input"
          onKeyDown={e => e.key === "Enter" && !loading && handleReset()}
        />
      </div>

      <button type="button" onClick={handleReset} disabled={loading} style={buttonStyle(loading)}>
        {loading ? "Updating..." : "Update password"}
      </button>

      {backToSignIn}
    </>
  );
}
