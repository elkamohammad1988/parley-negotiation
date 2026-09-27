import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GUEST_KEY,
  clearGuestAccount,
  markGuestAccount,
  signedInFrom,
} from '@/lib/hooks/useSignedIn'

// "Signed in" decides two things: which chrome the Nav draws, and whether the
// debrief tells the reader their work is held in this browser and nowhere else.
// The second is the one that matters, and it was wrong for the user it mattered
// most to.
//
// "Try one without an account" creates a real Supabase user —
// guest_<random>@parley-guest.local, with a password generated in the browser
// and shown to nobody. That address cannot receive mail, so the reset link is
// unusable, so nobody signs into that account ever again. It is reachable from
// one browser's localStorage and from nowhere else: the same position as having
// no account at all, except that it also set parley_authenticated. The product
// therefore drew its signed-in chrome for that user AND suppressed the
// browser-only notice — telling the person their work was held safely at the
// exact moment it was held most precariously.

/** A reader over a plain object, standing in for localStorage. */
const reader = (store: Record<string, string>) => (key: string) => store[key] ?? null

const UID = '11111111-1111-4111-8111-111111111111'

describe('signedInFrom', () => {
  it('is true for a real account', () => {
    expect(signedInFrom(reader({ parley_uid: UID, parley_authenticated: 'true' }))).toBe(true)
  })

  it('is false for a browser-only identity', () => {
    // The landing and pricing CTAs mint one of these and open a room on it.
    expect(signedInFrom(reader({ parley_uid: UID }))).toBe(false)
  })

  it('is false for a guest account that cannot be signed back into', () => {
    expect(
      signedInFrom(reader({ parley_uid: UID, parley_authenticated: 'true', [GUEST_KEY]: 'true' }))
    ).toBe(false)
  })

  it('is false with no id at all, however authenticated the flag claims to be', () => {
    expect(signedInFrom(reader({ parley_authenticated: 'true' }))).toBe(false)
  })

  it('reads the flag exactly, not loosely', () => {
    // A truthy-but-not-'true' value is not a claim this hook honours, in
    // either direction.
    expect(signedInFrom(reader({ parley_uid: UID, parley_authenticated: '1' }))).toBe(false)
    expect(
      signedInFrom(reader({ parley_uid: UID, parley_authenticated: 'true', [GUEST_KEY]: 'yes' }))
    ).toBe(true)
  })
})

describe('the guest mark', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('turns a guest account into something the product does not call signed in', () => {
    store.parley_uid = UID
    store.parley_authenticated = 'true'
    expect(signedInFrom(reader(store))).toBe(true)

    markGuestAccount()

    expect(store[GUEST_KEY]).toBe('true')
    expect(signedInFrom(reader(store))).toBe(false)
  })

  it('is cleared by signing into a real account on the same browser', () => {
    store.parley_uid = UID
    store.parley_authenticated = 'true'
    markGuestAccount()

    clearGuestAccount()

    expect(store[GUEST_KEY]).toBeUndefined()
    expect(signedInFrom(reader(store))).toBe(true)
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })

    expect(() => markGuestAccount()).not.toThrow()
    expect(() => clearGuestAccount()).not.toThrow()
  })
})

describe('the paths that produce a real account clear the mark', () => {
  // A mark that is set and never cleared would tell someone who did sign up
  // properly that their work is still browser-only. Asserted against the source
  // because the alternative is driving Supabase auth in a unit test.
  it.each([
    ['app/signup/page.tsx', 3],
    ['app/auth/callback/page.tsx', 1],
  ])('%s clears it', async (path, times) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), path), 'utf-8')
    const calls = source.match(/clearGuestAccount\(\)/g) ?? []
    expect(calls.length, `${path} should clear the guest mark on ${times} path(s)`).toBe(times)
  })

  it('only the guest path sets it', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const signup = readFileSync(join(process.cwd(), 'app/signup/page.tsx'), 'utf-8')
    expect((signup.match(/markGuestAccount\(\)/g) ?? []).length).toBe(1)
  })
})
