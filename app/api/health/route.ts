import { NextResponse } from 'next/server'
import { supabaseServer as supabase } from '@/lib/supabase-server'

// Health check.
//
// Probes the two dependencies a rehearsal actually needs: the database, and
// the model provider. It deliberately does NOT send a real completion — that
// would cost money on every uptime poll — so the model check is a credentials
// and reachability check against the models endpoint, which is honest about
// what it does and does not prove.
//
// WHAT IT NO LONGER TELLS A STRANGER. This route is unauthenticated, because an
// uptime probe cannot hold a session. It was returning `missing_env`, a list of
// the environment variables this deployment has not configured, to anyone who
// asked — which hands a passer-by an exact inventory of what is broken and
// therefore what to try. "No OPENROUTER_API_KEY" and "no service-role key" are
// the two most useful facts an attacker could be given about a fresh
// deployment.
//
// The information is not lost, it is moved: the names go to the server log,
// where the operator can see them, and the public body keeps what a monitor
// actually needs — is it up, are its two dependencies answering, how long did
// that take. The 200/503 split is unchanged, so no probe configuration breaks.

export const dynamic = 'force-dynamic'

// HOW OFTEN THE PROBE ACTUALLY RUNS. This route is unauthenticated, and has to
// be — an uptime monitor cannot hold a session. But every call ran a database
// query AND an outbound request to the model provider, which made it a way for
// anyone to spend this deployment's upstream budget at whatever rate the
// proxy's generic per-IP ceiling allows, without authenticating at all.
//
// A short reuse window fixes that without changing what a monitor sees: thirty
// seconds is shorter than any sane polling interval, so a real probe still runs
// between one poll and the next, while a flood collapses onto a single one. The
// 200/503 split and every existing field are unchanged; `cached` is added so
// the answer is honest about which probe produced it.
const PROBE_TTL_MS = 30_000

type ModelProviderState = 'ok' | 'error' | 'missing_key'
type Probe = { at: number; databaseOk: boolean; modelProvider: ModelProviderState; tookMs: number }

// Process-local, like lib/cache.ts: on serverless this only helps calls landing
// on the same warm instance, which caps the damage rather than eliminating it.
let lastProbe: Probe | null = null

async function runProbe(): Promise<Probe> {
  const t0 = Date.now()

  // Counts nothing and returns no rows — just proves the table exists and the
  // service-role credentials work.
  let databaseOk = true
  try {
    const { error } = await supabase.from('rehearsals').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) {
      console.error('[health] Database check failed:', error.message)
      databaseOk = false
    }
  } catch (e) {
    console.error('[health] Database check threw:', e)
    databaseOk = false
  }

  let modelProvider: ModelProviderState = 'missing_key'
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      modelProvider = res.ok ? 'ok' : 'error'
    } catch {
      modelProvider = 'error'
    }
  }

  return { at: Date.now(), databaseOk, modelProvider, tookMs: Date.now() - t0 }
}

export async function GET() {
  const timestamp = new Date().toISOString()

  // Cheap and local, so it stays per-request rather than being cached with the
  // probe: a deploy that fixes a missing variable should say so immediately.
  const missingEnv: string[] = []
  if (!process.env.OPENROUTER_API_KEY) missingEnv.push('OPENROUTER_API_KEY')
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missingEnv.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missingEnv.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (missingEnv.length > 0) {
    console.warn('[health] Missing env vars:', missingEnv.join(', '))
  }

  const fresh = lastProbe && Date.now() - lastProbe.at < PROBE_TTL_MS ? lastProbe : null
  const probe = fresh ?? (await runProbe())
  if (!fresh) lastProbe = probe

  const { databaseOk, modelProvider } = probe
  const healthy = databaseOk && modelProvider === 'ok'

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      database: databaseOk,
      model_provider: modelProvider,
      // The probe's own duration. On a reused answer this is the time the
      // probe that produced it took, not the near-zero cost of replaying it —
      // reporting the replay would tell a monitor the dependencies are faster
      // than they are.
      response_time_ms: probe.tookMs,
      cached: !!fresh,
      // A count, not the names. Enough for a monitor to alert on a
      // misconfigured deploy; not enough to tell anyone which door is open.
      missing_env_count: missingEnv.length,
      timestamp,
    },
    { status: healthy ? 200 : 503 }
  )
}
