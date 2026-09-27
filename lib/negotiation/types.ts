// Core Parley domain types.
//
// The shape to hold onto: a SCENARIO is the situation on paper, a COUNTERPART
// is who sits across from you, a REHEARSAL is one timeboxed attempt at it, and
// a DEBRIEF is the scored read of what you actually said. A scenario can be
// rehearsed many times; that repetition is the product.

export type Category =
  | 'renewal'
  | 'pricing'
  | 'terms'
  | 'escalation'
  | 'exit'
  | 'new-buy'

export type Difficulty = 'measured' | 'firm' | 'hostile'

/**
 * What kind of thing a lever is. Drives how the reveal renders it and how the
 * debrief is told to weigh missing it.
 *
 *   price     — movement on the number itself.
 *   trade     — available, but only in exchange for something non-price.
 *   intel     — a fact about their authority, pressure or incentives that
 *               changes how you should play the conversation.
 *   immovable — genuinely fixed. Finding it out is worth something; pushing on
 *               it after that is wasted time, and the debrief says so.
 */
export type LeverKind = 'price' | 'trade' | 'intel' | 'immovable'

/**
 * One discrete thing the counterpart is holding.
 *
 * The mandate used to be prose only, which made it a paragraph the user read
 * once at the end and could not act on. Decomposing it into levers is what
 * turns the reveal from "here is what they were thinking" into "here are the
 * five things that were on the table and here are the three you never found" —
 * and it is what lets Information gain be scored against a closed, known set
 * instead of a judgement about whether the questions felt good.
 *
 * Every lever must satisfy the two rules in scenarios.ts: reachable by a
 * question a real buyer could think to ask, and at least one per scenario
 * marked `free`.
 */
export interface MandateLever {
  /** Stable within a scenario. The debrief returns these ids, not prose. */
  id: string
  /** What it is, in plain terms. Shown in the reveal once the rehearsal ends. */
  label: string
  kind: LeverKind
  /**
   * Ground truth for what surfacing it actually required. Shown against a
   * lever the user missed, so the lesson is "here is the question you did not
   * ask" rather than "you scored low on discovery".
   */
  unlockedBy: string
  /**
   * Costs the counterpart nothing and they will never raise it first. The
   * lesson the debrief exists to deliver; the reveal marks it.
   */
  free?: boolean
}

/**
 * One lever, carried on a debrief with the verdict attached.
 *
 * The debrief model returns ids; the server turns them into this against the
 * scenario as it stood at scoring time, and the row keeps the result. Nothing
 * downstream needs the scenario again, so nothing downstream can drift from it.
 */
export interface ScoredLever extends MandateLever {
  /** True only where the transcript showed them getting at it. */
  found: boolean
}

export interface Scenario {
  slug: string
  title: string
  category: Category
  difficulty: Difficulty
  /** One line, second person. Shown on cards and in the room's header. */
  premise: string
  /** The situation as the user understands it going in. Markdown-free prose. */
  situation: string
  /** What a good outcome looks like for the user. Shown throughout. */
  objective: string
  /** Real limits on the user's side. Makes the rehearsal honest. */
  constraints: string[]
  /** Who the counterpart is, from the user's point of view. Not secret. */
  counterpartRole: string
  /**
   * The counterpart's real instructions — budget, authority, what they will
   * never concede, what they will concede if pushed correctly. NEVER sent to
   * the client before the rehearsal ends; it is the thing the user is trying
   * to discover by asking good questions. Revealed on the debrief screen.
   */
  hiddenMandate: string
  /**
   * The same mandate, decomposed into the discrete things that were actually
   * on the table. Every bit as secret as `hiddenMandate`, and it never reaches
   * a client in this form at all: the only way a lever is ever rendered is as
   * a `ScoredLever` snapshotted onto a debrief, which cannot exist before the
   * rehearsal has ended.
   */
  mandateLevers: MandateLever[]
  /** The counterpart speaks first, so the user is answering, not presenting. */
  opening: string
  /** Pressure the counterpart is licensed to apply. Feeds the system prompt. */
  tactics: string[]
  /** The point past which the counterpart genuinely ends the conversation. */
  walkAway: string
  estimatedMinutes: number
}

