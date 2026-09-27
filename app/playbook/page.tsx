'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { DIMENSIONS, DIMENSION_BY_ID } from '@/lib/negotiation/dimensions'
import { useUserId } from '@/lib/hooks/useUserId'
import type { DimensionId, PlaybookEntry } from '@/lib/negotiation/types'

// The playbook.
//
// Notes the user keeps about their own negotiating, mostly captured straight
// off a debrief. The inversion worth naming: the system does not remember
// things about the user here — the user records things about themselves, and
// entries stay traceable to the rehearsal that produced them so a line is
// never just advice, it is something that already worked or already failed.

export default function PlaybookPage() {
  const userId = useUserId()
  const [entries, setEntries] = useState<PlaybookEntry[]>([])
  const [loading, setLoading] = useState(true)
  // Whether the load FAILED, as opposed to succeeding and finding nothing.
  // Without this the two are the same screen, so an outage tells someone with
  // forty saved entries that they have never saved one — which reads as the
  // product having lost their work.
  const [loadFailed, setLoadFailed] = useState(false)
  const [filter, setFilter] = useState<DimensionId | 'all'>('all')
  const [draft, setDraft] = useState('')
  const [draftDimension, setDraftDimension] = useState<DimensionId | ''>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // useUserId returns an empty string during SSR and the first
    // paint; there is nothing to fetch until it resolves.
    if (!userId) return
    const uid = userId
    fetch(`/api/playbook?userId=${encodeURIComponent(uid)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (d?.entries) setEntries(d.entries) })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [userId])

  const visible = useMemo(
    () => (filter === 'all' ? entries : entries.filter(e => e.dimension === filter)),
    [entries, filter]
  )

  const usedDimensions = useMemo(() => {
    const set = new Set(entries.map(e => e.dimension).filter(Boolean) as DimensionId[])
    return DIMENSIONS.filter(d => set.has(d.id))
  }, [entries])

  async function add() {
    const note = draft.trim()
    if (!note || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, note, dimension: draftDimension || null }),
      })
      const data = await res.json()
      if (res.ok && data.entry) {
        setEntries(prev => [data.entry, ...prev])
        setDraft('')
        setDraftDimension('')
      }
    } catch {
      // Left in the box so the user does not lose what they typed.
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
    try {
      await fetch(`/api/playbook?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    } catch {
      // Optimistic.
    }
  }

  return (
    <>
      <Nav activePath="/playbook" />
      <main className="pl-container pl-container--narrow pl-page">
        <header className="pl-head">
          <h1 className="pl-head__title">Your playbook</h1>
          <p className="pl-head__lede">
            Lines that worked, questions that opened something up, and the thing
            you keep doing wrong. Most of this arrives from debriefs — read it
            before you walk in.
          </p>
        </header>

        {/* Composer */}
        <div className="pl-pb-composer">
          <label className="pl-sr-only" htmlFor="playbook-note">
            A note for your playbook
          </label>
          <textarea
            id="playbook-note"
            className="pl-pb-composer__field"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Ask what the constraint actually is before naming a number."
            rows={2}
            maxLength={1000}
          />
          <div className="pl-pb-composer__bar">
            <label className="pl-sr-only" htmlFor="playbook-dimension">
              File it under a dimension
            </label>
            <select
              id="playbook-dimension"
              className="pl-select"
              value={draftDimension}
              onChange={e => setDraftDimension(e.target.value as DimensionId | '')}
            >
              <option value="">No dimension</option>
              {DIMENSIONS.map(d => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <button
              onClick={add}
              disabled={!draft.trim() || saving}
              className="pl-btn pl-btn--primary pl-btn--sm pl-pb-composer__add"
            >
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>

        {usedDimensions.length > 0 && (
          <div className="pl-chips">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              All ({entries.length})
            </Chip>
            {usedDimensions.map(d => (
              <Chip key={d.id} active={filter === d.id} onClick={() => setFilter(d.id)}>
                {d.label}
              </Chip>
            ))}
          </div>
        )}

        {loading ? (
          <div className="pl-state pl-state--busy" role="status">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">Opening your playbook</h2>
            <span className="pl-sweep" aria-hidden="true" />
          </div>
        ) : loadFailed ? (
          /* Not the empty state: nothing was read, so nothing can be said
             about what is in there. role="alert" because this replaces content
             the reader asked for. */
          <div className="pl-state" role="alert">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">Could not open your playbook</h2>
            <p className="pl-state__body">
              Your entries are safe — this is a problem reaching them, not a
              problem with them. Reload the page, and if it keeps happening
              give it a few minutes.
            </p>
            <div className="pl-state__actions">
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="pl-state">
            <span className="pl-state__mark" aria-hidden="true" />
            <h2 className="pl-state__title">
              {entries.length === 0 ? 'Nothing in here yet' : 'Nothing filed under that'}
            </h2>
            <p className="pl-state__body">
              {entries.length === 0
                ? 'Run a rehearsal, and save the lines the debrief gives you. A playbook built from your own transcripts beats one built from a book, because you already know it survives contact.'
                : 'Try a different filter, or clear it to see everything.'}
            </p>
            {entries.length === 0 && (
              <div className="pl-state__actions">
                <Link href="/library" className="pl-btn pl-btn--primary">
                  Open the library
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="pl-pb-list">
            {visible.map(entry => (
              <article
                key={entry.id}
                className={`pl-pb-entry${entry.dimension ? ' pl-pb-entry--filed' : ''}`}
              >
                <p className="pl-pb-entry__note">{entry.note}</p>
                <div className="pl-pb-entry__meta">
                  {entry.dimension && (
                    <span className="pl-pb-entry__dim">
                      {DIMENSION_BY_ID[entry.dimension].label}
                    </span>
                  )}
                  {entry.sourceScenarioTitle && (
                    <span>
                      from{' '}
                      {entry.sourceRehearsalId ? (
                        <Link href={`/debrief/${entry.sourceRehearsalId}`} className="pl-link">
                          {entry.sourceScenarioTitle}
                        </Link>
                      ) : (
                        entry.sourceScenarioTitle
                      )}
                    </span>
                  )}
                  <span>
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <button
                    onClick={() => remove(entry.id)}
                    className="pl-pb-entry__remove"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pl-chip"
      aria-pressed={active}
    >
      {children}
    </button>
  )
}
