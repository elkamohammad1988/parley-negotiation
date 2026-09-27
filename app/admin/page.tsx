'use client'
import { useCallback, useEffect, useState } from 'react'
import { PAPER, SIGNAL, FONT, RADIUS, scoreBand } from '@/lib/design'
import { PLAN_NAMES, PLAN_ORDER, type Plan } from '@/lib/plans'

// Operator panel.
//
// Organised around the question that actually matters for this product: do
// people who open a room reach a debrief? Everything else is secondary. Total
// messages sent is deliberately not a headline figure: a rehearsal that never
// ends is a failure, not engagement.

/**
 * Labels a figure with what it was actually computed over.
 *
 * The mean score used to be captioned "across all debriefs" while the query
 * behind it was capped by PostgREST at db-max-rows — so the caption asserted
 * something the number could not deliver, and said it most confidently at
 * exactly the scale where it stopped being true. This says "the most recent N"
 * when the sample hit its ceiling and "across all N" when it did not.
 */
function sampleNote(n: number | undefined, ceiling: number | undefined, noun: string): string {
  if (n === undefined) return `across ${noun}`
  if (ceiling !== undefined && n >= ceiling) return `most recent ${n.toLocaleString()} ${noun}`
  return `across all ${n.toLocaleString()} ${noun}`
}

interface Stats {
  users: { total: number; newToday: number; activeLast7Days: number; activeSampledFrom?: number }
  rehearsals: {
    total: number
    today: number
    completed: number
    debriefed: number
    debriefRate: string
    meanScore: number | null
    meanScoreSampledFrom?: number
  }
  safety: { totalFlags: number; criticalViolations: number }
  subscriptions: {
    breakdown: Record<string, number>
    totalPaid: number
    mrr: string
    arr: string
  }
  library: { topScenarios: { slug: string; count: number }[]; sampledFrom?: number }
  // The row ceiling the sampled figures were computed under — see the header of
  // app/api/admin/stats. Optional so an older cached response still types.
  sampleCeiling?: number
  generatedAt: string
}

interface Funnel {
  counts: Record<string, number>
  byScenario: Record<string, number>
  byCounterpart: Record<string, number>
  scoreBands: { costly: number; leaking: number; workable: number; strong: number }
  outcomes: Record<string, number>
}

type Tab = 'overview' | 'funnel' | 'safety' | 'accounts'

type AdminData =
  | { unauthorized: true }
  | { unauthorized: false; stats: Stats | null; funnel: Funnel | null }

