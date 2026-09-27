// The probe's paraphrase detection is the one thing in it that is not already
// covered elsewhere, and it is the dimension the prompt-level eval exists to
// report ("any paraphrased or indirect leakage observed"). A broken version
// would quietly report nothing on every run and read as a clean result.
//
import { describe, expect, it } from 'vitest'
import { SCENARIOS, getScenario } from '@/lib/negotiation/scenarios'
import { createLeakDetector } from '@/lib/negotiation/leakGuard'
import { foundSignals, indirectLeakSignals } from '@/evals/signals'

const scenario = getScenario('renewal-uplift')!

// The figures are read out of the mandate rather than typed in here. A test
// that hardcodes "15" passes for as long as one particular sentence in
// scenarios.ts is left alone and then fails for a content edit that broke
// nothing — which teaches people to change the test instead of reading it.
const SIGNALS = indirectLeakSignals(scenario.hiddenMandate)
const PERCENT = SIGNALS.find(s => /%|per ?cent/i.test(s))!
const DIGITS = PERCENT?.match(/\d+/)?.[0] ?? ''

describe('mandate signal extraction', () => {
  const signals = SIGNALS

  it('pulls the distinctive figures out of the mandate', () => {
    // This mandate's secrets are a percentage ceiling and a term length, so
    // both a percentage and a term should survive extraction.
    expect(signals.length).toBeGreaterThan(0)
    expect(PERCENT, 'mandate should contain an extractable percentage').toBeTruthy()
    expect(signals.some(s => /(?:one|two|three|four|five|six)[- ](?:year|month|quarter)/i.test(s))).toBe(true)
  })

  it('extracts something usable for every scenario in the library', () => {
    const withNone = SCENARIOS.filter(s => indirectLeakSignals(s.hiddenMandate).length === 0)
    // Not every mandate is numeric, so this is reported rather than asserted to
    // zero — but a library where most yield nothing would make the indirect
    // column meaningless and is worth knowing about.
    expect(withNone.length).toBeLessThan(SCENARIOS.length)
  })
})

describe('paraphrased leakage detection', () => {
  const signals = SIGNALS
  const detect = createLeakDetector(scenario)

  it('catches a reworded ceiling that the verbatim detector cannot see', () => {
    // The exact gap this exists to cover: no phrase from the mandate appears,
    // so the shingle detector is blind, but the secret is out.
    const paraphrased = `Look, I could probably stretch to ${DIGITS} if the term were shorter.`
    expect(detect(paraphrased).leaked, 'verbatim detector should miss this').toBe(false)
    expect(foundSignals(paraphrased, signals).length).toBeGreaterThan(0)
  })

  it('matches a figure written as digits regardless of surrounding wording', () => {
    expect(foundSignals(`we can do ${DIGITS} percent`, signals).length).toBeGreaterThan(0)
  })

  it('does not match a figure spelled out as a word', () => {
    // A real gap in the detector, asserted so it stays a known one rather than
    // becoming a surprise. A counterpart that says "twelve per cent" leaks past
    // this signal and is caught only by a human reading the probe output.
    expect(foundSignals('twelve per cent is my limit', signals)).toEqual([])
  })

  it('stays quiet on a reply that mentions none of the mandate figures', () => {
    const clean = 'I am not going to be drawn on a number before you give me one.'
    expect(foundSignals(clean, signals)).toEqual([])
  })

  it('is a signal and not a verdict', () => {
    // A number in the mandate may also be a number the USER put on the table,
    // which is why these are reported for human review rather than failing a
    // category automatically. Documenting the false positive on purpose.
    const userEcho = `You said ${DIGITS} and I am telling you that is not happening.`
    expect(foundSignals(userEcho, signals).length).toBeGreaterThan(0)
  })
})
