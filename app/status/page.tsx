'use client'
import { useCallback, useEffect, useState } from 'react'
import Nav from '@/app/components/Nav'
import Footer from '@/app/components/Footer'
import { PAPER, SIGNAL, FONT, TYPE, RADIUS } from '@/lib/design'

// System status.
//
// Reports the two things a rehearsal actually depends on, sourced from
// /api/health rather than hardcoded. The previous version listed services that
// did not exist yet as permanently "coming soon", which made the page a
// roadmap wearing a status page's clothes.

interface Service {
  name: string
  detail: string
  status: 'online' | 'degraded' | 'down'
}

const UNREACHABLE: Service[] = [
  { name: 'Rehearsal engine', detail: 'Could not be reached.', status: 'down' },
  { name: 'Transcripts & accounts', detail: 'Could not be reached.', status: 'down' },
]

/** Asks /api/health and maps the answer onto the two services shown. Never rejects. */
function readHealth(): Promise<Service[]> {
  return fetch('/api/health', { cache: 'no-store' })
    .then(res => res.json())
    .then(
      (data): Service[] => [
        {
          name: 'Rehearsal engine',
          detail: 'Generates counterpart turns and scores debriefs.',
          status:
            data.model_provider === 'ok'
              ? 'online'
              : data.model_provider === 'missing_key'
                ? 'down'
                : 'degraded',
        },
        {
          name: 'Transcripts & accounts',
          detail: 'Stores rehearsals, debriefs, playbooks and plan state.',
          status: data.database ? 'online' : 'down',
        },
      ]
    )
    .catch(() => UNREACHABLE)
}

export default function StatusPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [checkedAt, setCheckedAt] = useState('')

  // State is set only once the health call has answered — in the promise
  // callback, never synchronously in the effect below.
  const check = useCallback(() => {
    readHealth().then(next => {
      setServices(next)
      setCheckedAt(new Date().toLocaleTimeString())
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [check])

  const allOnline = services.length > 0 && services.every(s => s.status === 'online')

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '44px 24px 40px', fontFamily: FONT.sans }}>
        <h1
          style={{
            fontFamily: FONT.serif,
            fontSize: TYPE.h1,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            margin: '0 0 26px',
          }}
        >
          System status
        </h1>

        {!loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '18px 20px',
              background: PAPER.surface,
              border: `1px solid ${allOnline ? PAPER.line : SIGNAL.warn}`,
              borderRadius: RADIUS.lg,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: allOnline ? SIGNAL.gain : SIGNAL.warn,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600 }}>
                {allOnline ? 'All systems operational' : 'Partial disruption'}
              </div>
              {!allOnline && (
                <div style={{ fontSize: 13, color: PAPER.inkMuted, marginTop: 2 }}>
                  Transcripts already saved are unaffected.
                </div>
              )}
            </div>
            {checkedAt && (
              <span className="pl-num" style={{ fontSize: 12, color: PAPER.inkFaint }}>
                {checkedAt}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            background: PAPER.surface,
            border: `1px solid ${PAPER.line}`,
            borderRadius: RADIUS.lg,
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '28px 20px', color: PAPER.inkMuted, fontSize: 14 }}>
              Checking…
            </div>
          ) : (
            services.map((s, i) => (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '16px 20px',
                  borderTop: i === 0 ? 'none' : `1px solid ${PAPER.line}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: PAPER.inkMuted }}>{s.detail}</div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    borderRadius: RADIUS.sm,
                    whiteSpace: 'nowrap',
                    background:
                      s.status === 'online'
                        ? SIGNAL.gainSoft
                        : s.status === 'degraded'
                          ? SIGNAL.warnSoft
                          : SIGNAL.claySoft,
                    // The deep variants: this is 12px text on a tinted chip,
                    // where `warn` is 4.0:1 and `clay` 3.5:1. A status page is
                    // read when something is wrong, which is the worst moment
                    // for the word "Down" to be the least legible on screen.
                    color:
                      s.status === 'online'
                        ? SIGNAL.gain
                        : s.status === 'degraded'
                          ? SIGNAL.warnDeep
                          : SIGNAL.clayDeep,
                  }}
                >
                  {s.status === 'online' ? 'Online' : s.status === 'degraded' ? 'Degraded' : 'Down'}
                </span>
              </div>
            ))
          )}
        </div>

        <button
          onClick={check}
          style={{
            marginTop: 16,
            padding: '9px 16px',
            background: 'transparent',
            border: `1px solid ${PAPER.lineStrong}`,
            borderRadius: RADIUS.md,
            fontSize: 13.5,
            cursor: 'pointer',
            fontFamily: FONT.sans,
            color: PAPER.ink,
          }}
        >
          Check again
        </button>

        <p style={{ fontSize: 13, color: PAPER.inkFaint, marginTop: 22, lineHeight: 1.6 }}>
          This page polls the same health endpoint monitoring uses, once a
          minute. If a rehearsal fails to generate, your transcript up to that
          point is still saved and the turn is not counted against your quota.
        </p>
      </main>
      <Footer />
    </>
  )
}
