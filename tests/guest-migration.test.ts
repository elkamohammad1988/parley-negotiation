import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateGuestData, rememberNext, safeNextPath, takeNext } from '@/lib/guest-migration'

// The browser half of the guest → account handover.
//
// Three call sites — the sign-up form, the sign-in form and the OAuth callback
// — each had their own copy of this fetch, and none of them read the response.
// `POST /api/user/migrate` answers 403 when it refuses and 500 with a
// `failedTables` list when it moves some tables and not others; all of that was
// discarded and the page redirected anyway. Since the browser's parley_uid had
// already been switched to the new account, the rehearsals the person signed up
// to keep were addressed under an id the browser no longer held: from their
// side, creating an account deleted their work.
//
// So the contract these pin is a narrow one. Success is ONLY a 2xx carrying
// `migrated: true`. Everything else is a failure with a reason, and no caller
// may report it as anything else.

const ORIGINAL_FETCH = globalThis.fetch

/** A fetch that answers once with this status and body. */
function answering(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('migrateGuestData', () => {
  it('reports success only when the server says migrated', async () => {
    globalThis.fetch = answering(200, { migrated: true })

    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: true })
  })

  it('sends both ids to the migration endpoint as JSON', async () => {
    const fetchSpy = answering(200, { migrated: true })
    globalThis.fetch = fetchSpy

    await migrateGuestData(OLD, NEW)

    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/user/migrate')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      oldUserId: OLD,
      newUserId: NEW,
    })
  })

  it('does not call success when the server refuses', async () => {
    // The 403 an unrelated caller gets from the ownership checks. This is the
    // case that must never reach a redirect: the account exists, the rows did
    // not move, and the browser has already switched id.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = answering(403, { migrated: false, error: 'Forbidden' })

    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: false, reason: 'refused' })
  })

  it('does not call success when only some tables moved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = answering(500, { migrated: false, failedTables: ['debriefs', 'rehearsals'] })

    expect(await migrateGuestData(OLD, NEW)).toEqual({
      ok: false,
      reason: 'partial',
      failedTables: ['debriefs', 'rehearsals'],
    })
  })

  it('does not call success on a 200 that quietly declined the ids', async () => {
    // `{ migrated: false }` with a 200 is how the route answers ids it will not
    // act on. Reading only res.ok would have called that a success.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = answering(200, { migrated: false })

    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: false, reason: 'refused' })
  })

  it('does not call success when the request never lands', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('is safe to repeat — the retry offered on failure is the same call again', async () => {
    // The server filters its update on the old id, so a second run moves
    // nothing and answers the same way. Nothing here may turn that into a
    // duplicate write or a second failure state.
    const fetchSpy = answering(200, { migrated: true })
    globalThis.fetch = fetchSpy

    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: true })
    expect(await migrateGuestData(OLD, NEW)).toEqual({ ok: true })

    const calls = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual(
      JSON.parse((calls[1][1] as RequestInit).body as string)
    )
  })

  it('never asks the server to migrate an id onto itself, or from nothing', async () => {
    const fetchSpy = answering(200, { migrated: true })
    globalThis.fetch = fetchSpy

    expect(await migrateGuestData(OLD, OLD)).toEqual({ ok: true })
    expect(await migrateGuestData('', NEW)).toEqual({ ok: true })
    expect(await migrateGuestData(OLD, '')).toEqual({ ok: true })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('safeNextPath', () => {
  it('accepts a path on this site', () => {
    expect(safeNextPath('/debrief/abc')).toBe('/debrief/abc')
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
  })

  it('refuses anything that could leave the site', () => {
    // Every one of these reaches a location assignment if it is let through,
    // and it arrives in a query string, which means it arrives from anywhere.
    for (const hostile of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'http://evil.example',
      '/javascript:alert(1)',
      'javascript:alert(1)',
      'evil.example',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(hostile), String(hostile)).toBeNull()
    }
  })

  it('refuses an absurdly long value', () => {
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBeNull()
  })
})

describe('rememberNext / takeNext', () => {
  // The OAuth round trip and the email confirmation link both re-enter the app
  // at a URL this code did not construct, so the destination waits in storage.
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

  it('hands the path back exactly once', () => {
    rememberNext('/debrief/abc')

    expect(takeNext()).toBe('/debrief/abc')
    expect(takeNext()).toBeNull()
  })

  it('sanitises on the way out, not only on the way in', () => {
    // Storage is writable by anything running on the origin, so what comes
    // back out is checked again rather than trusted because it was checked
    // when it went in.
    store['parley_after_auth'] = '//evil.example'

    expect(takeNext()).toBeNull()
  })

  it('clears the path when asked for nothing', () => {
    rememberNext('/debrief/abc')
    rememberNext(null)

    expect(takeNext()).toBeNull()
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

    expect(() => rememberNext('/debrief/abc')).not.toThrow()
    expect(takeNext()).toBeNull()
  })
})
