import { mandateMayBeRevealed } from './lifecycle'
import type { RehearsalStatus, Scenario } from './types'

// The single place a Scenario is turned into something a client may see.
//
// The rule this module exists to enforce: `Scenario.hiddenMandate` is the
// answer the user is trying to discover, and it may not reach a browser before
// the rehearsal has ended. That rule used to be four hand-written field lists
// in four files, which is exactly the shape of thing that rots — add a field
// to Scenario, spread the object in one of the four, and the answer is in the
// network tab.
//
// So the projections below are allow-lists by construction, and the return
// types structurally cannot carry the mandate: `PublicScenario` has no such
// field, and TypeScript rejects adding one. A new field on Scenario is invisible
// to clients until someone deliberately adds it here — which is the direction
// the failure should point.

/**
 * Everything about a scenario that is safe for anyone, signed in or not.
 * Deliberately NOT `Omit<Scenario, 'hiddenMandate'>`: an Omit would silently
 * widen every time Scenario gains a field, which is the bug this prevents.
 */
export interface PublicScenario {
  slug: string
  title: string
  premise: string
  situation: string
  objective: string
  constraints: string[]
  counterpartRole: string
  estimatedMinutes: number
  /**
   * HOW MANY things the counterpart is holding — never which ones.
   *
   * The count is the one thing about the mandate that is safe to publish, and
   * it is the thing that makes the sealed block on the brief mean something
   * before a single turn has been taken: "five things are on this table and
   * you can see none of them" is a promise with a number in it, where a black
   * rectangle on its own is only a mood. It is also the denominator the
   * debrief will settle against, so the brief and the reveal are stating the
   * same fact at two ends of the rehearsal.
   *
   * Publishing it discloses nothing. Knowing there are five does not tell you
   * what any of them is, and a buyer who knows to keep asking until they have
   * five is doing the exact thing the product is trying to teach.
   */
  leverCount: number
}

/** What the live room needs. Identical to public — the room learns nothing extra. */
export type RoomScenario = PublicScenario

export function publicScenario(s: Scenario): PublicScenario {
  return {
    slug: s.slug,
    title: s.title,
    premise: s.premise,
    situation: s.situation,
    objective: s.objective,
    constraints: s.constraints,
    counterpartRole: s.counterpartRole,
    estimatedMinutes: s.estimatedMinutes,
    leverCount: s.mandateLevers.length,
  }
}

/**
 * The library card and brief page. Adds the display labels the catalogue needs;
 * `opening`, `tactics` and `walkAway` stay server-side because they are the
 * counterpart's script, and reading them ahead of time spoils the rehearsal
 * even though they are not the mandate itself.
 */
export interface CatalogueScenario extends PublicScenario {
  category: string
  categoryLabel: string
  difficulty: string
  difficultyLabel: string
}

export function catalogueScenario(
  s: Scenario,
  labels: { categoryLabel: string; difficultyLabel: string }
): CatalogueScenario {
  return {
    ...publicScenario(s),
    category: s.category,
    categoryLabel: labels.categoryLabel,
    difficulty: s.difficulty,
    difficultyLabel: labels.difficultyLabel,
  }
}

/**
 * The landing page's playable console. Catalogue fields plus `opening`, and
 * only for the one scenario the console plays.
 *
 * `opening` is the one piece of the counterpart's script that is published on
 * purpose: it is turn 0 of every rehearsal, so anyone who opens the room reads
 * it first anyway, and the landing's console is built around it. `tactics` and
 * `walkAway` stay server-side for the reason given on CatalogueScenario.
 */
export interface LandingScenario extends CatalogueScenario {
  opening: string
}

export function landingScenario(
  s: Scenario,
  labels: { categoryLabel: string; difficultyLabel: string }
): LandingScenario {
  return { ...catalogueScenario(s, labels), opening: s.opening }
}

/**
 * The debrief screen — the ONLY surface allowed to reveal the mandate, and only
 * once the rehearsal has actually stopped. The status is a required argument
 * rather than an optional flag so a caller cannot forget to pass it, and the
 * decision itself is delegated to mandateMayBeRevealed() in ./lifecycle.ts so
 * there is exactly one definition of "safe to reveal" in the codebase.
 *
 * That predicate is an allow-list of the states that MAY reveal, not a
 * deny-list of the ones that may not — so a state added to the union later
 * defaults to sealed.
 */
export interface DebriefScenario {
  slug: string
  title: string
  premise: string
  objective: string
  counterpartRole: string
  /** Null while the rehearsal is live. Populated once it has ended. */
  hiddenMandate: string | null
}

/**
 * `Scenario.mandateLevers` is deliberately NOT projected here, even though it
 * would be legal to at this point in the lifecycle. The itemised mandate is the
 * same secret in a second form, and the debrief screen does not need it from
 * the scenario: the levers it renders are snapshotted onto the debrief row at
 * scoring time, marked found or missed, and a debrief row cannot exist before
 * the rehearsal has ended. So the widest surface the levers are ever exposed
 * on is a scored result, and this projection stays free of them entirely —
 * one fewer place a future edit could release them a state too early.
 */
export function debriefScenario(s: Scenario, status: RehearsalStatus): DebriefScenario {
  return {
    slug: s.slug,
    title: s.title,
    premise: s.premise,
    objective: s.objective,
    counterpartRole: s.counterpartRole,
    hiddenMandate: mandateMayBeRevealed(status) ? s.hiddenMandate : null,
  }
}
