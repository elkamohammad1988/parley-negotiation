'use client'
import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS, SHADOW } from '@/lib/design'
import { PLAN_NAMES, PLAN_TAGLINES, planFeatures, planPrice, formatLimit, nextPlanUp, type Plan } from '@/lib/plans'
import { useUserId } from '@/lib/hooks/useUserId'

// Billing.
//
// Shows what the plan actually buys in this product's own units — rehearsals
// and debriefs — rather than a generic feature list, so someone deciding
// whether to keep paying is looking at the number they care about.

interface SubscriptionState {
  plan: Plan
  status: string
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
}

// Stripe sends the user back here with ?session_id= after checkout. The URL is
// a browser-only value read once on mount, so it is read as an external store
// rather than copied into state inside an effect — same pattern as
// lib/hooks/useUserId. The server snapshot is false, matching what the
// browser renders before hydration, and the value never changes for the life
// of the page, so the subscription is a no-op.
function subscribeNever(): () => void {
  return () => {}
}

function readJustSubscribed(): boolean {
  return new URLSearchParams(window.location.search).has('session_id')
}

export default function BillingPage() {
  const userId = useUserId()
  const [sub, setSub] = useState<SubscriptionState | null>(null)
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const [loading, setLoading] = useState(true)
  // Whether the plan and quota could actually be READ.
  //
  // `plan` below falls back to 'free' and the quota figures fall back to zero,
  // which is right for an account that genuinely has neither and badly wrong
  // for a failed request: during an outage a Professional subscriber was shown
  // the word "Free" and a reset quota, on the one page where being wrong about
  // that is most alarming. Nothing dynamic renders until this is false.
  const [loadFailed, setLoadFailed] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const justSubscribed = useSyncExternalStore(subscribeNever, readJustSubscribed, () => false)
  const [error, setError] = useState('')

  useEffect(() => {
    // useUserId returns an empty string during SSR and the first
    // paint; there is nothing to fetch until it resolves.
    if (!userId) return
    const uid = userId

    Promise.all([
      fetch(`/api/stripe?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/rehearsal/session?userId=${encodeURIComponent(uid)}`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([subscription, session]) => {
        if (subscription) setSub(subscription)
        if (session?.quota) setQuota({ used: session.quota.used, limit: session.quota.limit })
        // A null is a non-ok response, not an account without a subscription.
        if (!subscription || !session) setLoadFailed(true)
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [userId])

  async function openPortal() {
    if (portalLoading) return
    setPortalLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error || 'Could not open the billing portal.')
    } catch {
      setError('Could not reach the server.')
    }
    setPortalLoading(false)
  }

  const plan = sub?.plan ?? 'free'
  const features = planFeatures(plan)
  const upgrade = nextPlanUp(plan)

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '44px 24px 40px', fontFamily: FONT.sans }}>
        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: TYPE.h1,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            margin: '0 0 30px',
          }}
        >
          Billing
        </h1>

        {justSubscribed && (
          <div
            style={{
              background: SIGNAL.gainSoft,
              border: `1px solid ${SIGNAL.gain}`,
              borderRadius: RADIUS.md,
              padding: '14px 18px',
              marginBottom: 24,
              fontSize: 14.5,
            }}
          >
            Payment received. Your plan may take a few seconds to appear here —
            it updates when Stripe confirms.
          </div>
        )}

        {loading ? (
          <div style={{ color: PAPER.inkMuted, fontSize: 14 }}>Loading…</div>
        ) : loadFailed ? (
          /* No plan name, no counters, no upgrade button. Every one of those
             would be a guess, and a wrong guess about someone's plan is worse
             than telling them the page could not load. */
          <div className="pl-notice pl-notice--bad" role="alert">
            <p style={{ margin: '0 0 10px', fontWeight: 500 }}>
              Could not load your plan and usage
            </p>
            <p style={{ margin: '0 0 14px' }}>
              Your subscription has not changed — this is a problem reaching
              the billing service, not a change to your account. Nothing here
              is shown until it can be read correctly.
            </p>
            <button
              type="button"
              className="pl-btn pl-btn--primary pl-btn--sm"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* An object sitting on the file, not a div floating over a
                background: 1.5px ink rule, tight radius, hard offset shadow.
                It was a hairline-bordered rounded card with no shadow — the
                one thing lib/design.ts names as the way to look like every
                other product. Same treatment as the debrief's reveal and the
                progress ledger, so the paid surface reads as part of the same
                product rather than as the settings screen of a different one. */}
            <div
              style={{
                background: PAPER.surface,
                border: `1.5px solid ${PAPER.ink}`,
                borderRadius: RADIUS.md,
                boxShadow: SHADOW.hard,
                padding: '26px 28px',
                marginBottom: 26,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{PLAN_NAMES[plan]}</h2>
                {/* A plan that is not sold carries no price (lib/plans.ts), and
                    the page says nothing rather than inventing a figure for it.
                    Whoever holds such a plan holds it by arrangement, and the
                    invoice is the authority on what it costs, not this line. */}
                {plan !== 'free' && planPrice(plan, 'monthly') && (
                  <span className="pl-num" style={{ fontSize: 15, color: PAPER.inkMuted }}>
                    {planPrice(plan, 'monthly')}/mo
                  </span>
                )}
                {sub?.status && sub.status !== 'active' && sub.status !== 'none' && (
                  <span
                    style={{
                      fontSize: 12,
                      padding: '3px 9px',
                      borderRadius: RADIUS.sm,
                      background: SIGNAL.warnSoft,
                      color: SIGNAL.warn,
                      textTransform: 'capitalize',
                    }}
                  >
                    {sub.status.replace('_', ' ')}
                  </span>
                )}
              </div>

              <p style={{ fontSize: 14.5, color: PAPER.inkMuted, margin: '8px 0 18px', lineHeight: 1.6 }}>
                {PLAN_TAGLINES[plan]}
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 14,
                  paddingTop: 18,
                  borderTop: `1px solid ${PAPER.line}`,
                }}
                className="pl-bill-stats"
              >
                <Stat
                  label="Rehearsals this month"
                  value={
                    features.monthlyRehearsals === -1
                      ? String(quota?.used ?? 0)
                      : `${quota?.used ?? 0} / ${formatLimit(features.monthlyRehearsals)}`
                  }
                />
                <Stat label="Custom counterparts" value={formatLimit(features.customCounterparts)} />
                {/* Was "History kept", reading a plan field that no reader and
                    no reaper ever acted on — so it printed "30 days" at a free
                    user whose transcripts were not going anywhere, and sold
                    three years to someone it was not being withheld from.
                    Progress trends is the third thing this plan actually
                    decides, so it is the third thing the row shows. */}
                {/* "Yes" / "—", the same two answers the pricing comparison
                    gives, because this column is read as figures and a
                    sentence set in the tabular face reads as a mistake. */}
                <Stat label="Progress trends" value={features.progressTrends ? 'Yes' : '—'} />
              </div>
              <p style={{ fontSize: 13, color: PAPER.inkFaint, margin: '14px 0 0', lineHeight: 1.6 }}>
                Your rehearsals, debriefs and playbook stay readable for as long
                as the account exists, on every plan. Changing or cancelling a
                plan changes how many new rehearsals you can start — it does not
                remove what you have already done.
              </p>

              {sub?.currentPeriodEnd && (
                <p style={{ fontSize: 13, color: PAPER.inkFaint, margin: '16px 0 0' }}>
                  {sub.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on{' '}
                  {new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  .
                </p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  background: SIGNAL.claySoft,
                  border: `1px solid ${SIGNAL.clay}`,
                  borderRadius: RADIUS.md,
                  padding: '12px 16px',
                  fontSize: 14,
                  marginBottom: 18,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {plan === 'free' ? (
                <Link
                  href="/pricing"
                  style={{
                    padding: '11px 22px',
                    background: SIGNAL.clay,
                    color: SIGNAL.onClay,
                    borderRadius: RADIUS.md,
                    fontSize: 14.5,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  See plans
                </Link>
              ) : (
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  style={{
                    padding: '11px 22px',
                    background: 'transparent',
                    border: `1px solid ${PAPER.lineStrong}`,
                    borderRadius: RADIUS.md,
                    fontSize: 14.5,
                    cursor: 'pointer',
                    fontFamily: FONT.sans,
                    color: PAPER.ink,
                  }}
                >
                  {portalLoading ? 'Opening…' : 'Manage payment & cancel'}
                </button>
              )}

              {upgrade && (
                <Link
                  href={`/upgrade?plan=${upgrade}&interval=monthly`}
                  style={{
                    padding: '11px 22px',
                    background: plan === 'free' ? 'transparent' : SIGNAL.clay,
                    border: plan === 'free' ? `1px solid ${PAPER.lineStrong}` : 'none',
                    color: plan === 'free' ? PAPER.ink : SIGNAL.onClay,
                    borderRadius: RADIUS.md,
                    fontSize: 14.5,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Move up to {PLAN_NAMES[upgrade]}
                </Link>
              )}
            </div>
          </>
        )}
      </main>
      <Footer />

      <style>{`
        @media (max-width: 620px) {
          .pl-bill-stats { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          // TYPE.micro. It was 10px, which is not one of the eight steps in
          // lib/design.ts and is under the floor that file sets — "a size that
          // is not one of them is a bug, not a judgement call".
          fontSize: TYPE.micro,
          fontFamily: FONT.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: PAPER.inkFaint,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div className="pl-num" style={{ fontSize: 18, fontWeight: 500 }}>
        {value}
      </div>
    </div>
  )
}
