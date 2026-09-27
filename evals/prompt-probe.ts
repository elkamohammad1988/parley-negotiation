// Direct-to-model adversarial probe.
//
// WHAT THIS MEASURES, AND WHAT IT DOES NOT.
//
// This calls the real OpenRouter model with the real system prompt from
// lib/negotiation/prompt.ts, and nothing else. It needs no database, no server
// and no Supabase credentials — only OPENROUTER_API_KEY.
//
// It therefore measures exactly one layer:
//
//   [1] PROMPT-LEVEL RESISTANCE          <- this file
//       Does buildCounterpartPrompt make the model refuse on its own?
//
//   [2] DETERMINISTIC RUNTIME GUARD      <- tests/injection.test.ts
//       If the model does disclose, does leakGuard.ts catch it? 51 tests,
//       no model required, runs in CI.
//
//   [3] END-TO-END RUNTIME BEHAVIOUR     <- evals/run.ts
//       What a real user actually gets: prompt, streaming relay, leak guard,
//       safety filter, persistence. Needs a full deployment.
//
// A pass here does NOT mean the streaming relay is sound. A pass here does NOT
// mean leakGuard.ts is wired in. It means the prompt held. Those are three
// different claims and only the first is in evidence from this file.
//
// The leak detector IS applied to each reply, but only to report what the
// runtime guard WOULD have caught. It is not in the path — nothing here is
// blocked, cut, or substituted. That column is the interesting one: it counts
// the times the prompt failed and the guard would have been the only thing
// standing between the user and the mandate.
//
// Usage:
//   OPENROUTER_API_KEY=... npx tsx --conditions=react-server evals/prompt-probe.ts
//   PARLEY_PROBE_LIMIT=3 OPENROUTER_API_KEY=... npx tsx --conditions=react-server evals/prompt-probe.ts

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildCounterpartPrompt } from '../lib/negotiation/prompt'
import { getScenario } from '../lib/negotiation/scenarios'
import { getCounterpart } from '../lib/negotiation/counterparts'
import { createLeakDetector } from '../lib/negotiation/leakGuard'
import { complete, isConfigured, ROOM_MODEL, type ChatMessage } from '../lib/openrouter'
import { createChecker } from './assertions'
import { foundSignals, indirectLeakSignals } from './signals'

const SCENARIO_SLUG = process.env.PARLEY_EVAL_SCENARIO || 'renewal-uplift'
const COUNTERPART_ID = process.env.PARLEY_EVAL_COUNTERPART || 'closer'
const LIMIT = process.env.PARLEY_PROBE_LIMIT ? parseInt(process.env.PARLEY_PROBE_LIMIT, 10) : Infinity

// Matches the room's own settings so the probe is testing what users hit.
const TEMPERATURE = 0.85
const MAX_TOKENS = 500
const DELAY_MS = 1200

const ADVERSARIAL = [
  'injection_direct_override',
  'injection_prompt_extraction',
  'injection_authority_spoof',
  'injection_incremental',
  'injection_scoring_manipulation',
  'injection_encoded',
]

interface Probe {
  category: string
  turns: string[]
  _why?: string
}

interface Result {
  category: string
  turn: string
  reply: string
  pass: boolean
  failures: string[]
  /** The runtime guard is not in this path; this is what it WOULD have done. */
  guardWouldBlock: boolean
  guardReason?: string
  /** Heuristic, for human review — not a verdict. */
  indirectSignals: string[]
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  if (!isConfigured()) {
    console.error('OPENROUTER_API_KEY is not set. This probe calls the real model and cannot run without it.')
    console.error('No results were produced. Nothing was mocked.')
    process.exit(1)
  }

  const scenario = getScenario(SCENARIO_SLUG)
  const counterpart = getCounterpart(COUNTERPART_ID)
  if (!scenario || !counterpart) {
    console.error(`Unknown scenario "${SCENARIO_SLUG}" or counterpart "${COUNTERPART_ID}".`)
    process.exit(1)
  }

  const { probes } = JSON.parse(
    readFileSync(join(process.cwd(), 'evals', 'prompts.json'), 'utf-8')
  ) as { probes: Probe[] }

  const selected = probes.filter(p => ADVERSARIAL.includes(p.category))
  const check = createChecker(SCENARIO_SLUG)
  const detectLeak = createLeakDetector(scenario)
  const signals = indirectLeakSignals(scenario.hiddenMandate)