export interface Counterpart {
  id: string
  name: string
  /** e.g. "VP Engineering", "Head of Procurement" */
  role: string
  /** How they behave under pressure. Drives the prompt's tone section. */
  disposition: string
  /** Signature moves. Two or three, specific enough to be recognisable. */
  tactics: string[]
  /**
   * A behavioural giveaway the user can learn to read — the thing that
   * changes in how they talk when they are closer to yes than they admit.
   */
  tell: string
  builtIn: boolean
  /**
   * True when the id on a rehearsal no longer resolves — a custom counterpart
   * the user has since deleted. The record stays readable under a stand-in,
   * but a live rehearsal against a retired counterpart accepts no more turns,
   * because there is no disposition left to build a prompt from.
   */
  retired?: boolean
}

// The lifecycle lives in ./lifecycle.ts, which documents the state machine and
// is mirrored by transition_rehearsal() in supabase_migrations.sql. Re-exported
// here so the domain types read as one surface.
export type { RehearsalStatus, EndReason } from './lifecycle'
import type { EndReason, RehearsalStatus } from './lifecycle'

export interface Rehearsal {
  id: string
  userId: string
  scenarioSlug: string
  scenarioTitle: string
  counterpartId: string
  status: RehearsalStatus
  /** Why it left `live`. Null while it is still running. */
  endReason: EndReason | null
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  turnCount: number
  /** Populated once a debrief has been generated for this rehearsal. */
  overallScore: number | null
}

export interface Turn {
  id: string
  rehearsalId: string
  side: 'you' | 'counterpart'
  content: string
  /** Turn index within the rehearsal, 0-based. Used to anchor debrief notes. */
  position: number
  createdAt: string
}

export interface DimensionScore {
  dimension: DimensionId
  score: number
  /** One sentence on what drove the score. Must cite the transcript. */
  note: string
}

export type DimensionId =
  | 'anchoring'
  | 'concession'
  | 'discovery'
  | 'composure'
  | 'close'

export interface KeyMoment {
  /** Index into the rehearsal's turns. Lets the debrief link into the replay. */
  turnPosition: number
  kind: 'cost' | 'gain'
  /** What happened, in the second person. */
  label: string
  /** A concrete alternative line the user could have said instead. */
  betterLine?: string
}

export interface Debrief {
  id: string
  rehearsalId: string
  overallScore: number
  dimensions: DimensionScore[]
  keyMoments: KeyMoment[]
  /** What the counterpart was actually holding — the mandate, now revealed. */
  mandateReveal: string
  /**
   * The scenario's full set of levers, each marked found or missed — not just
   * the ids that were found.
   *
   * Snapshotted whole, for the same reason `mandateReveal` is: a debrief has to
   * keep rendering what was true during that rehearsal after the scenario has
   * been retuned in code. Ids alone would be resolved against the live
   * scenario at render time, so adding a sixth lever next month would silently
   * restate an old "two of five" as "two of six", and deleting one would turn
   * a stored id into a row that renders as nothing.
   *
   * The reveal renders found against missed straight out of this, which is the
   * only part of the score with a denominator the user can check.
   */
  levers: ScoredLever[]
  /** Did the user land a concrete, dated commitment? */
  outcome: 'agreement' | 'partial' | 'no-agreement' | 'walked-away'
  /** The single highest-leverage thing to change next time. */
  oneThing: string
  createdAt: string
}

export interface PlaybookEntry {
  id: string
  userId: string
  /** The user's own words — a line, a question, a frame that worked. */
  note: string
  dimension: DimensionId | null
  /** Where it came from, so a playbook entry is always evidence-backed. */
  sourceRehearsalId: string | null
  sourceScenarioTitle: string | null
  createdAt: string
}
