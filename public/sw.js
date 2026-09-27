// Parley service worker.
//
// Two rules worth knowing about, both consequences of what this app does:
//
//  1. Nothing under /room, /debrief, /dashboard, /playbook or /progress is
//     ever cached. Those pages contain private transcripts and scores, and a
//     shared or borrowed device must not be able to page back into someone
//     else's rehearsal from the cache after they have signed out.
//
//  2. The pre-cache is the marketing shell only. A rehearsal cannot run
//     offline anyway — it needs the model — so pretending otherwise by
//     caching the room would produce a page that loads and then cannot do the
//     one thing it exists for.

const CACHE = 'parley-v1'

const STATIC = ['/', '/library', '/pricing', '/manifest.json']

// Everything private. Matched as a prefix against the pathname.
const NEVER_CACHE = [
  '/room/',
  '/debrief/',
  '/dashboard',
  '/playbook',
  '/progress',
  '/settings',
  '/billing',
  '/admin',
  '/privacy-controls',
]

function isPrivate(pathname) {
  return NEVER_CACHE.some(prefix => pathname.startsWith(prefix))
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(STATIC))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (isPrivate(url.pathname)) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(cache => cache.put(event.request, clone))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
