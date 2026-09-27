'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { SIGNAL } from '@/lib/design'
import type { CatalogueScenario } from '@/lib/negotiation/redact'
import type { Category, Difficulty } from '@/lib/negotiation/types'

// The scenario library.
//
// Filtering is by DEAL, not by skill or difficulty first. People arrive here
// with "our Snowflake renewal is in five weeks", not with "I would like to work
// on my anchoring" — organising it the other way round would be an accurate
// model of the product and a bad model of the user.
//
// Every entry ends on who the vendor puts on the call, because that is the
// thing that decides whether a visitor recognises their own renewal in it.
//
// Laid out as a ruled index rather than a grid of case cards: see .pl-lib-index
// in globals.css. Someone arriving here is scanning six lines for the one that
// is theirs, and a list is what that reading is shaped like.

// The deep variants, because these are 11px uppercase text on a light card and
// the bright ones do not clear AA there — firm measured 4.0:1 and hostile
// 3.5:1 against the slab. Same hue, same reading, 4.8:1 and 8.4:1.
const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  measured: SIGNAL.gain,
  firm: SIGNAL.warnDeep,
  hostile: SIGNAL.clayDeep,
}

export default function LibraryClient({
  scenarios,
  categories,
}: {
  scenarios: CatalogueScenario[]
  categories: { id: Category; label: string }[]
}) {
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scenarios.filter(s => {
      if (category !== 'all' && s.category !== category) return false
      if (!q) return true
      return (
        s.title.toLowerCase().includes(q) ||
        s.premise.toLowerCase().includes(q) ||
        s.counterpartRole.toLowerCase().includes(q)
      )
    })
  }, [scenarios, category, query])

  return (
    <>
      <Nav activePath="/library" />
      <main className="pl-container pl-container--narrow pl-page">
        <div className="pl-head">
          <p className="pl-stamp">The library</p>
          <h1 className="pl-head__title">Which deal are you walking into?</h1>
          <p className="pl-head__lede">
            Pick the closest one. You get the quote, your objective and your real
            constraints — and a counterpart holding a discount authority, an
            approval ladder and a quarter-end clock you are not shown.
          </p>
        </div>

        <div className="pl-lib-search">
          <label className="pl-sr-only" htmlFor="pl-lib-search">
            Search the library
          </label>
          <input
            id="pl-lib-search"
            className="pl-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search renewals, uplifts, terms…"
          />
        </div>

        <div className="pl-chips" role="group" aria-label="Filter by deal type">
          <button
            type="button"
            className="pl-chip"
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              type="button"
              className="pl-chip"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="pl-state">
            <span className="pl-state__mark" aria-hidden="true" />
            <p className="pl-state__title">Nothing here matches that.</p>
            <p className="pl-state__body">
              The library covers renewals and uplifts, price and discount, terms
              and contract, escalation, exit, and new purchases. If your deal is
              not in it, the closest one is usually close enough — who they put
              on the call is what makes it feel like yours.
            </p>
            <div className="pl-state__actions">
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={() => { setQuery(''); setCategory('all') }}
              >
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <ul className="pl-lib-index">
            {visible.map(s => (
              <li key={s.slug}>
                <Link href={`/library/${s.slug}`} className="pl-case">
                  <div className="pl-case__meta">
                    <span className="pl-case__cat">{s.categoryLabel}</span>
                    <span
                      className="pl-case__diff"
                      style={{ color: DIFFICULTY_COLOR[s.difficulty as Difficulty] }}
                    >
                      {s.difficultyLabel}
                    </span>
                  </div>

                  <div className="pl-case__deal">
                    <h2 className="pl-case__title">{s.title}</h2>
                    <p className="pl-case__premise">{s.premise}</p>
                  </div>

                  <div className="pl-case__foot">
                    <span className="pl-stamp">Across the table</span>
                    <span className="pl-case__role">{s.counterpartRole}</span>
                  </div>

                  <span className="pl-case__time">{s.estimatedMinutes} min</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  )
}
