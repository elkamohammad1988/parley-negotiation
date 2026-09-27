'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PAPER, SIGNAL, FONT, TYPE, LAYOUT, Z } from '@/lib/design'
import { Button } from '@/app/components/ui'
import { useSignedIn } from '@/lib/hooks/useSignedIn'

// Primary navigation.
//
// Ordered as the work actually happens — Library (find the situation),
// Counterparts (choose who you face), Playbook (what you have learned),
// Progress (whether it is working). Dashboard sits behind the wordmark rather
// than taking a slot, because a signed-in user lands there anyway.
//
// `variant="marketing"` drops that set to the one link a stranger can act on.
// Playbook and Progress are places you go once you have rehearsed something;
// offered to a first-time visitor they are four unexplained words competing
// with the page's argument and four ways out of it before it has been made.
// The landing page passes it; every signed-in surface keeps the full set.
//
// THE BAR IS A MASTHEAD, not a toolbar. Three things at three weights, read
// left to right: who this is, where you can go, and the one thing to do. They
// are separated by hairlines rather than by gaps alone, because a rule is what
// makes a row of links read as an index rather than as a strip of buttons —
// and an index is what the rest of this product already looks like.
//
// Two earlier details are deliberately gone. The bar was translucent with a
// 10px backdrop blur, which is the one move every product of this kind makes
// and which put a faintly different cream over the page's own; it is now the
// same solid PAPER.bg as the page, so the only thing separating them is a
// line. And the active link was a filled pill — the shape of a toolbar. It is
// now a clay rule sitting on the bar's own bottom edge, which is a tab in a
// printed index and is the same clay the wordmark's period uses.

const LINKS = [
  { href: '/library', label: 'Library' },
  { href: '/counterparts', label: 'Counterparts' },
  { href: '/playbook', label: 'Playbook' },
  { href: '/progress', label: 'Progress' },
]

/** What a visitor who has never used Parley is offered. */
const MARKETING_LINKS = [{ href: '/library', label: 'The deals' }]

// Sign-in state is a display hint read from localStorage — see
// lib/hooks/useSignedIn for why it is read as an external store and for the
// one definition of "signed in" this and the debrief share. Every route that
// matters checks authorisation on the server.

