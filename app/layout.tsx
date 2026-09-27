import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { SITE_URL } from '@/lib/site-url'
import './globals.css'
import GlobalChrome from '@/app/components/GlobalChrome'
import SkipLink from '@/app/components/SkipLink'
import ErrorBoundary from '@/app/components/ErrorBoundary'
import SessionSync from '@/app/components/SessionSync'
import { ToastContainer } from '@/app/components/Toast'

// Inter for UI, Source Serif for reading surfaces (briefs, debriefs, playbook
// notes), IBM Plex Mono for scores and the room clock — tabular figures so a
// running timer does not jitter.
//
// The files are committed under app/fonts rather than fetched by name from
// next/font/google. Google's loader downloads the woff2 at build time, which
// makes a build — and a dev server start — fail whenever fonts.gstatic.com is
// slow or unreachable. It failed here often enough to be worth the 200KB. All
// three families are SIL Open Font Licence, so redistributing them in the repo
// is fine.
//
// Only the latin subset is included, which is what the product ships copy in.
// If a language needing latin-ext or cyrillic is ever added, the extra subset
// has to be downloaded and declared here — it will not appear on its own.
//
// These are the only definition of --pl-font-*; globals.css deliberately does
// not declare them. lib/design.ts reads them through FONT.
const inter = localFont({
  src: './fonts/Inter-var.woff2',
  // The file carries Inter's full 100–900 axis. The declared range used to stop
  // at 600, which silently clamped anything heavier — nothing in the app asked
  // for it, so nothing broke, but the landing page's display type does. Widening
  // the declaration is additive: every existing 400/500/600 renders identically.
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--pl-font-sans',
  fallback: ['system-ui', '-apple-system', 'sans-serif'],
})

const sourceSerif = localFont({
  src: './fonts/SourceSerif4-var.woff2',
  weight: '400 600',
  style: 'normal',
  display: 'swap',
  variable: '--pl-font-serif',
  fallback: ['Georgia', 'serif'],
  // Metric-matched against a serif, so the fallback does not reflow the hero
  // when the real face lands.
  adjustFontFallback: 'Times New Roman',
})

// Not a variable font, so each weight is a separate file.
const plexMono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-500.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--pl-font-mono',
  fallback: ['ui-monospace', 'monospace'],
})

const TITLE = 'Parley — Rehearse the vendor negotiation before it costs you'
const DESCRIPTION =
  'Rehearse software and vendor renewals from the buyer’s chair, against an AI counterpart holding the discount authority you cannot see. Scored on five dimensions, with the vendor’s real mandate revealed at the end.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'vendor negotiation training',
    'SaaS renewal negotiation',
    'procurement negotiation practice',
    'software contract negotiation',
    'price increase pushback',
    'negotiation rehearsal',
  ],
  authors: [{ name: 'Parley' }],
  creator: 'Parley',
  publisher: 'Parley',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Parley',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  metadataBase: new URL(SITE_URL),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceSerif.variable} ${plexMono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" href="/favicon-32x32.png?v=3" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png?v=3" type="image/png" sizes="16x16" />
        <meta name="theme-color" content="#f7f2e7" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Parley" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'Parley',
              url: SITE_URL,
              description: DESCRIPTION,
              applicationCategory: 'BusinessApplication',
            }),
          }}
        />
      </head>
      <body>
        <SkipLink />
        {/* Mirrors the Supabase access token into a cookie so the server can
            verify identity on API calls. Renders nothing. */}
        <SessionSync />
        {/* A plain div rather than <main>: pages render their own <main>
            landmark, and nesting them would be invalid. This only gives the
            skip link a stable anchor. */}
        <div id="main-content">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
        {/* Support launcher and cookie notice. Suppressed inside a live
            rehearsal, where they landed on top of the composer. */}
        <GlobalChrome />
        <ToastContainer />
        <script
          dangerouslySetInnerHTML={{
            __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').catch(function() {});
            });
          }
        `,
          }}
        />
      </body>
    </html>
  )
}
