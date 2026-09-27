'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { supabase } from '@/lib/supabase-client'
import { trackClientEvent } from '@/lib/analyticsClient'
import { migrateGuestData, rememberNext, safeNextPath } from '@/lib/guest-migration'
import { clearGuestAccount, markGuestAccount } from '@/lib/hooks/useSignedIn'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS, SHADOW } from '@/lib/design'
import { PLAN_FEATURES } from '@/lib/plans'

// Sign up and sign in.
//
// There is no device fingerprinting. The free tier is a monthly rehearsal
// quota enforced server-side against the rehearsals table, which is harder to
// evade and does not require fingerprinting every visitor to a tool people use
// to prepare for conversations about their own employment.
//
// The auth mechanics: Supabase email/password, the server-side signin route,
// Google OAuth via PKCE, guest accounts, and the anonymous-id migration that
// stops a guest's rehearsals being orphaned.

// The query string can preselect the sign-in tab (?tab=login) and carry the
// Google OAuth failure flag (?error=). Both are browser-only values read once
// on mount, so they are read as an external store rather than copied into
// state inside an effect — same pattern as lib/hooks/useUserId. The server
// snapshots match what the browser renders before hydration, and the URL does
// not change for the life of the page, so the subscription is a no-op.
function subscribeNever(): () => void {
  return () => {}
}

function readTabFromUrl(): 'signup' | 'login' {
  return new URLSearchParams(window.location.search).get('tab') === 'login' ? 'login' : 'signup'
}

function readOAuthError(): string {
  return new URLSearchParams(window.location.search).get('error')
    ? 'Could not sign in with Google. Please try again.'
    : ''
}

// Where to go once the account exists and the guest's work has been moved onto
// it. The debrief's "Keep this rehearsal" sends ?next=/debrief/<id> so that
// creating an account returns the person to the thing they were keeping rather
// than to a generic first-run screen. Sanitised — see safeNextPath.
function readNextFromUrl(): string | null {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'))
}

