'use client'
import { usePathname } from 'next/navigation'
import SupportWidget from '@/app/components/SupportWidget'
import CookieBanner from '@/app/components/CookieBanner'

// The floating chrome — support launcher and cookie notice.
//
// Both are suppressed inside a live rehearsal. They are fixed-position overlays
// anchored to the bottom of the viewport, which is exactly where the room puts
// the composer, so they landed on top of the one control the screen exists for.
// On a phone the cookie notice covered the input entirely.
//
// Beyond the collision: the room is a timed conversation someone is trying to
// concentrate inside. A cookie banner interrupting that is worse than a cookie
// banner interrupting a marketing page, and the user reaches the room by
// crossing a deliberate threshold — every other surface in the product has
// already had the chance to ask.
//
// The notice is not skipped, only deferred: it shows on every other route,
// including the debrief the rehearsal hands off to.

/** Routes that own the whole viewport and must not have anything floated over them. */
function isFocusedSurface(pathname: string | null): boolean {
  return !!pathname && pathname.startsWith('/room/')
}

export default function GlobalChrome() {
  const pathname = usePathname()
  if (isFocusedSurface(pathname)) return null

  return (
    <>
      <SupportWidget />
      <CookieBanner />
    </>
  )
}
