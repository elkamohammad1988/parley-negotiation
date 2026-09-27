import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site-url'

// Generated rather than served from public/robots.txt, for one reason that
// matters and one that follows from it.
//
// THE REASON: the static file named no sitemap, so app/sitemap.ts — which
// lists every scenario brief, the pages this product most wants found — was
// discoverable only by a crawler that guessed the conventional path. A sitemap
// URL has to be absolute, and the only honest source for the origin is
// SITE_URL, which a static file cannot read.
//
// WHAT FOLLOWS: the disallow list and the `robots: { index: false }` metadata
// on each private layout now have one place each to drift from, so they are
// written to match. Disallow stops the crawl; the meta tag is what actually
// keeps a linked URL out of the index. Both are needed and neither is
// sufficient alone.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private working material — rehearsal transcripts, scored debriefs, the
      // user's own notes — plus the surfaces that only exist for someone who is
      // already signed in.
      disallow: [
        '/api/',
        '/admin',
        '/room/',
        '/debrief/',
        '/dashboard',
        '/playbook',
        '/progress',
        '/billing',
        '/settings',
        '/privacy-controls',
        '/upgrade',
        '/onboarding',
        '/counterparts/new',
        '/reset-password',
        '/auth/',
        '/maintenance',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
