import { PAPER, SIGNAL, FONT, TYPE, LAYOUT } from '@/lib/design'

// The closing page of the product.
//
// A footer is the last thing on every screen, which makes it the cheapest
// place in a product to look unfinished — three columns of links and a
// copyright line is what a template leaves behind. This one is built as a
// colophon: who this is and what it claims, the index of where you can go,
// and one closing statement set large enough to be read rather than skipped.
//
// The statement is the product's actual mechanic, not a slogan. "Everything
// they were holding, you had to ask for" is the lever ledger in a sentence —
// it is what the debrief counts and what the reveal shows — so the last line
// of the page says the same thing the product does.
//
// Support and legal contact routes are intentionally relative links to on-site
// pages rather than hardcoded addresses or domains. The real contact details,
// legal entity and support address are environment-specific and must be
// configured for the actual Parley deployment before launch — see README.
//
// Every href below resolves to a real route. A footer padded out with a Blog,
// Careers and Docs that 404 is worse than a short one, and a short real one is
// what this is.

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/library', label: 'Scenario library' },
      { href: '/counterparts', label: 'Counterparts' },
      { href: '/playbook', label: 'Playbook' },
      { href: '/progress', label: 'Progress' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/faq', label: 'FAQ' },
      { href: '/support', label: 'Support' },
      { href: '/status', label: 'Status' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/privacy-controls', label: 'Your data' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="pl-footer">
      <div className="pl-footer__inner">
        <div className="pl-footer__grid">
          <div className="pl-footer__brand">
            <span className="pl-footer__mark">Rehearsal room</span>
            <div className="pl-footer__wordmark">
              Parley
              <span aria-hidden="true" style={{ color: SIGNAL.clay }}>
                .
              </span>
            </div>
            <p className="pl-footer__blurb">
              You rehearse a vendor negotiation against a counterpart holding a
              mandate you cannot see. When it ends, you find out what your
              version of the call cost.
            </p>
          </div>

          {COLUMNS.map(col => (
            /* The column head is a div, not a heading: the nav's aria-label
               already names the group, and three <h2>s appended to every page
               in the product would reorder each one's outline for the sake of
               a label a screen reader gets from the landmark anyway. */
            <nav key={col.title} aria-label={col.title} className="pl-footer__col">
              <div className="pl-footer__colhead">{col.title}</div>
              <ul className="pl-footer__list">
                {col.links.map(link => (
                  <li key={link.href}>
                    <a href={link.href} className="pl-footer__link">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* The closing statement. Serif, large, and given room — the one place
            in the chrome where the product states its own mechanic in a full
            sentence instead of a label. */}
        <div className="pl-footer__close">
          <p className="pl-footer__statement">
            Everything they were holding,
            <br />
            you had to ask for.
          </p>
          <div className="pl-footer__meta">
            <span>© {new Date().getFullYear()} Parley</span>
            <span className="pl-footer__dot" aria-hidden="true">
              ·
            </span>
            <span>Rehearsals are private to your account.</span>
          </div>
        </div>
      </div>

      <style>{`
        /* The footer sits on the SUNKEN ground, not the raised one.
           It used to take PAPER.surface — #fffdf8 against a #f7f2e7 page, a
           difference of four values — behind a single hairline. So the last
           third of every screen had no edge and no ground of its own: it read
           as the page running out rather than as the page ending. Sunken is an
           existing token, it is the only one that reads as a base, and every
           tone set on it still clears AA (ink 14.1:1, muted 5.2:1,
           faint 4.6:1). */
        .pl-footer {
          border-top: 1px solid ${PAPER.lineStrong};
          background: ${PAPER.surfaceSunken};
          font-family: ${FONT.sans};
          margin-top: 64px;
        }
        .pl-footer__inner {
          position: relative;
          max-width: ${LAYOUT.page}px;
          margin: 0 auto;
          padding: 52px ${LAYOUT.gutter}px 36px;
        }
        /* A short clay rule laid over the top edge, at the same gutter the
           content starts on. The same signature the nav's wordmark and the
           brand block's square already carry, at the one place the page hands
           over to its colophon — it is what makes the edge read as drawn
           rather than as a default border. */
        .pl-footer__inner::before {
          content: '';
          position: absolute;
          top: -1px;
          left: ${LAYOUT.gutter}px;
          width: 56px;
          height: 2px;
          background: ${SIGNAL.clay};
        }

        .pl-footer__grid {
          display: grid;
          grid-template-columns: 1.7fr repeat(3, minmax(0, 1fr));
          gap: 40px 32px;
        }

        /* ── Brand block ─────────────────────────────────────────────────── */
        /* The same eyebrow the landing page opens every field with: a clay
           square and a tracked mono label. Repeating it here is what ties the
           page that sells the product to the product. */
        .pl-footer__mark {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-family: ${FONT.mono};
          font-size: ${TYPE.micro};
          font-weight: 500;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: ${PAPER.inkFaint};
        }
        .pl-footer__mark::before {
          content: '';
          width: 11px;
          height: 11px;
          border-radius: 2px;
          background: ${SIGNAL.clay};
          flex: 0 0 auto;
        }
        .pl-footer__wordmark {
          font-family: ${FONT.serif};
          font-size: 26px;
          font-weight: 600;
          letter-spacing: -0.025em;
          color: ${PAPER.ink};
          margin: 14px 0 10px;
        }
        .pl-footer__blurb {
          font-size: ${TYPE.small};
          color: ${PAPER.inkMuted};
          line-height: 1.7;
          max-width: 34ch;
          margin: 0;
        }

        /* ── Columns ─────────────────────────────────────────────────────── */
        .pl-footer__col { min-width: 0; }
        /* Set in full ink, not faint. A column head is the thing that tells you
           there are three groups here rather than twelve loose links, and at
           11px tracked mono it stays quiet on weight and case alone — it does
           not also need to be the palest tone in the file. Whispering the only
           structural labels in the block is most of why it read as weak. */
        .pl-footer__colhead {
          font-family: ${FONT.mono};
          font-size: ${TYPE.micro};
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: ${PAPER.ink};
          margin: 0 0 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid ${PAPER.lineStrong};
        }
        .pl-footer__list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        /* .pl-footer__link's box lives in globals.css — the 28px minimum target
           and the clay hover are load-bearing and are left there. Only the
           resting colour is set here, because it used to come from an inline
           style on each anchor and the shared rule never carried one. */
        .pl-footer__link { color: ${PAPER.inkMuted}; }

        /* ── Closing band ────────────────────────────────────────────────── */
        .pl-footer__close {
          margin-top: 48px;
          padding-top: 26px;
          border-top: 1px solid ${PAPER.lineStrong};
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 24px;
        }
        .pl-footer__statement {
          font-family: ${FONT.serif};
          font-size: clamp(19px, 1.5vw + 12px, 27px);
          line-height: 1.28;
          letter-spacing: -0.02em;
          color: ${PAPER.ink};
          margin: 0;
          /* Wide enough that the authored <br /> is the only break. At 24ch the
             measure wrapped first and left "holding," alone on a line, which is
             the one thing a two-line closing statement cannot afford. */
          max-width: 32ch;
        }
        .pl-footer__meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-size: ${TYPE.caption};
          color: ${PAPER.inkFaint};
          padding-bottom: 2px;
        }
        .pl-footer__dot { opacity: 0.6; }

        @media (max-width: 820px) {
          .pl-footer__grid { grid-template-columns: 1fr 1fr; gap: 36px 28px; }
          /* The brand block stops sharing a row with a single column and takes
             the width it was written for. */
          .pl-footer__brand { grid-column: 1 / -1; }
          .pl-footer__close { margin-top: 44px; }
        }

        @media (max-width: 520px) {
          .pl-footer__inner { padding: 44px 20px 36px; }
          /* The accent follows the gutter in. */
          .pl-footer__inner::before { left: 20px; width: 44px; }
          /* Two columns, not one. Collapsing all three groups into a single
             stack put twelve 44px rows end to end and made the footer 1139px
             on a 390px phone — 1.35 screens of nothing but links, which is the
             wall a footer is supposed to avoid being. Paired, the same links
             and the same targets take a little over half that, and it is the
             layout the next breakpoint up already uses. */
          .pl-footer__grid { grid-template-columns: 1fr 1fr; gap: 28px 18px; }
          .pl-footer__blurb { max-width: none; }
          /* Thumb targets rather than a dense desktop index. A 44px row in a
             ~163px column is still comfortably past the 24px minimum. */
          .pl-footer__link { min-height: 44px; }
          /* Stacked, the statement and the meta read as one closing block
             rather than as a line pushed to each edge. */
          .pl-footer__close {
            flex-direction: column;
            align-items: flex-start;
            gap: 18px;
          }
          .pl-footer__statement { max-width: none; }
          /* The support launcher is a 40px fixed circle in the bottom-right
             corner, and at this width it sat on the last words of the meta
             line — measured 16px of overlap over "…your account." at 390.
             Reserving its lane lets the line wrap above it instead of
             disappearing under it. The launcher is not in this file and is
             left alone; the footer simply stops writing underneath it. */
          .pl-footer__meta { padding-right: 52px; }
        }
      `}</style>
    </footer>
  )
}
