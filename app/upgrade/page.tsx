'use client'
import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PAPER, SIGNAL, FONT, RADIUS } from '@/lib/design'
import { isPlan, PLAN_NAMES, planPrice, type Plan } from '@/lib/plans'
import { getUserId } from '@/lib/user-id'
import { trackClientEvent } from '@/lib/analyticsClient'

// Checkout hand-off.
//
// Previously a bare redirect back to /pricing, which meant every "choose this
// plan" button on the pricing page led back to the page it was on. This
// actually starts the Stripe session, and shows a real error if it cannot
// rather than bouncing the user in a circle.

function UpgradeInner() {
  const params = useSearchParams()
  const [error, setError] = useState('')

  // Derived from the URL rather than copied into state by the effect below:
  // the plan named in the query string is the only thing this page is about,
  // and it is known on the first render.
  const requestedPlan = params.get('plan')
  const plan: Plan | null = isPlan(requestedPlan) && requestedPlan !== 'free' ? requestedPlan : null

  useEffect(() => {
    const requested = params.get('plan')
    const interval = params.get('interval') === 'annual' ? 'annual' : 'monthly'

    if (!isPlan(requested) || requested === 'free') {
      window.location.replace('/pricing')
      return
    }

    // Team is not sold (see PUBLIC_PLANS in lib/plans.ts) and nothing links
    // here with it any more, but a typed or bookmarked URL still can. It goes
    // to a person rather than to a checkout for a plan the product cannot yet
    // describe.
    if (requested === 'team') {
      window.location.replace('/support?topic=team')
      return
    }

    const userId = getUserId()
    trackClientEvent('checkout_started', { plan: requested, interval }, userId)

    fetch('/api/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: requested,
        interval,
        userId,
        email: localStorage.getItem('parley_email') || undefined,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.url) {
          window.location.href = data.url
          return
        }
        // Checkout needs a signed-in account. Send a guest to create one and
        // bring them straight back to this plan; lib/guest-migration moves
        // their rehearsals across on the way.
        if (data.code === 'session_required') {
          const back = `/upgrade?plan=${requested}&interval=${interval}`
          window.location.replace(`/signup?next=${encodeURIComponent(back)}`)
          return
        }
        setError(data.error || 'Could not start checkout.')
      })
      .catch(() => setError('Could not reach the server.'))
  }, [params])

  return (
    <main
      style={{
        minHeight: '100vh',
        background: PAPER.bg,
        color: PAPER.ink,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          fontFamily: FONT.serif,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          marginBottom: '2rem',
        }}
      >
        Parley<span style={{ color: SIGNAL.clay }}>.</span>
      </div>

      {error ? (
        <>
          <h1 style={{ fontFamily: FONT.serif, fontSize: 24, fontWeight: 600, margin: '0 0 10px' }}>
            Checkout could not start
          </h1>
          <p style={{ fontSize: 15, color: PAPER.inkMuted, maxWidth: 400, lineHeight: 1.6, margin: '0 0 24px' }}>
            {error} You have not been charged.
          </p>
          <Link
            href="/pricing"
            style={{
              padding: '11px 22px',
              border: `1px solid ${PAPER.lineStrong}`,
              borderRadius: RADIUS.md,
              fontSize: 14.5,
              textDecoration: 'none',
              color: PAPER.ink,
            }}
          >
            Back to plans
          </Link>
        </>
      ) : (
        <p style={{ fontSize: 15.5, color: PAPER.inkMuted }}>
          Taking you to checkout
          {plan ? ` for ${PLAN_NAMES[plan]} at ${planPrice(plan, 'monthly')}/mo` : ''}…
        </p>
      )}
    </main>
  )
}

export default function UpgradePage() {
  return (
    <Suspense fallback={null}>
      <UpgradeInner />
    </Suspense>
  )
}