export default function SignupPage() {
  const router = useRouter()
  // The URL picks the initial tab and the initial error message; anything the
  // user does afterwards overrides it.
  const urlTab = useSyncExternalStore(subscribeNever, readTabFromUrl, () => 'signup' as const)
  const [chosenTab, setTab] = useState<'signup' | 'login' | null>(null)
  const tab = chosenTab ?? urlTab

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const oauthError = useSyncExternalStore(subscribeNever, readOAuthError, () => '')
  const [errorOverride, setError] = useState<string | null>(null)
  const error = errorOverride ?? oauthError
  const [success, setSuccess] = useState('')
  const [showPass, setShowPass] = useState(false)
  // In-flight state for the provider round trip. Separate from `loading`, which
  // belongs to the email/password submit: both disable both controls, but only
  // one of them should say "One moment..." on the primary button.
  const [googleLoading, setGoogleLoading] = useState(false)
  const [tosChecked, setTosChecked] = useState(false)
  const [view, setView] = useState<'form' | 'verify-email' | 'migration-failed'>('form')
  const nextPath = useSyncExternalStore(subscribeNever, readNextFromUrl, () => null)

  // What a failed migration needs in order to be retried, and where the user
  // was going before it failed. Held rather than discarded because the account
  // now exists and the guest's rehearsals do not belong to it yet — the one
  // state this flow must never redirect away from silently.
  const [stranded, setStranded] = useState<{
    oldUserId: string
    newUserId: string
    then: () => void
  } | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Defensive backstop, not the primary OAuth path — app/auth/callback handles
  // that with the full id sync. This only matters if someone lands back here
  // with a session the Supabase client already restored.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'SIGNED_IN' || !session?.user) return

      const anonymousId = localStorage.getItem('parley_uid')
      localStorage.setItem('parley_uid', session.user.id)
      localStorage.setItem('parley_authenticated', 'true')
      if (session.user.email) localStorage.setItem('parley_email', session.user.email)
      // A real session for a real address. Whatever this browser was before,
      // it is not on a throwaway guest account now.
      clearGuestAccount()

      // Awaited before the redirect: navigating cancels an in-flight request,
      // so the fire-and-forget this used to be could leave the work behind.
      if (anonymousId && anonymousId !== session.user.id) {
        const outcome = await migrateGuestData(anonymousId, session.user.id)
        if (!outcome.ok) {
          setStranded({
            oldUserId: anonymousId,
            newUserId: session.user.id,
            then: () => router.replace(nextPath ?? '/dashboard'),
          })
          setView('migration-failed')
          return
        }
      }
      router.replace(nextPath ?? '/dashboard')
    })
    return () => listener.subscription.unsubscribe()
  }, [router, nextPath])

  const strength =
    password.length >= 12 && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)
      ? 3
      : password.length >= 8 && (/[A-Z]/.test(password) || /[0-9]/.test(password))
        ? 2
        : password.length >= 6
          ? 1
          : 0

  const strengthColor = ['transparent', SIGNAL.clay, SIGNAL.warn, SIGNAL.gain][strength]
  const strengthLabel = ['', 'Weak', 'Good', 'Strong'][strength]

  async function handleSignup() {
    setError('')
    setSuccess('')
    if (!email.includes('@')) return setError('Please enter a valid email address.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (!tosChecked) return setError('Please accept the terms to continue.')

    setLoading(true)
    trackClientEvent('signup_started', { method: 'email' })

    try {
      const { data, error: err } = await supabase.auth.signUp({ email, password })
      if (err) {
        setError(err.message || 'Something went wrong. Please try again.')
        return
      }

      // Supabase returns a user but no session until the confirmation link is
      // clicked, so an unconfirmed sign-up is the "check your email" case and
      // not a failure. Either way the account exists and the guest's work moves
      // onto it now, while this browser still holds the proof of the old id.
      const arrive = () => {
        if (data?.user && !data?.session) {
          // The confirmation link comes back through /auth/callback with no
          // query string of ours, so the destination waits in storage.
          rememberNext(nextPath)
          setView('verify-email')
          return
        }
        setSuccess('Account created. Setting you up...')
        setTimeout(() => {
          window.location.href = nextPath ?? '/onboarding'
        }, 1200)
      }

      if (data?.user) {
        trackClientEvent('signup_completed', { method: 'email' }, data.user.id)

        // Captured before overwriting so anything rehearsed as a guest is
        // migrated rather than orphaned under the old id.
        const anonymousId = localStorage.getItem('parley_uid')
        localStorage.setItem('parley_uid', data.user.id)
        localStorage.setItem('parley_authenticated', 'true')
        localStorage.setItem('parley_email', email)
        clearGuestAccount()

        try {
          await supabase
            .from('users')
            .upsert({ id: data.user.id, email, created_at: new Date().toISOString() }, { onConflict: 'id' })
        } catch {
          // Non-fatal; the row is created lazily elsewhere if this fails.
        }

        // Must run after the upsert — rehearsals reference users.id. Awaited,
        // and its answer read: this is the whole reason the person is here, and
        // it used to be a fire-and-forget whose failure looked identical to
        // success right up until the dashboard came back empty.
        if (anonymousId && anonymousId !== data.user.id) {
          const outcome = await migrateGuestData(anonymousId, data.user.id)
          if (!outcome.ok) {
            setStranded({ oldUserId: anonymousId, newUserId: data.user.id, then: arrive })
            setView('migration-failed')
            return
          }
        }
      }

      arrive()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin() {
    setError('')
    setSuccess('')
    if (!email.includes('@')) return setError('Please enter a valid email address.')
    if (!password) return setError('Please enter your password.')

    setLoading(true)
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Incorrect email or password.')
        return
      }

      // The error was previously discarded, which meant a failed setSession
      // still fell through to the redirect — the user landed on the dashboard
      // signed out, with no explanation.
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })
      if (sessionErr) {
        console.error('[Signin] setSession failed:', sessionErr.message)
        setError('Signed in, but the session could not be stored. Please try again.')
        return
      }

      const anonymousId = localStorage.getItem('parley_uid')
      if (data.user?.id) localStorage.setItem('parley_uid', data.user.id)

      localStorage.setItem('parley_authenticated', 'true')
      localStorage.setItem('parley_email', email)
      clearGuestAccount()

      const arrive = async () => {
        setSuccess('Signing you in...')

        // Checked after the migration resolves, so a just-migrated guest's
        // rehearsals count as history and they skip onboarding. A ?next= from
        // the debrief outranks both: it names the page they were told creating
        // an account would keep.
        let hasHistory = false
        if (data.user?.id) {
          try {
            // The access token, not an id. /api/user/has-history answers only
            // for the session that asks — see the note there on why the id it
            // used to take was an oracle. Sent explicitly rather than relying
            // on SessionSync having already mirrored the cookie, because that
            // mirroring races with this call.
            const histRes = await fetch('/api/user/has-history', {
              headers: { Authorization: `Bearer ${data.access_token}` },
            })
            hasHistory = !!(await histRes.json()).hasHistory
          } catch {
            // Falls through to onboarding, which is the safe direction.
          }
        }

        const destination = nextPath ?? (hasHistory ? '/dashboard' : '/onboarding')
        setTimeout(() => {
          window.location.href = destination
        }, 900)
      }

      if (data.user?.id && anonymousId && anonymousId !== data.user.id) {
        const outcome = await migrateGuestData(anonymousId, data.user.id)
        if (!outcome.ok) {
          setStranded({ oldUserId: anonymousId, newUserId: data.user.id, then: () => void arrive() })
          setView('migration-failed')
          return
        }
      }

      await arrive()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    // Guard rather than rely on the disabled attribute alone: signInWithOAuth
    // navigates away, and a second call fired before that navigation commits
    // would start a second authorisation with a fresh PKCE verifier, leaving
    // the code that comes back unredeemable against the one we kept.
    if (googleLoading || loading) return
    setGoogleLoading(true)
    setError('')
    try {
      // Survives the trip to Google and back. It cannot ride on redirectTo:
      // that URL has to match the Supabase project's redirect allowlist, which
      // is configuration this repository cannot see or change.
      rememberNext(nextPath)
      // The site URL, not window.location.origin — a preview deployment URL
      // would not match the Supabase redirect allowlist.
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${siteUrl}/auth/callback`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      })
      // Surfaces the real Supabase message (e.g. "Unsupported provider") —
      // this fails before the redirect, so the callback page never sees it.
      if (err) {
        console.error('[Google OAuth]', err.message)
        setError(err.message || 'Could not sign in with Google.')
        setGoogleLoading(false)
      }
      // No reset on success: the call above navigates to Google, and clearing
      // the flag would flick the button back to its idle label for the frame
      // before the page goes.
    } catch (e) {
      console.error('[Google OAuth] Exception:', e)
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setGoogleLoading(false)
    }
  }

  async function handleGuest() {
    setLoading(true)
    setError('')
    trackClientEvent('signup_started', { method: 'guest' })

    try {
      const anonEmail = `guest_${Date.now()}_${Math.random().toString(36).slice(2)}@parley-guest.local`
      const anonPassword =
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2).toUpperCase() + '1!'

      const { data, error: err } = await supabase.auth.signUp({
        email: anonEmail,
        password: anonPassword,
        options: { data: { is_anonymous: true, display_name: 'Guest' } },
      })

      if (err) {
        console.error('[Guest] Signup failed:', err.message)
        setError('Could not start a guest session. Try signing up with email.')
        return
      }

      if (data?.user) {
        trackClientEvent('signup_completed', { method: 'guest' }, data.user.id)
        try {
          await supabase.from('users').upsert(
            {
              id: data.user.id,
              email: anonEmail,
              display_name: 'Guest',
              created_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
        } catch {
          // Non-fatal.
        }
        localStorage.setItem('parley_uid', data.user.id)
        localStorage.setItem('parley_authenticated', 'true')
        // The address is @parley-guest.local and the password was generated
        // here and shown to nobody, so nothing can ever sign into this account
        // again. Marking it stops the rest of the product drawing chrome that
        // says the work is safely held, and keeps the debrief's browser-only
        // notice where it belongs. See lib/hooks/useSignedIn.
        markGuestAccount()
      }

      // A FULL RELOAD, DELIBERATELY — not a lint miss. The lines above changed
      // who this browser is: parley_uid now holds a different id. useUserId
      // reads that through useSyncExternalStore whose `subscribe` is a no-op
      // (lib/hooks/useUserId.ts), because the id is generated once and is
      // stable for the life of a page. A client-side router.push() keeps the
      // React tree alive, so every mounted component would go on holding the
      // PREVIOUS id and fetching the previous account's data. The reload is
      // what makes the new identity take.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/onboarding'
    } catch {
      setError('Could not start a guest session.')
    } finally {
      setLoading(false)
    }
  }

  // -- A migration that did not happen ---------------------------------------
  // The account exists; the rehearsals are still under the old browser id. The
  // one thing this screen must not do is redirect as though it had worked.
  if (view === 'migration-failed' && stranded) {
    return (
      <Shell>
        <h1 style={heading}>Your account is ready. Your rehearsals are not on it yet.</h1>
        <p style={body}>
          The account was created, but moving what you rehearsed in this browser
          onto it did not go through. Nothing has been lost — it is still held
          under this browser&apos;s old id — and trying again usually settles it.
        </p>
        <button
          type="button"
          disabled={retrying}
          className="pl-btn pl-btn--primary pl-btn--lg pl-btn--block"
          onClick={async () => {
            setRetrying(true)
            const outcome = await migrateGuestData(stranded.oldUserId, stranded.newUserId)
            setRetrying(false)
            if (outcome.ok) {
              setError('')
              setView('form')
              stranded.then()
              return
            }
            setError(
              'Still not going through. Your rehearsals are safe in this browser — write to support and we will move them across.'
            )
          }}
        >
          {retrying ? 'Moving them across...' : 'Try again'}
        </button>
        {error && (
          <p style={{ ...body, margin: '14px 0 0', fontSize: 13.5 }} role="alert">
            {error}
          </p>
        )}
        <p style={{ ...body, margin: '18px 0 0', fontSize: 13.5, color: PAPER.inkFaint }}>
          You can{' '}
          <button
            onClick={() => {
              setError('')
              setView('form')
              stranded.then()
            }}
            style={linkButton}
          >
            carry on without them
          </button>{' '}
          and sort it out later, or{' '}
          <Link href="/support" className="pl-link">
            ask us to move them
          </Link>
          . Do not clear this browser&apos;s data in the meantime — that is where
          they are.
        </p>
      </Shell>
    )
  }

  // -- Email confirmation ----------------------------------------------------
  if (view === 'verify-email') {
    return (
      <Shell>
        <h1 style={heading}>Check your email</h1>
        <p style={body}>
          We sent a confirmation link to <strong>{email}</strong>. Open it and
          you are signed in. Anything you rehearsed in this browser is already
          on the account.
        </p>
        <p style={{ ...body, fontSize: 13.5, color: PAPER.inkFaint }}>
          Nothing arrived? Check spam, or{' '}
          {/* Clay-deep, not clay: this is a word on cream, and clay as text
              computes to 3.2:1. Same rule as the CSS layer — see F-16. */}
          <button onClick={() => setView('form')} style={linkButton}>
            try a different address
          </button>
          .
        </p>
      </Shell>
    )
  }

  const isSignup = tab === 'signup'

  return (
    <Shell>
      {/* The product's segmented control, not a pill — squared, ruled, and
          labelled in the mono face like every other control label. It was a
          24px pill until 2026-09-13, the one rounded thing on the page that
          decides whether someone signs up. */}
      <div
        className="pl-seg"
        role="group"
        aria-label="Create an account or sign in"
        style={{ marginBottom: 26 }}
      >
        {(['signup', 'login'] as const).map(value => (
          <button
            key={value}
            type="button"
            className="pl-seg__opt"
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value)
              setError('')
              setSuccess('')
            }}
          >
            {value === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        ))}
      </div>

      {/* The count comes from the plan config for the same reason it does on
          the pricing page: it is a promise, and a promise typed out in two
          places drifts from the one the database enforces. */}
      <h1 style={heading}>
        {isSignup ? `${PLAN_FEATURES.free.monthlyRehearsals} rehearsals free` : 'Welcome back'}
      </h1>
      <p style={body}>
        {isSignup
          ? 'No card. Enough to find out whether rehearsing actually changes how the real conversation goes.'
          : 'Your transcripts, debriefs and playbook are where you left them.'}
      </p>

      <label style={label} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && (isSignup ? handleSignup() : handleLogin())}
        autoComplete="email"
        className="pl-input"
        style={input}
      />

      <label style={label} htmlFor="password">
        Password
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id="password"
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (isSignup ? handleSignup() : handleLogin())}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          className="pl-input"
          style={{ ...input, paddingRight: 62 }}
        />
        <button
          type="button"
          onClick={() => setShowPass(v => !v)}
          // A 33x19 hit area was below the 24px minimum and genuinely fiddly
          // one-handed. The padding grows the target without moving the label.
          style={{
            position: 'absolute',
            right: 4,
            top: 4,
            minHeight: 34,
            minWidth: 52,
            padding: '0 10px',
            background: 'none',
            border: 'none',
            borderRadius: 'var(--pl-radius-sm)',
            fontSize: 12.5,
            color: PAPER.inkFaint,
            cursor: 'pointer',
            fontFamily: FONT.sans,
          }}
        >
          {showPass ? 'Hide' : 'Show'}
        </button>
      </div>

      {isSignup && password.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: -10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 3, background: PAPER.surfaceSunken, borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(strength / 3) * 100}%`,
                height: '100%',
                background: strengthColor,
                transition: 'width 0.2s',
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: strengthColor }}>{strengthLabel}</span>
        </div>
      )}

      {isSignup && (
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            fontSize: 13.5,
            color: PAPER.inkMuted,
            lineHeight: 1.55,
            marginBottom: 18,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={tosChecked}
            onChange={e => setTosChecked(e.target.checked)}
            style={{ marginTop: 3, accentColor: SIGNAL.clay, width: 15, height: 15, cursor: 'pointer' }}
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" className="pl-link">
              terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="pl-link">
              privacy policy
            </Link>
            .
          </span>
        </label>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: SIGNAL.claySoft,
            border: `1px solid ${SIGNAL.clay}`,
            borderRadius: RADIUS.md,
            padding: '11px 14px',
            fontSize: 13.5,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            background: SIGNAL.gainSoft,
            border: `1px solid ${SIGNAL.gain}`,
            borderRadius: RADIUS.md,
            padding: '11px 14px',
            fontSize: 13.5,
            marginBottom: 16,
          }}
        >
          {success}
        </div>
      )}

      {/* The same primary control as the brief's door and the room's "Say it",
          so the page that creates the account is drawn like the product it
          creates it for. */}
      <button
        type="button"
        onClick={isSignup ? handleSignup : handleLogin}
        disabled={loading || googleLoading}
        className="pl-btn pl-btn--primary pl-btn--lg pl-btn--block"
      >
        {loading ? 'One moment...' : isSignup ? 'Create account' : 'Sign in'}
      </button>

      {!isSignup && (
        <Link
          href="/reset-password"
          style={{
            display: 'block',
            textAlign: 'center',
            fontSize: 13,
            color: PAPER.inkFaint,
            marginTop: 12,
            textDecoration: 'none',
          }}
        >
          Forgot your password?
        </Link>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 18px' }}>
        <div style={{ flex: 1, height: 1, background: PAPER.line }} />
        <span style={{ fontSize: 12, color: PAPER.inkFaint }}>or</span>
        <div style={{ flex: 1, height: 1, background: PAPER.line }} />
      </div>

      {/* Same control as before — padding, border, radius, type scale, colour
          and copy are unchanged. What is added is the mark, the in-flight
          state, and the disable that stops this racing the email submit next
          to it. Laid out as a centred row so the mark sits with the label;
          the button's own box is untouched. */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googleLoading || loading}
        aria-busy={googleLoading}
        style={{
          width: '100%',
          padding: '12px',
          background: 'transparent',
          border: `1px solid ${PAPER.lineStrong}`,
          borderRadius: RADIUS.md,
          fontSize: 14.5,
          cursor: googleLoading || loading ? 'default' : 'pointer',
          fontFamily: FONT.sans,
          color: PAPER.ink,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: googleLoading || loading ? 0.6 : 1,
        }}
      >
        <GoogleMark />
        {googleLoading ? 'Taking you to Google...' : 'Continue with Google'}
      </button>

      {isSignup && (
        <>
          <button
            onClick={handleGuest}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: 'transparent',
              border: 'none',
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: FONT.sans,
              color: PAPER.inkMuted,
            }}
          >
            Try one without an account
          </button>
          <p style={{ fontSize: 12, color: PAPER.inkFaint, textAlign: 'center', lineHeight: 1.55, margin: '4px 0 0' }}>
            A guest rehearsal is saved to this browser only. Create an account
            later and it comes with you.
          </p>
        </>
      )}
    </Shell>
  )
}

