import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'

// Shared shell for the reading pages — about, FAQ, support, legal.
//
// Exists so those pages are content plus a heading rather than each carrying
// its own copy of a layout, which is how the previous versions had drifted
// into six slightly different type scales.
//
// The shell itself had then drifted the same way: 17px, 21px and 16px inline,
// none of them on the scale, at a 720px measure where LAYOUT caps reading at
// 680. It is drawn in .pl-prose and .pl-head now, so there is one definition
// of what a reading page looks like and it lives in the stylesheet with
// everything else.

export function ContentPage({
  title,
  lede,
  updated,
  children,
}: {
  title: string
  lede?: string
  updated?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      <Nav />
      <main className="pl-container pl-container--reading pl-page">
        <header className="pl-head">
          <h1 className="pl-head__title">{title}</h1>
          {lede && <p className="pl-head__lede">{lede}</p>}
          {updated && <p className="pl-prose-updated">Last updated {updated}</p>}
        </header>
        <div className="pl-prose">{children}</div>
      </main>
      <Footer />
    </>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pl-prose__h">{children}</h2>
}

export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>
}

export function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * Legal and support pages must not assert business facts — legal entity,
 * postal address, support address, domain — that have not been configured for
 * the real deployment. Anywhere one is needed, this renders a visible marker
 * instead, so an unconfigured value is impossible to mistake for a real one.
 */
export function Configure({ what }: { what: string }) {
  return <span className="pl-configure">[configure: {what}]</span>
}
