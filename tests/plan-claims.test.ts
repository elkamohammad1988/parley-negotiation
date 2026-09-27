import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLAN_FEATURES,
  PLAN_ORDER,
  PLAN_PRICES,
  PUBLIC_PLANS,
  isPlan,
  nextPlanUp,
  planFeatures,
  planPrice,
  toPlan,
  type PlanFeatures,
} from '@/lib/plans'

// NO PHANTOM VALUE.
//
// lib/plans.ts states the rule in a comment — "every entitlement here is
// enforced somewhere" — and the rule had been broken twice by things that were
// nonetheless printed on the pricing page, the billing page and the privacy
// policy:
//
//   `historyDays` claimed 30 days on Free and three years on Professional. No
//   reader filtered by date, no reaper deleted anything, and every plan in fact
//   kept everything forever. It undersold a free account and sold paid
//   retention that was not being withheld from anyone.
//
//   `monthlyDebriefs` was read by no route at all. A debrief is generated once
//   per rehearsal and persisted, so "Unlimited" printed beside "25 rehearsals a
//   month" described a resource that cannot exist.
//
// And Team was a fourth column on the comparison table whose every entitlement
// was byte-for-byte Professional's, at a LOWER price, under a tagline promising
// per-seat access for several people on one account — while nothing in the
// codebase implements a seat and the terms say one person per account.
//
// A comment cannot hold that line on its own, so these tests hold it. They walk
// the real source tree, not a list kept by hand.

const ROOT = process.cwd()

/** Every .ts/.tsx file under the given directories, excluding tests. */
function sourceFiles(dirs: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  for (const dir of dirs) walk(join(ROOT, dir))
  return out
}

/**
 * Source with its comments removed.
 *
 * This codebase explains itself in comments, and the explanation for a deleted
 * claim necessarily quotes the claim — lib/plans.ts records what `historyDays`
 * used to promise, and the billing page records what the stat it replaced used
 * to say. Scanning raw text would make writing that down an offence. Only
 * whole-line `//` comments are stripped, so a `//` inside a URL in a string
 * cannot take the rest of a line of real code with it.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const SOURCES = sourceFiles(['app', 'lib']).map(path => ({
  path: path.slice(ROOT.length + 1).replace(/\\/g, '/'),
  text: withoutComments(readFileSync(path, 'utf-8')),
}))

/** The files that decide something, as opposed to the file that declares it. */
const ENFORCERS = SOURCES.filter(f => f.path !== 'lib/plans.ts')

describe('every entitlement is enforced somewhere', () => {
  const FIELDS = Object.keys(PLAN_FEATURES.free) as (keyof PlanFeatures)[]

  it.each(FIELDS)('%s is read outside lib/plans.ts', field => {
    const readers = ENFORCERS.filter(f => f.text.includes(field))
    expect(
      readers.map(f => f.path),
      `${field} is declared in lib/plans.ts and read nowhere else — either it is enforced and this test is wrong, or it is a claim the product cannot keep and belongs deleted, the way historyDays and monthlyDebriefs were`
    ).not.toHaveLength(0)
  })

  it('the fields that were removed have not come back', () => {
    // Named individually because each one was printed at a customer before it
    // was deleted, and re-adding any of them to the interface without building
    // the thing would put the claim straight back onto the pricing page.
    for (const gone of [
      'historyDays',
      'monthlyDebriefs',
      'customScenarios',
      'teamWorkspace',
      'exportTranscripts',
    ]) {
      expect(Object.keys(PLAN_FEATURES.free)).not.toContain(gone)
    }
  })
})

describe('no surface claims a retention window', () => {
  // The strongest version of that claim lived in the privacy policy, where it
  // was a statement about what happens to someone's data. It said transcripts
  // were "deleted after" a per-plan window. No such deletion existed.
  const RETENTION_CLAIMS = [/history window/i, /historyDays/, /History kept/i]

  it.each(RETENTION_CLAIMS.map(r => [r.source, r] as const))(
    'nothing in app/ or lib/ says %s',
    (_label, pattern) => {
      const offenders = SOURCES.filter(f => pattern.test(f.text)).map(f => f.path)
      expect(offenders).toEqual([])
    }
  )

  it('no scheduled deletion exists to back such a claim', () => {
    // If a reaper is ever built this test is the thing that says so, and the
    // entitlement may come back at the same time.
    const reapers = SOURCES.filter(
      f => /\.delete\(\)/.test(f.text) && /older_than|retention|reap|purge/i.test(f.text)
    )
    expect(reapers.map(f => f.path)).toEqual([])
  })
})