export default function Nav({
  activePath,
  variant = 'app',
}: {
  activePath?: string
  variant?: 'app' | 'marketing'
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  const signedIn = useSignedIn()

  const active = activePath ?? pathname
  // A signed-in visitor on the landing page is not a stranger, so they get the
  // full set back — the reduced nav is about first contact, not about the page.
  const links = variant === 'marketing' && !signedIn ? MARKETING_LINKS : LINKS

  // Sticky, and the only thing that changes on scroll is the weight of the
  // hairline under it. No shrinking, no shadow appearing, no blur — those all
  // announce the header and this product does not need announcing. The bar
  // sits on the same cream as the page, so once the page has moved under it
  // the line has to do slightly more work to stay a boundary. That is the
  // whole behaviour.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // What the phone drawer holds.
  //
  // Below 820px the bar keeps only the wordmark, the primary action and the
  // toggle, because the right-hand cluster — Pricing, Settings, the button and
  // the toggle — measured 292px and did not collapse, so a signed-in page
  // scrolled sideways on every phone (documented in ROADMAP.md). Hiding those
  // two links without rehoming them would make Settings unreachable on a phone,
  // so the drawer takes them: it is the only place they exist at that width.
  const drawerLinks = [
    ...links,
    { href: '/pricing', label: 'Pricing' },
    ...(signedIn ? [{ href: '/settings', label: 'Settings' }] : []),
  ]
  // Closing the drawer belongs to the tap that navigates, not to an effect
  // watching the path. Leaving it open over the new page is the standard
  // mobile-nav bug, and this way it also closes when the tapped link is the
  // page you are already on.
  const closeMenu = () => setMenuOpen(false)

  return (
    <nav
      aria-label="Primary"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: Z.sticky,
        background: PAPER.bg,
        borderBottom: `1px solid ${scrolled ? PAPER.lineStrong : PAPER.line}`,
        transition: 'border-color var(--pl-base) var(--pl-ease-out)',
        fontFamily: FONT.sans,
      }}
    >
      <div
        className="pl-nav-bar"
        style={{
          maxWidth: LAYOUT.page,
          margin: '0 auto',
          padding: `0 ${LAYOUT.gutter}px`,
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          minHeight: 62,
        }}
      >
        <Link
          href={signedIn ? '/dashboard' : '/'}
          className="pl-wordmark"
          aria-label={signedIn ? 'Parley — dashboard' : 'Parley — home'}
        >
          Parley
          <span aria-hidden="true" style={{ color: SIGNAL.clay }}>
            .
          </span>
        </Link>

        <span className="pl-nav-rule" aria-hidden="true" />

        <div className="pl-nav-links">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="pl-navlink"
              aria-current={active === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="pl-nav-end">
          <Link href="/pricing" className="pl-navlink pl-navlink--quiet">
            Pricing
          </Link>
          {signedIn && (
            <Link href="/settings" className="pl-navlink pl-navlink--quiet">
              Settings
            </Link>
          )}

          <span className="pl-nav-rule pl-nav-rule--end" aria-hidden="true" />

          {signedIn ? (
            <Button href="/library" size="sm">
              New rehearsal
            </Button>
          ) : (
            /* On the marketing surface this points where the page's own CTA
               points. Sending a convinced visitor to a signup form instead of
               into a rehearsal is the one competing destination the landing
               page had, and the product already decided that the account ask
               belongs at the debrief, where there is something worth keeping.
               Everywhere else /signup is still the right door. */
            <Button href={variant === 'marketing' ? '/library' : '/signup'} size="sm">
              {variant === 'marketing' ? 'Start a rehearsal' : 'Start free'}
            </Button>
          )}

          <button
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="pl-nav-drawer"
            onClick={() => setMenuOpen(v => !v)}
            className="pl-nav-toggle"
          >
            {/* Two rules, not a ☰ glyph. The character renders at a different
                weight and baseline in every platform's fallback font, which is
                the smallest possible detail that makes a bar look unmade. */}
            <span className="pl-nav-toggle__bars" aria-hidden="true" data-open={menuOpen}>
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="pl-nav-drawer" className="pl-nav-drawer">
          {drawerLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="pl-nav-drawer-link"
              onClick={closeMenu}
              aria-current={active === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <style>{`
        /* ── Brand ───────────────────────────────────────────────────────────
           Serif inside an otherwise sans interface, which is the same contrast
           the transcript uses for the counterpart's voice. The period is the
           one place clay appears in the chrome. The hover deepens the whole
           mark rather than animating the dot, which at this size reads as a
           glitch. */
        .pl-wordmark {
          display: inline-flex;
          align-items: center;
          align-self: center;
          font-family: ${FONT.serif};
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.025em;
          text-decoration: none;
          color: ${PAPER.ink};
          flex-shrink: 0;
          padding: 4px 0;
          transition: opacity var(--pl-fast) var(--pl-ease-out);
        }
        .pl-wordmark:hover { opacity: 0.68; }

        /* The masthead rule. A gap separates; a line states that two things
           are different kinds of thing. */
        .pl-nav-rule {
          width: 1px;
          align-self: center;
          height: 20px;
          background: ${PAPER.line};
          margin: 0 22px;
          flex: 0 0 auto;
        }
        .pl-nav-rule--end { margin: 0 14px 0 16px; }

        .pl-nav-links {
          display: flex;
          align-items: stretch;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .pl-nav-end {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
          flex-shrink: 0;
        }

        /* ── Links ───────────────────────────────────────────────────────────
           Each link is a full-height column so the active rule can sit on the
           bar's own bottom edge rather than floating under the text. */
        .pl-navlink {
          position: relative;
          display: inline-flex;
          align-items: center;
          font-size: ${TYPE.small};
          padding: 0 13px;
          text-decoration: none;
          color: var(--pl-ink-muted);
          transition: color var(--pl-fast) var(--pl-ease-out);
        }
        .pl-navlink::after {
          content: '';
          position: absolute;
          left: 13px;
          right: 13px;
          bottom: -1px;
          height: 2px;
          background: ${SIGNAL.clay};
          transform: scaleX(0);
          transform-origin: left;
          transition: transform var(--pl-base) var(--pl-ease-out);
        }
        .pl-navlink:hover { color: var(--pl-ink); }
        .pl-navlink:hover::after { transform: scaleX(1); opacity: 0.35; }

        /* The current page is marked by aria-current, so the styling and the
           accessibility tree cannot drift apart. */
        .pl-navlink[aria-current='page'] {
          color: var(--pl-ink);
          font-weight: 500;
        }
        .pl-navlink[aria-current='page']::after { transform: scaleX(1); opacity: 1; }

        /* Secondary. Quieter type, no rule, and sitting past the hairline so
           the eye reads them as support rather than as product. */
        /* min-height, because these sit in a centred flex row rather than the
           stretched one the primary links live in, so they take only their
           line box — which measured 19px and failed WCAG 2.5.8's 24px minimum.
           The primary links clear it by being full bar height. */
        .pl-navlink--quiet {
          font-size: ${TYPE.caption};
          color: var(--pl-ink-faint);
          padding: 0 9px;
          min-height: 32px;
        }
        .pl-navlink--quiet:hover { color: var(--pl-ink-muted); }
        .pl-navlink--quiet::after { display: none; }

        /* ── Mobile toggle ───────────────────────────────────────────────── */
        .pl-nav-toggle {
          display: none;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          margin-left: 4px;
          padding: 0;
          background: transparent;
          border: 1px solid ${PAPER.line};
          border-radius: var(--pl-radius-md);
          cursor: pointer;
          color: ${PAPER.ink};
          transition: border-color var(--pl-fast) var(--pl-ease-out),
                      background-color var(--pl-fast) var(--pl-ease-out);
        }
        .pl-nav-toggle:hover {
          border-color: ${PAPER.lineStrong};
          background: var(--pl-surface-sunken);
        }
        .pl-nav-toggle__bars {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          width: 17px;
        }
        .pl-nav-toggle__bars > span {
          display: block;
          height: 1.5px;
          width: 100%;
          background: currentColor;
          transition: transform var(--pl-fast) var(--pl-ease-out);
        }
        /* Open reads as a close: the two rules cross. One transform each, no
           third bar to fade, nothing that bounces. */
        .pl-nav-toggle__bars[data-open='true'] > span:first-child {
          transform: translateY(3.25px) rotate(45deg);
        }
        .pl-nav-toggle__bars[data-open='true'] > span:last-child {
          transform: translateY(-3.25px) rotate(-45deg);
        }

        /* ── Drawer ──────────────────────────────────────────────────────── */
        .pl-nav-drawer {
          display: none;
          border-top: 1px solid var(--pl-line);
          padding: 4px ${LAYOUT.gutter}px 12px;
          background: var(--pl-surface);
        }
        .pl-nav-drawer-link {
          display: flex;
          align-items: center;
          min-height: 48px;
          padding: 0 0 0 13px;
          margin-left: -13px;
          font-size: ${TYPE.body};
          color: var(--pl-ink-muted);
          text-decoration: none;
          border-bottom: 1px solid var(--pl-line);
          border-left: 2px solid transparent;
          transition: color var(--pl-fast) var(--pl-ease-out),
                      border-left-color var(--pl-fast) var(--pl-ease-out);
        }
        .pl-nav-drawer-link:hover { color: var(--pl-ink); }
        /* The same clay mark as the desktop bar, turned on its side — the
           drawer is the same index read as a column. */
        .pl-nav-drawer-link[aria-current='page'] {
          font-weight: 500;
          color: var(--pl-ink);
          border-left-color: ${SIGNAL.clay};
        }
        .pl-nav-drawer-link:last-child { border-bottom: 0; }

        @media (max-width: 820px) {
          .pl-nav-links { display: none !important; }
          .pl-nav-rule { display: none !important; }
          .pl-nav-toggle { display: inline-flex !important; }
          .pl-nav-drawer { display: block !important; }
          /* The secondary links move into the drawer at this width — see
             drawerLinks above. Leaving them in the bar is what pushed the
             toggle to 406px in a 390px viewport. */
          .pl-navlink--quiet { display: none !important; }
          .pl-nav-bar { min-height: 58px; }
        }

        /* Below the narrowest common phone the wordmark's gap and the button's
           label are the last things that can give. Nothing is removed; the bar
           just stops reserving space it does not have. */
        @media (max-width: 400px) {
          .pl-nav-bar { padding-left: 16px !important; padding-right: 16px !important; }
          .pl-nav-end { gap: 0; }
          .pl-nav-toggle { margin-left: 2px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .pl-navlink::after,
          .pl-nav-toggle__bars > span { transition: none; }
        }
      `}</style>
    </nav>
  )
}