/**
 * Google's "G", inline.
 *
 * Inline rather than from a package: lucide-react, the only icon dependency
 * here, dropped its brand marks, and Google's terms ask that the mark be shown
 * in its own four colours rather than recoloured to match a host palette —
 * which also means it cannot be one of this product's own tokens. Four paths
 * and no network request is cheaper than either alternative.
 *
 * aria-hidden because the button already says "Continue with Google"; a screen
 * reader announcing the mark as well would say it twice.
 */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

// Sign-up carries the site's own chrome.
//
// It is a public, indexable, conversion page, and it used to render a bare
// 100vh card: the only way off it was a wordmark link, and a form asking for
// an email and a password linked to neither the terms nor the privacy policy.
// The nav gives it the library and the pricing; the footer gives it the legal
// routes a sign-up form is expected to carry.
//
// The shell is a flex column rather than a 100vh main, so the card stays
// centred in whatever space is left between the two rather than forcing a
// viewport of its own and pushing the footer off-screen.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: PAPER.bg }}>
      <Nav variant="marketing" />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          fontFamily: FONT.sans,
          color: PAPER.ink,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: PAPER.surface,
            border: `1px solid ${PAPER.line}`,
            borderRadius: RADIUS.lg,
            padding: '30px 30px 26px',
            boxShadow: SHADOW.raised,
          }}
        >
          {children}
        </div>
      </main>
      <Footer />
    </div>
  )
}