describe('no surface writes an entitlement out as a literal', () => {
  // The free rehearsal count is a promise, and it was typed out as the word
  // "Three" on the pricing page and again in the signup heading while the
  // landing page read it from PLAN_FEATURES. Three copies of a number that the
  // database enforces is two copies too many: retune the free plan and two of
  // them keep selling the old figure.
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const free = PLAN_FEATURES.free.monthlyRehearsals
  const word = WORDS[free]

  it('spells no free-rehearsal count next to the word "rehearsal"', () => {
    const pattern = new RegExp(String.raw`\b(${free}|${word})\s+rehearsals?\b`, 'i')
    const offenders = SOURCES.filter(
      // lib/plans.ts is the source of the number and may of course contain it.
      f => !f.path.endsWith('lib/plans.ts') && pattern.test(f.text)
    ).map(f => f.path)
    expect(
      offenders,
      'these write the free rehearsal count out rather than reading PLAN_FEATURES'
    ).toEqual([])
  })
})

describe('a plan is only offered if it can be described', () => {
  it('does not sell Team', () => {
    expect(PUBLIC_PLANS).not.toContain('team')
  })

  it('still resolves an existing Team subscription to full access', () => {
    // The point of keeping it in PLAN_ORDER. Dropping it from the type would
    // have sent every Team row through toPlan's fallback and silently
    // downgraded a paying account to free.
    expect(PLAN_ORDER).toContain('team')
    expect(isPlan('team')).toBe(true)
    expect(toPlan('team')).toBe('team')
    expect(planFeatures('team').monthlyRehearsals).toBe(-1)
    expect(planFeatures('team').customCounterparts).toBe(-1)
    expect(planFeatures('team').progressTrends).toBe(true)
  })

  it('is why Team is not sold: it is Professional with a different name', () => {
    // Pinned so that if anyone ever makes Team actually differ, this fails and
    // the decision to sell it again is taken deliberately rather than by drift.
    expect(PLAN_FEATURES.team).toEqual(PLAN_FEATURES.professional)
  })

  it('never invites anyone to upgrade to a plan it does not sell', () => {
    for (const plan of PLAN_ORDER) {
      const next = nextPlanUp(plan)
      if (next === null) continue
      expect(PUBLIC_PLANS, `nextPlanUp('${plan}') offered '${next}'`).toContain(next)
    }
    expect(nextPlanUp('professional')).toBeNull()
    expect(nextPlanUp('team')).toBeNull()
  })

  it('prices every plan it sells and none that it does not', () => {
    for (const plan of PUBLIC_PLANS) {
      expect(planPrice(plan, 'monthly'), `${plan} monthly`).not.toBe('')
      expect(planPrice(plan, 'annual'), `${plan} annual`).not.toBe('')
    }
    for (const plan of PLAN_ORDER.filter(p => !PUBLIC_PLANS.includes(p))) {
      expect(planPrice(plan, 'monthly'), `${plan} monthly`).toBe('')
      expect(planPrice(plan, 'annual'), `${plan} annual`).toBe('')
    }
  })

  it('keeps a price entry for every plan so the record survives', () => {
    expect(Object.keys(PLAN_PRICES).sort()).toEqual([...PLAN_ORDER].sort())
  })

  it('does not create a Stripe product for a plan it does not sell', () => {
    const setup = readFileSync(
      join(ROOT, 'app/api/stripe/setup-products/route.ts'),
      'utf-8'
    )
    const plans = setup.match(/const PLANS[\s\S]*?\n\};/)?.[0] ?? ''
    expect(plans, 'no PLANS table found in setup-products').not.toBe('')
    for (const plan of PUBLIC_PLANS) {
      if (plan === 'free') continue
      expect(plans, `${plan} should have a Stripe product`).toContain(`${plan}: {`)
    }
    expect(plans).not.toContain('team: {')
  })
})

describe('the pricing comparison shows only enforced entitlements', () => {
  const PRICING = readFileSync(join(ROOT, 'app/pricing/page.tsx'), 'utf-8')

  it('renders one row per enforced field and no more', () => {
    const labels = [...PRICING.matchAll(/<Row\s+label="([^"]+)"/g)].map(m => m[1])
    expect(labels).toEqual([
      'Rehearsals per month',
      'Custom counterparts',
      'Progress trends',
    ])
    expect(labels).toHaveLength(Object.keys(PLAN_FEATURES.free).length)
  })

  it('builds its columns from the plans it sells', () => {
    expect(PRICING).toContain('PUBLIC_PLANS.map')
    expect(PRICING).not.toContain('PLAN_ORDER')
  })
})
