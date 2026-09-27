'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase-client'

// Mirrors the Supabase access token into a same-origin cookie so the server can
// verify who is calling.
//
// supabase-js keeps the session in localStorage, which the server cannot read.
// Rather than thread an Authorization header through every fetch in the app —
// a large diff whose failure mode is silent, since a missed call site just
// quietly falls back to the weaker device-token check — the token is mirrored
// here once and verified in one place server-side (lib/auth-server.ts).
//
// This adds no exposure: the same token is already in localStorage, equally
// readable by any script that manages to run on the page. It is not httpOnly
// precisely because supabase-js, not the server, owns the refresh cycle.

const COOKIE = 'parley_at'

function writeCookie(token: string, expiresAtSeconds: number | undefined) {
  // Expire the cookie with the token rather than outliving it, so a stale value
  // is never presented. Capped at an hour: Supabase access tokens are short
  // lived and onAuthStateChange fires again on refresh.
  const now = Math.floor(Date.now() / 1000)
  const maxAge = Math.max(0, Math.min((expiresAtSeconds ?? now + 3600) - now, 3600))
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${COOKIE}=${token}; path=/; max-age=${maxAge}; samesite=lax${secure}`
}

function clearCookie() {
  document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`
}

export default function SessionSync() {
  useEffect(() => {
    let active = true

    // The current session, for a page loaded with an existing login.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session?.access_token) {
        writeCookie(data.session.access_token, data.session.expires_at)
      } else {
        clearCookie()
      }
    })

    // Every later change: sign-in, sign-out, and the hourly silent refresh.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session?.access_token) writeCookie(session.access_token, session.expires_at)
      else clearCookie()
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return null
}