const heading: React.CSSProperties = {
  fontFamily: FONT.serif,
  fontSize: TYPE.h2,
  fontWeight: 600,
  letterSpacing: '-0.02em',
  margin: '0 0 8px',
}

const body: React.CSSProperties = {
  fontSize: 14.5,
  color: PAPER.inkMuted,
  lineHeight: 1.6,
  margin: '0 0 22px',
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 13.5,
  fontWeight: 500,
  marginBottom: 6,
}

/** A button that has to read as a link inside a sentence. */
const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: SIGNAL.clayDeep,
  cursor: 'pointer',
  padding: 0,
  fontSize: 'inherit',
  fontFamily: FONT.sans,
  textDecoration: 'underline',
}

/**
 * Spacing only. Everything else — the box, the hover, the disabled state and
 * the focus ring — comes from `.pl-input`, which these fields now carry.
 *
 * This object used to redraw all of it inline, including `outline: 'none'`.
 * An inline outline beats the stylesheet's `:focus-visible` rule whatever its
 * specificity, and because the fields also lacked `.pl-input` they never got
 * the box-shadow ring that replaces it — so the email and password fields on
 * the product's most important form had no visible focus indicator at all.
 * Verified in the browser: both now report a ring.
 */
const input: React.CSSProperties = {
  marginBottom: 16,
}
