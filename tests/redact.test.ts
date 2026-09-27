import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { SCENARIOS, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/negotiation/scenarios'
import { catalogueScenario, debriefScenario, publicScenario } from '@/lib/negotiation/redact'

describe('scenario projections', () => {
  it('never carry the mandate, whatever the scenario', () => {
    for (const s of SCENARIOS) {
      const projections = [
        publicScenario(s),
        catalogueScenario(s, {
          categoryLabel: CATEGORY_LABELS[s.category],
          difficultyLabel: DIFFICULTY_LABELS[s.difficulty],
        }),
        debriefScenario(s, 'draft'),
        debriefScenario(s, 'live'),
      ]
      for (const p of projections) {
        expect(JSON.stringify(p)).not.toContain(s.hiddenMandate)
      }
    }
  })

  it('also withhold the counterpart\'s script — opening, tactics, walk-away', () => {
    // Not the mandate, but reading the counterpart's opening line and licensed
    // tactics ahead of time still spoils the rehearsal.
    for (const s of SCENARIOS) {
      const serialised = JSON.stringify(publicScenario(s))
      expect(serialised).not.toContain(s.opening)
      expect(serialised).not.toContain(s.walkAway)
      for (const tactic of s.tactics) expect(serialised).not.toContain(tactic)
    }
  })

  it('seal the mandate in every state where the rehearsal could still move', () => {
    // draft and live are the two states in which knowing the mandate would
    // change how the rest of the conversation goes. Both stay sealed.
    for (const s of SCENARIOS) {
      expect(debriefScenario(s, 'draft').hiddenMandate).toBeNull()
      expect(debriefScenario(s, 'live').hiddenMandate).toBeNull()
    }
  })

  it('reveal it once the transcript has stopped growing', () => {
    for (const s of SCENARIOS) {
      expect(debriefScenario(s, 'ended').hiddenMandate).toBe(s.hiddenMandate)
      expect(debriefScenario(s, 'expired').hiddenMandate).toBe(s.hiddenMandate)
      expect(debriefScenario(s, 'debriefed').hiddenMandate).toBe(s.hiddenMandate)
    }
  })

  it('seals it on a failed rehearsal, which has nothing to reveal', () => {
    for (const s of SCENARIOS) {
      expect(debriefScenario(s, 'failed').hiddenMandate).toBeNull()
    }
  })
})

// ── Structural tripwire ─────────────────────────────────────────────────────
//
// The leak this product is most exposed to is not a bug in the projections —
// it is someone adding a fifth place that touches the mandate and forgetting
// which side of the boundary it is on. So the set of files allowed to mention
// it is pinned. Adding a file here should be a deliberate line in a diff that
// a reviewer has to look at, not a silent widening.

const ALLOWED_TO_MENTION_MANDATE = new Set([
  // The domain definition and the library data itself.
  'lib/negotiation/types.ts',
  'lib/negotiation/scenarios.ts',
  // The one module that decides what a client may see.
  'lib/negotiation/redact.ts',
  // Server-only prompt builders. The counterpart is TOLD the mandate; the
  // debrief scorer is told it so it can judge questions against it.
  'lib/negotiation/prompt.ts',
  'lib/negotiation/debrief.ts',
  // Reads the mandate to build the detector that stops the model from
  // emitting it. Server-only, and it never returns the text — only a verdict.
  'lib/negotiation/leakGuard.ts',
  // Snapshots the mandate onto the debrief row at generation time.
  'app/api/debrief/route.ts',
  // Receives the already-redacted nullable projection as a prop type.
  'app/debrief/[id]/DebriefClient.tsx',
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('the set of files that may touch the mandate', () => {
  it('has not grown without someone saying so', () => {
    const root = process.cwd()
    const mentions = ['app', 'lib']
      .flatMap(d => sourceFiles(join(root, d)))
      .filter(f => readFileSync(f, 'utf-8').includes('hiddenMandate'))
      .map(f => relative(root, f).split(sep).join('/'))

    const unexpected = mentions.filter(f => !ALLOWED_TO_MENTION_MANDATE.has(f))
    expect(
      unexpected,
      `these files reference hiddenMandate but are not on the allow-list in ${'tests/redact.test.ts'}. ` +
        'If the reference is server-side and deliberate, add it there. If it is a client boundary, it is a leak.'
    ).toEqual([])
  })

  it('still contains every file the allow-list claims', () => {
    // Catches the reverse rot: an entry left behind after the reference moved,
    // which would let a genuinely new leak slip in under a stale name.
    const root = process.cwd()
    const mentions = new Set(
      ['app', 'lib']
        .flatMap(d => sourceFiles(join(root, d)))
        .filter(f => readFileSync(f, 'utf-8').includes('hiddenMandate'))
        .map(f => relative(root, f).split(sep).join('/'))
    )
    const stale = [...ALLOWED_TO_MENTION_MANDATE].filter(f => !mentions.has(f))
    expect(stale, 'allow-list entries that no longer mention the mandate').toEqual([])
  })
})
