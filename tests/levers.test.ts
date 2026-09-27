import { describe, expect, it } from 'vitest'
import { SCENARIOS, scoreLevers } from '@/lib/negotiation/scenarios'
import { REHEARSAL_STATUSES } from '@/lib/negotiation/lifecycle'
import { DIMENSION_IDS } from '@/lib/negotiation/dimensions'
import { createLeakDetector } from '@/lib/negotiation/leakGuard'
import { debriefScenario, publicScenario, catalogueScenario } from '@/lib/negotiation/redact'
import {
  buildDebriefPrompt,
  leverVerdict,
  parseDebrief,
  tallyLevers,
} from '@/lib/negotiation/debrief'
import type { ScoredLever } from '@/lib/negotiation/types'

// The itemised mandate.
//
// `Scenario.mandateLevers` is the same secret as `hiddenMandate`, written as a
// closed list of the discrete things that were actually on the table. It is
// what turns the debrief's central claim from a judgement — "your Information
// gain was 48" — into a countable one: "you got two of the five things they
// were holding, and the one you missed was free."
//
// A countable claim is only worth making if the count is trustworthy, so what
// is asserted here is the trustworthiness: that the set is well formed in
// every scenario, that the second copy of the secret is guarded as closely as
// the first, that a model cannot inflate the numerator by inventing an id, and
// that the sentence the product writes about the result is arithmetic rather
// than opinion.

const KINDS = ['price', 'trade', 'intel', 'immovable']

