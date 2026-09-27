import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { rejectInvalidContentType } from '@/lib/validateRequest'
import { clientIp } from '@/lib/ownership'

// Manual stand-in for Sentry/Datadog — this endpoint is unauthenticated by
// design (it has to work for a client that just crashed), so it's rate
// limited per-IP to keep it from being a free log-flooding target.
//
// WHAT IS BOUNDED HERE AND WHY. Everything this route logs is attacker
// controlled, and it was being written to the server log verbatim. Two problems
// with that, neither of which needs a clever attacker:
//
//   SIZE.      `req.json()` on an App Router handler has no body cap of its
//              own, so a single request could push megabytes of text into one
//              log line. Twenty of those a minute per IP is a log bill and, on
//              a hosted collector, a retention problem.
//   STRUCTURE. A newline in `error` splits one entry into two, so anything
//              downstream that parses logs by line can be made to read attacker
//              text as its own fields. Collapsing control characters is what
//              stops a crash report forging a log entry.
//
// The values are still recorded — a truncated stack is a usable stack, and
// dropping them would lose the only error reporting this app has.
const MAX_ERROR = 500
const MAX_STACK = 4000

/** One line, bounded. Control characters become spaces so an entry stays an entry. */
function forLog(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value) return null
  return value.slice(0, max).replace(/[\x00-\x1f\x7f]+/g, ' ')
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`log-error:${clientIp(req)}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ logged: false }, { status: 429 })
  }
  const reject = rejectInvalidContentType(req)
  if (reject) return reject

  try {
    const { error, stack, timestamp } = await req.json()
    console.error('[CLIENT ERROR]', {
      error: forLog(error, MAX_ERROR),
      stack: forLog(stack, MAX_STACK),
      // The server's own clock, always. A caller-set timestamp is worth nothing
      // for correlation and is one more unbounded field; the client's version is
      // kept beside it, bounded, for the rare case it helps.
      receivedAt: new Date().toISOString(),
      clientTimestamp: forLog(timestamp, 40),
    })
    return NextResponse.json({ logged: true })
  } catch {
    return NextResponse.json({ logged: false })
  }
}
