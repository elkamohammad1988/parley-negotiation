"use client";
// Cookie consent banner.
//
// Whether it shows depends on localStorage, which the server cannot read. The
// obvious shape — useState(false) plus an effect that flips it — is a setState
// inside an effect body: it cascades an extra render on every page load and
// makes the banner appear a beat after the content, which reads as a jump.
//
// useSyncExternalStore is the shape React provides for exactly this: the server
// snapshot is "already decided" so nothing renders during SSR or first paint,
// the client snapshot reads storage directly, and `accept`/`decline` notify
// subscribers rather than setting state. Same pattern as lib/hooks/useUserId.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "parley_cookie_consent";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function notify() {
  for (const l of listeners) l();
}

/** True once the visitor has answered, either way. */
function getSnapshot(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    // Storage can throw in a private window or with site data blocked. Treat it
    // as answered: a banner that cannot record consent should not keep asking.
    return true;
  }
}

/** Nothing is decided on the server, and nothing renders there either. */
function getServerSnapshot(): boolean {
  return true;
}

export default function CookieBanner() {
  const decided = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const answer = useCallback((value: "accepted" | "declined") => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* Nothing to record it in; the banner still closes for this session. */
    }
    notify();
  }, []);

  const accept = () => answer("accepted");
  const decline = () => answer("declined");

  if (decided) return null;

  return (
    <>
      <style>{`
        /* Drawn in the product's own tokens — surface, ink, clay, the three
           radii, the raised shadow. This banner is mounted in the root layout
           and shows on a first visit, so it is often the first piece of the
           brand a new visitor sees. Keep it on the tokens. */
        @keyframes ck-slide-up{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .ck-banner{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:9999;background:var(--pl-surface);border:1px solid var(--pl-line-strong);border-radius:var(--pl-radius-lg);padding:1rem 1.25rem;max-width:520px;width:calc(100% - 3rem);display:flex;align-items:center;gap:14px;box-shadow:var(--pl-shadow-raised);font-family:var(--pl-font-sans, system-ui, sans-serif);color:var(--pl-ink);animation:ck-slide-up var(--pl-slow) var(--pl-ease-out)}
        .ck-text{flex:1;font-size:13px;color:var(--pl-ink-muted);line-height:1.6}
        .ck-text a{color:var(--pl-clay-deep);text-decoration:underline;text-underline-offset:2px}
        .ck-actions{display:flex;gap:8px;flex-shrink:0}
        .ck-accept{padding:8px 16px;background:var(--pl-clay);border:1.5px solid var(--pl-clay-deep);color:var(--pl-on-clay);font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;border-radius:var(--pl-radius-md);box-shadow:2px 2px 0 var(--pl-clay-deep);transition:transform var(--pl-instant) var(--pl-ease-out),box-shadow var(--pl-instant) var(--pl-ease-out)}
        .ck-accept:hover{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--pl-clay-deep)}
        .ck-decline{padding:8px 12px;background:transparent;border:1.5px solid var(--pl-ink);color:var(--pl-ink);font-size:13px;font-family:inherit;cursor:pointer;border-radius:var(--pl-radius-md);transition:background var(--pl-fast) var(--pl-ease-out)}
        .ck-decline:hover{background:var(--pl-surface-sunken)}
      `}</style>
      <div className="ck-banner" role="dialog" aria-label="Cookie consent">
        <div className="ck-text">
          We use cookies to improve your experience and keep you signed in.{" "}
          <a href="/privacy">Privacy policy</a>
        </div>
        <div className="ck-actions">
          <button className="ck-accept" onClick={accept}>Accept</button>
          <button className="ck-decline" onClick={decline}>Decline</button>
        </div>
      </div>
    </>
  );
}