/** Fetches both admin feeds. Touches no state; `apply` in the page does that. */
async function fetchAdminData(): Promise<AdminData> {
  const [statsRes, funnelRes] = await Promise.all([
    fetch('/api/admin/stats'),
    fetch('/api/admin/analytics-funnel'),
  ])
  if (statsRes.status === 401 || funnelRes.status === 401) return { unauthorized: true }
  return {
    unauthorized: false,
    stats: statsRes.ok ? await statsRes.json() : null,
    funnel: funnelRes.ok ? await funnelRes.json() : null,
  }
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  const [stats, setStats] = useState<Stats | null>(null)
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [loading, setLoading] = useState(false)

  const [identifier, setIdentifier] = useState('')
  const [plan, setPlan] = useState<Plan>('practitioner')
  const [planResult, setPlanResult] = useState('')

  const apply = useCallback((data: AdminData) => {
    if (data.unauthorized) {
      setAuthed(false)
      return
    }
    if (data.stats) setStats(data.stats)
    if (data.funnel) setFunnel(data.funnel)
    setAuthed(true)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      apply(await fetchAdminData())
    } catch {
      setLoginError('Could not load admin data.')
    }
    setLoading(false)
  }, [apply])

  useEffect(() => {
    // The session cookie is httpOnly, so the only way to know whether we are
    // signed in is to ask for something that requires it. State is set in the
    // promise callbacks, never synchronously in the effect body.
    fetchAdminData()
      .then(apply)
      .catch(() => setLoginError('Could not load admin data.'))
  }, [apply])

  async function signIn() {
    setLoginError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        setLoginError('Incorrect password.')
        return
      }
      setPassword('')
      await load()
    } catch {
      setLoginError('Could not reach the server.')
    }
  }

  async function setUserPlan() {
    setPlanResult('')
    try {
      const res = await fetch('/api/admin/promote-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), plan }),
      })
      const data = await res.json()
      setPlanResult(res.ok ? `Set to ${PLAN_NAMES[plan]}.` : data.error || 'Failed.')
      if (res.ok) setIdentifier('')
    } catch {
      setPlanResult('Could not reach the server.')
    }
  }

  if (!authed) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: PAPER.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: FONT.sans,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 360,
            background: PAPER.surface,
            border: `1px solid ${PAPER.line}`,
            borderRadius: RADIUS.lg,
            padding: '28px 26px',
          }}
        >
          <h1 style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 600, margin: '0 0 18px' }}>
            Admin
          </h1>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="Password"
            style={{
              width: '100%',
              padding: '11px 13px',
              border: `1px solid ${PAPER.lineStrong}`,
              borderRadius: RADIUS.md,
              fontSize: 15,
              fontFamily: FONT.sans,
              marginBottom: 12,
              outline: 'none',
              background: PAPER.bg,
              color: PAPER.ink,
            }}
          />
          {loginError && (
            <p style={{ fontSize: 13.5, color: SIGNAL.clayDeep, margin: '0 0 12px' }}>{loginError}</p>
          )}
          <button
            onClick={signIn}
            style={{
              width: '100%',
              padding: '11px',
              background: SIGNAL.clay,
              // 5.03:1 rather than white's 3.53:1 — see app/error.tsx.
              color: SIGNAL.onClay,
              border: 'none',
              borderRadius: RADIUS.md,
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: FONT.sans,
            }}
          >
            Sign in
          </button>
        </div>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', background: PAPER.bg, fontFamily: FONT.sans }}>
      <div
        style={{
          borderBottom: `1px solid ${PAPER.line}`,
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          background: PAPER.surface,
        }}
      >
        <span style={{ fontFamily: FONT.serif, fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>
          Parley<span style={{ color: SIGNAL.clay }}>.</span>
        </span>
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            padding: '3px 8px',
            borderRadius: RADIUS.sm,
            background: SIGNAL.claySoft,
            color: SIGNAL.clayDeep,
            fontWeight: 600,
          }}
        >
          Admin
        </span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
          {(['overview', 'funnel', 'safety', 'accounts'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 12px',
                fontSize: 13.5,
                borderRadius: RADIUS.sm,
                border: 'none',
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontFamily: FONT.sans,
                background: tab === t ? PAPER.surfaceSunken : 'transparent',
                color: tab === t ? PAPER.ink : PAPER.inkMuted,
                fontWeight: tab === t ? 500 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          style={{
            marginLeft: 'auto',
            padding: '6px 13px',
            fontSize: 13,
            border: `1px solid ${PAPER.lineStrong}`,
            background: 'transparent',
            borderRadius: RADIUS.sm,
            cursor: 'pointer',
            fontFamily: FONT.sans,
            color: PAPER.ink,
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 24px 60px' }}>
        {tab === 'overview' && stats && (
          <>
            <Grid>
              <Stat label="Users" value={String(stats.users.total)} sub={`+${stats.users.newToday} today`} />
              <Stat
                label="Active, 7 days"
                value={String(stats.users.activeLast7Days)}
                sub={
                  stats.sampleCeiling !== undefined &&
                  (stats.users.activeSampledFrom ?? 0) >= stats.sampleCeiling
                    ? 'rehearsed at least once (floor)'
                    : 'rehearsed at least once'
                }
              />
              <Stat
                label="Rehearsals"
                value={String(stats.rehearsals.total)}
                sub={`${stats.rehearsals.today} today`}
              />
              <Stat
                label="Reached a debrief"
                value={stats.rehearsals.debriefRate}
                sub={`${stats.rehearsals.debriefed} of ${stats.rehearsals.total}`}
                highlight
              />
              <Stat
                label="Mean score"
                value={stats.rehearsals.meanScore !== null ? String(stats.rehearsals.meanScore) : '—'}
                sub={sampleNote(stats.rehearsals.meanScoreSampledFrom, stats.sampleCeiling, 'debriefs')}
                color={stats.rehearsals.meanScore !== null ? scoreBand(stats.rehearsals.meanScore).textColor : undefined}
              />
              <Stat label="MRR" value={`$${stats.subscriptions.mrr}`} sub={`${stats.subscriptions.totalPaid} paid`} />
            </Grid>

            <Panel title="Plans">
              {PLAN_ORDER.filter(p => p !== 'free').map(p => (
                <Row key={p} label={PLAN_NAMES[p]} value={String(stats.subscriptions.breakdown[p] || 0)} />
              ))}
            </Panel>

            <Panel
              title="Most rehearsed scenarios"
              subtitle={sampleNote(stats.library.sampledFrom, stats.sampleCeiling, 'rehearsals')}
            >
              {stats.library.topScenarios.length === 0 ? (
                <Empty>No rehearsals yet.</Empty>
              ) : (
                stats.library.topScenarios.map(s => (
                  <Row key={s.slug} label={s.slug} value={String(s.count)} />
                ))
              )}
            </Panel>
          </>
        )}

        {tab === 'funnel' && funnel && (
          <>
            <Panel title="Last 30 days">
              {Object.entries(funnel.counts).map(([name, count]) => (
                <Row key={name} label={name.replace(/_/g, ' ')} value={String(count)} />
              ))}
            </Panel>

            <Panel title="Score distribution">
              <p style={{ fontSize: 13, color: PAPER.inkMuted, margin: '0 0 12px', lineHeight: 1.6 }}>
                A healthy spread means the debrief is still discriminating. If
                everything piles into one band, the scoring prompt has stopped
                telling anyone anything useful.
              </p>
              <Row label="Costly (0-34)" value={String(funnel.scoreBands.costly)} />
              <Row label="Leaking (35-54)" value={String(funnel.scoreBands.leaking)} />
              <Row label="Workable (55-74)" value={String(funnel.scoreBands.workable)} />
              <Row label="Strong (75-100)" value={String(funnel.scoreBands.strong)} />
            </Panel>

            <Panel title="Outcomes">
              {Object.keys(funnel.outcomes).length === 0 ? (
                <Empty>No debriefs yet.</Empty>
              ) : (
                Object.entries(funnel.outcomes).map(([outcome, count]) => (
                  <Row key={outcome} label={outcome.replace(/-/g, ' ')} value={String(count)} />
                ))
              )}
            </Panel>

            <Panel title="Counterparts chosen">
              {Object.keys(funnel.byCounterpart).length === 0 ? (
                <Empty>No rehearsals yet.</Empty>
              ) : (
                Object.entries(funnel.byCounterpart)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, count]) => <Row key={id} label={id} value={String(count)} />)
              )}
            </Panel>
          </>
        )}

        {tab === 'safety' && stats && (
          <>
            <Grid>
              <Stat label="Flags" value={String(stats.safety.totalFlags)} sub="all categories" />
              <Stat
                label="Critical violations"
                value={String(stats.safety.criticalViolations)}
                sub="immutable log"
                color={stats.safety.criticalViolations > 0 ? SIGNAL.clay : undefined}
              />
            </Grid>

            <Panel title="Where to look">
              <p style={{ fontSize: 14, color: PAPER.inkMuted, lineHeight: 1.65, margin: 0 }}>
                Flag details are intentionally not rendered here. They contain
                excerpts of what people wrote, and putting them behind a single
                shared admin password on a page anyone can leave open is the
                wrong place for that. Query <code>safety_flags</code> and{' '}
                <code>critical_violations</code> directly, with a named account,
                when you have a reason to.
              </p>
            </Panel>
          </>
        )}

        {tab === 'accounts' && (
          <Panel title="Set a plan manually">
            <p style={{ fontSize: 13.5, color: PAPER.inkMuted, margin: '0 0 14px', lineHeight: 1.6 }}>
              For support cases and comped accounts. Writes the subscriptions
              row, which is the single source of truth for entitlement.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="Email or user ID"
                style={{
                  flex: '1 1 240px',
                  padding: '9px 12px',
                  border: `1px solid ${PAPER.lineStrong}`,
                  borderRadius: RADIUS.sm,
                  fontSize: 14,
                  fontFamily: FONT.sans,
                  outline: 'none',
                  background: PAPER.bg,
                  color: PAPER.ink,
                }}
              />
              <select
                value={plan}
                onChange={e => setPlan(e.target.value as Plan)}
                style={{
                  padding: '9px 12px',
                  border: `1px solid ${PAPER.lineStrong}`,
                  borderRadius: RADIUS.sm,
                  fontSize: 14,
                  fontFamily: FONT.sans,
                  background: PAPER.bg,
                  color: PAPER.ink,
                }}
              >
                {PLAN_ORDER.map(p => (
                  <option key={p} value={p}>
                    {PLAN_NAMES[p]}
                  </option>
                ))}
              </select>
              <button
                onClick={setUserPlan}
                disabled={!identifier.trim()}
                style={{
                  padding: '9px 18px',
                  background: identifier.trim() ? SIGNAL.clay : PAPER.surfaceSunken,
                  color: identifier.trim() ? SIGNAL.onClay : PAPER.inkFaint,
                  border: 'none',
                  borderRadius: RADIUS.sm,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: identifier.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: FONT.sans,
                }}
              >
                Apply
              </button>
            </div>
            {planResult && (
              <p style={{ fontSize: 13.5, color: PAPER.inkMuted, margin: '12px 0 0' }}>{planResult}</p>
            )}
          </Panel>
        )}

        {stats && (
          <p style={{ fontSize: 12, color: PAPER.inkFaint, marginTop: 24 }}>
            Generated {new Date(stats.generatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </main>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 22,
      }}
    >
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  highlight,
  color,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
  color?: string
}) {
  return (
    <div
      style={{
        background: PAPER.surface,
        border: `1px solid ${highlight ? SIGNAL.clay : PAPER.line}`,
        borderRadius: RADIUS.lg,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.09em',
          color: PAPER.inkFaint,
          fontWeight: 600,
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      <div className="pl-num" style={{ fontSize: 26, fontWeight: 500, color: color ?? PAPER.ink }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: PAPER.inkFaint, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  /** What the panel's figures were computed over, when that is not "everything". */
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        background: PAPER.surface,
        border: `1px solid ${PAPER.line}`,
        borderRadius: RADIUS.lg,
        padding: '18px 20px',
        marginBottom: 16,
      }}
    >
      <h2
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: PAPER.inkFaint,
          fontWeight: 600,
          margin: subtitle ? '0 0 2px' : '0 0 14px',
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 11, color: PAPER.inkFaint, margin: '0 0 14px' }}>{subtitle}</p>
      )}
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderTop: `1px solid ${PAPER.line}`,
        fontSize: 14,
      }}
    >
      <span style={{ color: PAPER.inkMuted, textTransform: 'capitalize' }}>{label}</span>
      <span className="pl-num" style={{ fontWeight: 500 }}>
        {value}
      </span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13.5, color: PAPER.inkFaint, margin: 0 }}>{children}</p>
}