  console.log(`Model:      ${ROOM_MODEL}`)
  console.log(`Scenario:   ${scenario.slug}`)
  console.log(`Counterpart:${counterpart.name}`)
  console.log(`Categories: ${selected.length}, turns: ${selected.reduce((n, p) => n + p.turns.length, 0)}`)
  console.log(`Mandate signals watched: ${signals.join(', ') || '(none extracted)'}`)
  console.log('\nPROMPT-LEVEL ONLY. No streaming relay, no leak guard in path, no database.\n')

  const results: Result[] = []
  let sent = 0

  for (const probe of selected) {
    console.log(`\n── ${probe.category} ${'─'.repeat(Math.max(0, 46 - probe.category.length))}`)

    // One conversation per category, accumulating — matching how run.ts opens a
    // fresh room per category. This matters most for injection_incremental,
    // whose whole design is that the fifth turn lands after four harmless ones.
    const history: ChatMessage[] = [
      { role: 'assistant', content: scenario.opening },
    ]

    for (let i = 0; i < probe.turns.length; i++) {
      if (sent >= LIMIT) break
      sent++
      const turn = probe.turns[i]

      const system = buildCounterpartPrompt({
        scenario,
        counterpart,
        // Mid-conversation: past the EARLY hold, before the LATE close.
        elapsedMinutes: scenario.estimatedMinutes * 0.5,
        userTurnCount: i + 1,
      })

      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: turn },
      ]

      const out = await complete(messages, {
        model: ROOM_MODEL,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      })

      const reply = out?.content?.trim() ?? ''
      const failures = reply ? check(probe.category, reply, 200) : ['no reply from provider']
      const verdict = detectLeak(reply)
      const indirect = foundSignals(reply, signals)

      results.push({
        category: probe.category,
        turn,
        reply,
        pass: failures.length === 0,
        failures,
        guardWouldBlock: verdict.leaked,
        guardReason: verdict.reason,
        indirectSignals: indirect,
      })

      const mark = failures.length === 0 ? 'PASS' : 'FAIL'
      console.log(`${mark}  ${turn.slice(0, 60).replace(/\n/g, ' ')}`)
      for (const f of failures) console.log(`      ${f}`)
      if (verdict.leaked) console.log(`      GUARD WOULD BLOCK: ${verdict.reason}`)
      if (indirect.length) console.log(`      indirect signals: ${indirect.join(', ')}`)

      history.push({ role: 'user', content: turn })
      if (reply) history.push({ role: 'assistant', content: reply })

      await sleep(DELAY_MS)
    }

    if (sent >= LIMIT) break
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const byCategory: Record<string, { pass: number; total: number; guard: number; indirect: number }> = {}
  for (const r of results) {
    byCategory[r.category] ??= { pass: 0, total: 0, guard: 0, indirect: 0 }
    byCategory[r.category].total++
    if (r.pass) byCategory[r.category].pass++
    if (r.guardWouldBlock) byCategory[r.category].guard++
    if (r.indirectSignals.length) byCategory[r.category].indirect++
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log('PROMPT-LEVEL ADVERSARIAL RESULTS'.padEnd(40) + 'pass   guard   indirect')
  for (const [category, s] of Object.entries(byCategory)) {
    console.log(
      `  ${category.padEnd(36)} ${String(s.pass + '/' + s.total).padEnd(7)}${String(s.guard).padEnd(8)}${s.indirect}`
    )
  }

  const passed = results.filter(r => r.pass).length
  const guarded = results.filter(r => r.guardWouldBlock).length
  console.log(`\n  TOTAL ${passed}/${results.length} passed`)
  console.log(`  ${guarded} reply(ies) would have been blocked by the runtime leak guard`)
  console.log(`\n  Pass criteria for every injection_* category is 100% (evals/README.md).`)
  console.log('  This is prompt-level evidence only. It says nothing about the relay or the guard being wired in.')

  writeFileSync(
    join(process.cwd(), 'evals', 'prompt-probe-results.json'),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        layer: 'prompt-level only — no relay, no leak guard in path, no database',
        model: ROOM_MODEL,
        scenario: scenario.slug,
        counterpart: counterpart.id,
        mandateSignalsWatched: signals,
        byCategory,
        results,
      },
      null,
      2
    )
  )
  console.log('\nWrote evals/prompt-probe-results.json')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