describe('every scenario decomposes its mandate into a usable set', () => {
  it('has enough levers for a fraction to mean anything', () => {
    for (const s of SCENARIOS) {
      // Three is the floor at which "one of three" reads as a real miss rather
      // than as a coin toss. The library currently authors five apiece.
      expect(s.mandateLevers.length, `${s.slug} has too few levers`).toBeGreaterThanOrEqual(3)
    }
  })

  it('gives every lever a unique id within its scenario', () => {
    for (const s of SCENARIOS) {
      const ids = s.mandateLevers.map(l => l.id)
      expect(new Set(ids).size, `${s.slug} has duplicate lever ids`).toBe(ids.length)
      for (const id of ids) {
        // Stored on a debrief row and matched by equality, so it has to be a
        // plain token — not prose the model might reformat on the way back.
        expect(id, `${s.slug}: "${id}" is not a stable id`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      }
    }
  })

  it('marks at least one lever as costing the counterpart nothing', () => {
    // The lesson the debrief exists to deliver: the thing they would have
    // handed over for the asking, that nobody asked for. A scenario without
    // one can still be scored, but it cannot teach that.
    for (const s of SCENARIOS) {
      expect(
        s.mandateLevers.some(l => l.free === true),
        `${s.slug} has no free lever, so missing everything costs the same as missing nothing`
      ).toBe(true)
    }
  })

  it('says what each lever is and what surfacing it took', () => {
    for (const s of SCENARIOS) {
      for (const l of s.mandateLevers) {
        expect(KINDS, `${s.slug}/${l.id} has an unknown kind`).toContain(l.kind)
        // Six words is the leak guard's floor: below it the phrase is not
        // shingled at all, so a counterpart could recite the lever verbatim
        // and pass. See MIN_SHINGLE_SIZE in lib/negotiation/leakGuard.ts.
        expect(
          l.label.trim().split(/\s+/).length,
          `${s.slug}/${l.id}: label is too short for the leak guard to cover`
        ).toBeGreaterThanOrEqual(6)
        // `unlockedBy` is what a missed row renders. An empty or throwaway one
        // turns the most useful line in the debrief into "you scored low".
        expect(
          l.unlockedBy.trim().split(/\s+/).length,
          `${s.slug}/${l.id}: unlockedBy is too short to be a lesson or to be guarded`
        ).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('is not all one kind, so the counterpart has more than a price to give', () => {
    for (const s of SCENARIOS) {
      const kinds = new Set(s.mandateLevers.map(l => l.kind))
      expect(
        kinds.size,
        `${s.slug} only holds ${[...kinds].join(', ')} — a buyer cannot learn to trade against that`
      ).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('the levers are guarded as closely as the prose mandate', () => {
  it('trips the leak guard on a lever the counterpart recites verbatim', () => {
    // The decomposition says the same things the mandate says in different
    // words, so shingling only `hiddenMandate` would let a counterpart quote a
    // lever straight out of its own system prompt and pass.
    for (const s of SCENARIOS) {
      const detect = createLeakDetector(s)
      for (const lever of s.mandateLevers) {
        const verdict = detect(`Between us — ${lever.label}.`)
        expect(verdict.leaked, `${s.slug}/${lever.id}: label is not covered by the leak guard`).toBe(true)
      }
    }
  })

  it('trips on the question a lever was supposed to be unlocked by', () => {
    for (const s of SCENARIOS) {
      const detect = createLeakDetector(s)
      for (const lever of s.mandateLevers) {
        expect(
          detect(lever.unlockedBy).leaked,
          `${s.slug}/${lever.id}: unlockedBy is not covered by the leak guard`
        ).toBe(true)
      }
    }
  })

  it('still lets ordinary in-role speech through', () => {
    // A guard that fires on everything is a counterpart that never speaks.
    for (const s of SCENARIOS) {
      const detect = createLeakDetector(s)
      expect(detect(s.opening).leaked, `${s.slug}: the opening line trips its own guard`).toBe(false)
    }
  })

  it('never reaches a client as scenario data, at any lifecycle state', () => {
    // The only form a lever is ever rendered in is a ScoredLever snapshotted
    // onto a debrief, which cannot exist before the rehearsal has ended. No
    // scenario projection carries them at all — not even the one that is
    // allowed to reveal the prose mandate. See lib/negotiation/redact.ts.
    for (const s of SCENARIOS) {
      for (const status of REHEARSAL_STATUSES) {
        expect(
          'mandateLevers' in debriefScenario(s, status),
          `${s.slug}: the debrief projection carries levers at ${status}`
        ).toBe(false)
      }
    }
  })

  it('publishes the count, and only the count', () => {
    // The brief and the room both state how many things are on the table
    // before a turn has been taken, and the debrief settles against the same
    // denominator. The number is safe: knowing there are five does not tell
    // you what any of them is.
    for (const s of SCENARIOS) {
      expect(publicScenario(s).leverCount).toBe(s.mandateLevers.length)
      expect(publicScenario(s).leverCount).toBeGreaterThan(0)
    }
  })

  it('never appears in a projection that has to stay sealed', () => {
    // `unlockedBy` is the question the buyer was supposed to ask, which is the
    // answer — so it is checked here as strictly as the label. The two
    // revealing states are excluded from this one on purpose: a lever's label
    // is an excerpt of the mandate prose those projections are allowed to send
    // once the rehearsal has ended.
    for (const s of SCENARIOS) {
      const payloads = [
        publicScenario(s),
        catalogueScenario(s, { categoryLabel: 'x', difficultyLabel: 'y' }),
        debriefScenario(s, 'draft'),
        debriefScenario(s, 'live'),
      ]
      for (const payload of payloads) {
        const serialised = JSON.stringify(payload)
        for (const lever of s.mandateLevers) {
          expect(serialised.includes(lever.label), `${s.slug}/${lever.id} leaked into a projection`).toBe(false)
          expect(serialised.includes(lever.unlockedBy), `${s.slug}/${lever.id} leaked unlockedBy`).toBe(false)
        }
      }
    }
  })
})

describe('scoring the ledger', () => {
  const scenario = SCENARIOS[0]

  /** A model response that is valid in every respect except the levers. */
  const response = (leversFound?: string[]) =>
    JSON.stringify({
      overallScore: 50,
      dimensions: DIMENSION_IDS.map(dimension => ({ dimension, score: 50, note: 'n' })),
      keyMoments: [{ turnPosition: 0, kind: 'cost', label: 'l' }],
      outcome: 'partial',
      oneThing: 'x',
      ...(leversFound ? { leversFound } : {}),
    })

  it('returns the whole set in scenario order, not just what was found', () => {
    const scored = scoreLevers(scenario, [scenario.mandateLevers[1].id])
    expect(scored.map(l => l.id)).toEqual(scenario.mandateLevers.map(l => l.id))
    expect(scored.filter(l => l.found).map(l => l.id)).toEqual([scenario.mandateLevers[1].id])
  })

  it('ignores an id the scenario does not define', () => {
    const scored = scoreLevers(scenario, ['not-a-real-lever'])
    expect(scored.every(l => !l.found)).toBe(true)
    expect(scored.length).toBe(scenario.mandateLevers.length)
  })

  it('drops invented ids at the parse boundary, so they never reach a row', () => {
    const ids = scenario.mandateLevers.map(l => l.id)
    const parsed = parseDebrief(response([ids[0], 'invented-lever', ids[0]]), 4, ids)
    // De-duplicated, filtered to the real set, and left in scenario order so a
    // debrief reopened later reads the same way it did on the day.
    expect(parsed?.leversFound).toEqual([ids[0]])
  })

  it('credits nothing when the model returns no levers at all', () => {
    // An omitted field is a buyer who surfaced nothing, never a free pass.
    expect(parseDebrief(response(), 4, scenario.mandateLevers.map(l => l.id))?.leversFound).toEqual([])
  })

  it('credits nothing when the caller passes no valid set to check against', () => {
    const ids = scenario.mandateLevers.map(l => l.id)
    expect(parseDebrief(response(ids), 4, [])?.leversFound).toEqual([])
  })

  it('tells the model the set, by id, and asks for the ids back', () => {
    const prompt = buildDebriefPrompt({
      scenario,
      counterpart: { name: 'A', role: 'B', disposition: 'C', tactics: [], tell: 'D' },
      turns: [{ side: 'you', content: 'hello', position: 0 }],
      durationSeconds: 600,
    } as never)
    for (const lever of scenario.mandateLevers) {
      expect(prompt, `${lever.id} is not in the debrief prompt`).toContain(`"${lever.id}"`)
    }
    expect(prompt).toContain('leversFound')
  })
})

describe('the verdict sentence is arithmetic, not opinion', () => {
  const lever = (id: string, found: boolean, free = false): ScoredLever => ({
    id,
    label: `lever ${id}`,
    kind: 'trade',
    unlockedBy: 'asking',
    found,
    ...(free ? { free: true } : {}),
  })

  it('counts what was found against the whole set', () => {
    const tally = tallyLevers([lever('a', true), lever('b', false), lever('c', false, true)])
    expect(tally).toEqual({ found: 1, total: 3, missedFree: 1, percent: 33 })
  })

  it('does not count a free lever that was found as missed', () => {
    expect(tallyLevers([lever('a', true, true)]).missedFree).toBe(0)
  })

  it('says so plainly when nothing was surfaced', () => {
    const sentence = leverVerdict([lever('a', false), lever('b', false)])
    expect(sentence).toContain('without any of them')
  })

  it('names the free miss, because that is the lesson', () => {
    expect(leverVerdict([lever('a', true), lever('b', false, true)])).toContain(
      'would have cost them nothing'
    )
    expect(leverVerdict([lever('a', true), lever('b', false)])).not.toContain(
      'would have cost them nothing'
    )
  })

  it('does not congratulate a partial result', () => {
    const sentence = leverVerdict([lever('a', true), lever('b', false), lever('c', false)])
    expect(sentence).toContain('2 did not')
  })

  it('is empty when there is no ledger to read', () => {
    expect(leverVerdict([])).toBe('')
  })
})
