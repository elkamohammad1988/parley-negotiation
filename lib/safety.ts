// ═══════════════════════════════════════════════════════════════════════════
// Parley content safety
//
// Layered pattern checks, a l33tspeak normaliser, an immutable
// critical-violation log and soft-flag treatment of self-harm.
//
// Parley has no adult surface at all, so every check below applies
// unconditionally. There is no mode or toggle that relaxes any of them.
//
// The layer specific to this product: a rehearsal tool can be misused to
// script coercion, threats, or unlawful treatment of a real, named person.
// See TARGETED_HARM_PATTERNS.
//
// Legal basis for the retained child-safety layers:
//   18 U.S.C. §2256/2252/2252A — federal CSAM definitions and prohibition
//   PROTECT Act 2003          — fictional/drawn/written CSAM
//   Cal Penal Code §311/§647.6 — obscene matter; child molestation/grooming
//   18 U.S.C. §2258A          — platform reporting obligation
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseServer as supabase } from './supabase-server';

export interface SafetyResult {
  safe: boolean;
  category?: string;
  /** Shown to the user in place of a counterpart turn. */
  refusal?: string;
  emergencyResources?: string;
  /** HTTP 451 — blocked for legal reasons. */
  criticalViolation?: boolean;
  /** Self-harm detected — allow through, caller injects care instruction. */
  selfHarmDetected?: boolean;
  /** Violence expressed (not instructions) — allow, inject de-escalation. */
  violenceMentionDetected?: boolean;
}

export interface ContentCheckResult {
  blocked: boolean;
  reason?: string;
  softFlag?: 'self-harm';
  severity?: 'critical' | 'soft';
}

// The counterpart never breaks role to moralise — that would wreck the
// rehearsal. When a turn is refused, the room shows this as a system notice
// outside the transcript instead, so it is unmistakably the product speaking
// and not the person you are practising against.
const SYSTEM_REFUSAL =
  'Parley cannot rehearse this. The room is for negotiation practice — if you are working through something else, the support link in the footer goes to a person.';

const SELF_HARM_RESOURCES =
  `\n\n---\nIf you are having thoughts of self-harm or suicide, please reach out:\n` +
  `• National Suicide & Crisis Lifeline: 988 (call or text)\n` +
  `• Crisis Text Line: Text HOME to 741741\n` +
  `• International: https://findahelpline.com`;

// ─── Layer 1: L33tspeak normaliser ───────────────────────────────────────────

function normalizeLeet(text: string): string {
  return text
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/6/g, 'b')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/\|/g, 'i')
    .replace(/\+/g, 't')
    .replace(/\*/gi, '');
}

// ─── CRITICAL violations ─────────────────────────────────────────────────────
// Zero tolerance. HTTP 451, immutable log, repeat offenders banned.

const CRITICAL_PATTERNS: RegExp[] = [
  /\bchild\s*pornography\b/i,
  /\bcp\s*(content|pics|photos|images|videos|collection|links?|site|board|forum|chan)\b/i,
  /\b(tell\s+me\s+(about|where|how)|show\s+me|find|share|send|get|want|need|looking\s+for|where\s+(can|do)\s+i\s+(find|get))\s+cp\b/i,
  /\bdownload\s+cp\b/i,
  /\bcsam\b/i,
  /\bkiddie\s*(porn|sex)\b/i,
  /\bbabyj\b/i,
  /\bloli(con)?\b/i,
  /\bshota\b/i,
  /\bpedo(phile|philia|s)?\b/i,
  /\bjailbait\b/i,
  /\b(sex|erotic|nude|naked|explicit|f+u+c+k+|lewd).{0,20}(child|kid|infant|toddler|baby|preteen|tween)\b/i,
  /\b(child|kid|infant|toddler|baby|preteen|tween).{0,20}(sex|erotic|nude|naked|explicit|lewd)\b/i,
  /\b(preteen|pre[-\s]?teen|pre[-\s]?pubescent).{0,30}(sex|nude|naked|explicit)\b/i,
  /\b([1-9]|1[0-2])[\s-]?year[\s-]?olds?.{0,30}(sex|nude|naked|explicit|erotic)\b/i,
  /\b(sex|nude|naked|explicit|erotic).{0,30}\b([1-9]|1[0-2])[\s-]?year[\s-]?old\b/i,
  /\bsend\s+(me|your).{0,20}(naked|nude|explicit).{0,20}(kid|child|minor|young)\b/i,
];

// ─── Minor-sexualisation content ─────────────────────────────────────────────

const MINOR_CONTENT_PATTERNS: RegExp[] = [
  /\bage[\s-]?play\b/i,
  /\bunder\s*18\b.*\b(sex|erotic|nude|naked|explicit|f+u+c+k+)\b/i,
  /\b(sex|erotic|nude|naked|explicit|f+u+c+k+)\b.*\bunder\s*18\b/i,
  /\b(teen|minor|underage|juvenile).{0,40}(sex|nude|naked|explicit|nsfw|erotic|f+u+c+k+)\b/i,
  /\b(sex|nude|naked|explicit|nsfw|erotic|f+u+c+k+).{0,40}(teen|minor|underage)\b/i,
  /\bschool\s*(girl|boy).{0,30}(sex|nude|naked|erotic|explicit)\b/i,
  /\b(sex|nude|naked|erotic|explicit).{0,30}school\s*(girl|boy)\b/i,
  /\blittle\s*(girl|boy).{0,30}(sex|daddy|erotic|naked|nude|explicit)\b/i,
  /\b(sex|erotic|naked|nude|explicit).{0,30}little\s*(girl|boy)\b/i,
  /\bchild\s+(porn|sex|nude|erotic)\b/i,
  /\bteen\s+(anal|blowjob|gangbang|threesome)\b/i,
  /\b(nymphet|barely\s*legal|illegal\s*age)\b/i,
  /\b(high\s*school|middle\s*school)\s+(sex|nude|naked|erotic|explicit)\b/i,
  /\b(pretend|imagine|suppose|let.s\s+say|in\s+this\s+story|roleplay|rp)\b.{0,60}(she|he|they)\s+(is|are).{0,20}(1[0-7]|thirteen|fourteen|fifteen|sixteen|seventeen)\b/i,
  /\b(age\s+her\s+down|make\s+her\s+younger|younger\s+version|aging\s+down)\b/i,
  /\b(pretend|act|imagine|be|act\s*like|act\s*as)\b.{0,30}(you\s+are|you.?re|ur)\s+(1[3-7])\b/i,
  /\byou(\s+are|.?re)\s+(1[3-7])[\s-]?years?\s*old\b/i,
  // Bare age assertions and the "barely legal" framing family. These were
  // present in the codebase this ported from and were briefly dropped in the
  // rewrite; restored deliberately. They will occasionally catch an innocent
  // sentence ("my daughter is 15"), and that trade is accepted — a rare false
  // positive on a workplace rehearsal costs far less than a gap here.
  /\b(s?he|they).{0,10}(is|are|was)\s+(1[3-7])\b/i,
  /\bim\s+(1[3-7])\b/i,
  /\b(1[3-7])[\s-]year[\s-]?old\b/i,
  /\b(1[3-7])[\s-]?years[\s-]?old\b/i,
  /\b(she\s+looks?\s+young\s+but\s+is\s+actually|appears?\s+young)\b/i,
  /\bjust\s+turned\s+18\b/i,
  /\bonly\s+just\s+18\b/i,
  /\bhardly\s+18\b/i,
  /\bbarely\s+18\b/i,
];

// ─── Grooming ────────────────────────────────────────────────────────────────

const GROOMING_PATTERNS: RegExp[] = [
  /\b(don.?t|don't)\s+tell\s+(your|ur)\s+(parent|mom|dad|guardian|adult)\b/i,
  /\bi.ll\s+(buy|send|give)\s+(you|ya).{0,40}(if\s+you|when\s+you)\b/i,
  /\bmeet\s+(me|up)\s+(irl|in\s+real\s+life|in\s+person|alone)\b/i,
  /\b(younger|young)\s+(the\s+better|is\s+better|girls?\s+are)\b/i,
  /\bsend\s+(me|your).{0,20}(naked|nude)\b/i,
  /\byou.?re\s+(so\s+)?mature\s+for\s+your\s+age\b/i,
  /\bage\s+is\s+just\s+a\s+number\b/i,
  /\bgrooming\s+(tips|guide|how)\b/i,
  /\bbabysit\b.{0,50}\b(alone|come\s+over|stay\s+over)\b/i,
];

// ─── Sexual content ──────────────────────────────────────────────────────────
// Unconditional. There is no context in this product where a negotiation
// counterpart should produce or accept sexual content, so unlike the codebase
// this came from, nothing here is gated behind a toggle.

const SEXUAL_PATTERNS: RegExp[] = [
  /\b(rape|raping|raped)\b/i,
  /\bmolest(ing|ed|s)?\b/i,
  /\bsexual\s+assault\b/i,
  /\bnon[\s-]?con(sent)?\b/i,
  /\bsexual\s+coercion\b/i,
  /\bdate\s+rape\b/i,
  /\bno\s+means\s+yes\b/i,
  /\b(sext|sexting|erotic\s+roleplay|erp)\b/i,
  /\b(take\s+off\s+your|undress|strip\s+for\s+me)\b/i,
  /\bhave\s+sex\s+with\s+(me|you)\b/i,
  // Requests to change the REGISTER of the rehearsal. This is how it is
  // actually attempted — not with explicit words, but by asking the
  // counterpart to become something else. Matched on the instruction
  // ("make this...", "be more...") rather than on the topic, so that
  // rehearsing a harassment complaint with HR — a legitimate and important
  // use of this product — is not caught.
  /\b(make|turn|keep)\s+(this|it|the\s+conversation|things)\b.{0,24}\b(sexual|sexy|dirty|erotic|flirty|romantic|intimate)\b/i,
  /\b(be|act|talk|get)\s+(?:(?:a\s+bit|a\s+little|more|really|much|way|so)\s+)*(sexy|seductive|flirty|dirty|naughty)\b/i,
  /\blet'?s\s+(get|be|make\s+it)\s+(sexual|dirty|intimate|naughty|steamy)\b/i,
];

// ─── Self-harm ───────────────────────────────────────────────────────────────
// Soft flag, never a block: someone disclosing distress mid-rehearsal should
// meet resources, not a closed door.

const SELF_HARM_PATTERNS: RegExp[] = [
  /\b(suicide|suicidal)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcutting\s+(myself|yourself|herself|himself)\b/i,
  /\boverdos(e|ing)\b/i,
  /\bkill\s+(myself|yourself|oneself)\b/i,
  /\bend\s+(my|your|their)\s+(own\s+)?life\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bslit\s+(my|your|her|his)\s+wrists?\b/i,
  /\btake\s+(too\s+many|all\s+the)\s+pills?\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bhang\s+myself\b/i,
  /\bjump\s+(off|from).{0,30}(bridge|building|roof)\b/i,
  /\bsuicide\s+(note|letter|plan|method)\b/i,
  /\bwant\s+to\s+hurt\s+(myself|yourself|himself|herself|themselves)\b/i,
  /\bhurt\s+(my|your|him|her|them)self\b/i,
];

// ─── Violence ────────────────────────────────────────────────────────────────

const VIOLENCE_MENTION_PATTERNS: RegExp[] = [
  /\b(i\s+(want|wanna|need)\s+to\s+(kill|murder|hurt|harm|attack)\s+(someone|somebody|him|her|them|everyone|people))\b/i,
  /\b(i.m\s+going\s+to\s+(kill|murder|hurt|harm))\b/i,
  /\bwant\s+to\s+hurt\s+(someone|somebody|him|her|them|people)\b/i,
  /\bi\s+could\s+(kill|murder)\b/i,
];

const VIOLENCE_PATTERNS: RegExp[] = [
  /\bhow\s+to\s+(make|build|create|construct).{0,50}(bomb|explosive|grenade|ied|c4)\b/i,
  /\b(recipe|instructions?|guide|steps?|tutorial)\s+(for|to).{0,30}(poison(ing)?|kill|murder)\s+(someone|a\s+person|people)\b/i,
  /\b(synthesize|make|produce).{0,30}(meth|fentanyl|nerve\s+gas|sarin|vx)\b/i,
  /\bhow\s+to\s+get\s+(away\s+with\s+murder|rid\s+of\s+a\s+body)\b/i,
  /\bmass\s+(shooting|casualty|murder)\s+(plan|instructions?|guide)\b/i,
];

// ─── Doxxing ─────────────────────────────────────────────────────────────────

const DOXXING_PATTERNS: RegExp[] = [
  /\b(find|get|locate)\s+(someone.s|their|his|her)\s+(address|location|home|phone)\b/i,
  /\bstalking\s+(tips|guide|how)\b/i,
  /\bspy\s+(on|software|app).{0,30}(phone|device|partner|girlfriend|boyfriend)\b/i,
];

// ─── Hate speech ─────────────────────────────────────────────────────────────

const HATE_PATTERNS: RegExp[] = [
  /\b(n[i*]gg(er|a))\b/i,
  /\b(k[i*]ke|sp[i*]c|ch[i*]nk|g[o*]ok)\b/i,
  /\b(gas\s+the\s+jews|white\s+power|white\s+genocide)\b/i,
  /\b(kill\s+all).{0,20}(jews|blacks|muslims|gays|women)\b/i,
  /\bheil\s+hitler\b/i,
];

// ─── Prompt-injection / role-break attempts ──────────────────────────────────

const BYPASS_PATTERNS: RegExp[] = [
  /\bjailbreak\b/i,
  /\bdan\s+mode\b/i,
  /\bignore\s+(?:all\s+|your\s+|these\s+|the\s+(?:above\s+)?)?(?:previous\s+|prior\s+|above\s+)?(instructions?|rules?|guidelines?|system\s+prompt)\b/i,
  /\bpretend\s+(you\s+have\s+no\s+rules|you\s+are\s+unfiltered|there\s+are\s+no\s+limits)\b/i,
  /\bact\s+as\s+(if\s+you\s+have\s+no|without)\s+(restrictions?|limits?|filters?)\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bunfiltered\s+(ai|mode|version)\b/i,
  /\bno[\s-]?content[\s-]?filter\b/i,
  /\bsystem\s+prompt.{0,30}(ignore|bypass|override)\b/i,
  // Parley-specific: the mandate is the whole game. Asking the counterpart to
  // recite it out of role is not a safety risk so much as a cheat, but it runs
  // through the same detector because the phrasing is identical to a jailbreak.
  /\b(what|tell\s+me)\s+(is|are)\s+your\s+(mandate|instructions?|system\s+prompt|hidden)\b/i,
  /\bbreak\s+character\b/i,
  /\bstop\s+(role[\s-]?playing|pretending)\s+and\b/i,
];

// ─── Targeted real-world harm ────────────────────────────────────────────────
// New in Parley, and the layer this product specifically needs.
//
// The legitimate use is rehearsing a hard conversation. The misuse is using
// the same room to script coercion, blackmail, retaliation or unlawful
// treatment of a real, named person and then go deliver it. These patterns
// target the INSTRUCTIONAL framing ("help me phrase it so that...", "how do I
// make them...") rather than the topic itself — a user must be able to
// rehearse being on the receiving end of discrimination, or to practise
// reporting it, without tripping this.

const TARGETED_HARM_PATTERNS: RegExp[] = [
  /\bhow\s+(do|can)\s+i\s+(fire|dismiss|terminate|get\s+rid\s+of)\s+(her|him|them|someone)\s+(without|so\s+(they|she|he)\s+can.?t|before\s+(they|she|he)\s+can)\b.{0,40}\b(suing?|sue|lawsuit|claim|tribunal|complain)/i,
  /\b(fire|dismiss|terminate|demote|lay\s+off)\s+(her|him|them|someone)\s+(for|because\s+of)\s+(being\s+)?(pregnant|pregnancy|disabled|their\s+(race|religion|age|disability)|maternity|paternity)\b/i,
  /\bhelp\s+me\s+(word|phrase|write)\s+.{0,40}\b(so|to)\s+.{0,30}\b(threaten|blackmail|intimidate|scare|coerce)\b/i,
  /\b(blackmail|extort|coerce)\s+(her|him|them|my\s+(boss|manager|client|employee))\b/i,
  /\bretaliat(e|ing|ion)\s+against\s+(her|him|them|the\s+(employee|whistle))/i,
  /\bmake\s+(her|him|them)\s+(quit|resign|leave)\s+(so|without|before)\b/i,
  /\b(hide|conceal|destroy|delete)\s+.{0,30}\b(evidence|documents?|emails?|records?)\b.{0,30}\b(before|from)\s+.{0,20}\b(investigation|audit|lawyer|tribunal|discovery)\b/i,
  /\bhow\s+to\s+(get\s+around|avoid|dodge)\s+.{0,30}\b(minimum\s+wage|overtime|severance|notice\s+period)\s+(law|requirement|obligation)/i,
];

// ─── Repeat-offender rate limiting ───────────────────────────────────────────

const bypassAttemptStore = new Map<string, { count: number; firstAt: number }>();

function checkBypassRateLimit(userId: string): boolean {
  const now = Date.now();
  const rec = bypassAttemptStore.get(userId);
  if (!rec || now - rec.firstAt > 600_000) {
    bypassAttemptStore.set(userId, { count: 1, firstAt: now });
    return false;
  }
  rec.count++;
  return rec.count > 3;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

async function hashText(msg: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return msg.slice(0, 8);
}

// 18 U.S.C. §2258A — must never be silenced or suppressed.
async function logCriticalViolation(
  userId: string,
  category: string,
  message: string,
  context: string
): Promise<void> {
  try {
    await supabase.from('critical_violations').insert({
      user_id: userId || 'anonymous',
      category,
      context,
      message_hash: await hashText(message),
      message_preview: message.slice(0, 100),
      logged_at: new Date().toISOString(),
      ip_hint: 'server',
    });
  } catch {
    console.error('[CRITICAL SAFETY VIOLATION]', { category, context, preview: message.slice(0, 50) });
  }
}

async function logSafetyEvent(
  category: string,
  context: string,
  messagePreview: string,
  userId?: string
): Promise<void> {
  try {
    await supabase.from('safety_flags').insert({
      context,
      category,
      message_preview: messagePreview.slice(0, 200),
      user_id: userId ?? null,
      flagged_at: new Date().toISOString(),
    });
  } catch {
    // Degrade silently — safety logging must not block the response path.
  }
}

/** Hash-only audit trail. Never stores plaintext. */
export async function logComplianceEvent(
  eventType: 'content_blocked' | 'content_flagged' | 'account_banned' | 'targeted_harm_blocked',
  userId?: string,
  contentToHash?: string,
  actionTaken?: string
): Promise<void> {
  try {
    const contentHash = contentToHash ? await hashText(contentToHash) : null;
    await supabase.from('compliance_log').insert({
      event_type: eventType,
      user_id: userId ?? null,
      content_hash: contentHash,
      action_taken: actionTaken ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Never block on logging failure.
  }
}

// ─── Lightweight synchronous check ───────────────────────────────────────────
// For callers that only need blocked/soft-flag and cannot await a DB write —
// custom counterpart and custom scenario text is validated through this.

export function checkContent(text: string): ContentCheckResult {
  if (!text) return { blocked: false };
  const normalised = normalizeLeet(text);

  for (const group of [CRITICAL_PATTERNS, MINOR_CONTENT_PATTERNS, SEXUAL_PATTERNS, TARGETED_HARM_PATTERNS]) {
    for (const pattern of group) {
      if (pattern.test(text) || pattern.test(normalised)) {
        return { blocked: true, reason: 'This content is not permitted.', severity: 'critical' };
      }
    }
  }
  for (const pattern of SELF_HARM_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: false, softFlag: 'self-harm', severity: 'soft' };
    }
  }

  return { blocked: false };
}

/**
 * Validates a user-authored counterpart before it is stored.
 *
 * Replaces the character-age check this file used to carry. Parley
 * counterparts are professional roles, not people with ages and appearances,
 * so the check is about the role text itself rather than a birth year.
 */
export function checkCounterpartDefinition(fields: {
  name: string;
  role: string;
  disposition: string;
}): { safe: boolean; reason?: string } {
  const combined = `${fields.name} ${fields.role} ${fields.disposition}`;
  const result = checkContent(combined);
  if (result.blocked) {
    return { safe: false, reason: 'This counterpart cannot be created. Counterparts are professional roles in a negotiation.' };
  }
  // Minor-coded roles have no place in a workplace negotiation tool, and this
  // is the one free-text field where someone could try to introduce one.
  if (/\b(child|kid|minor|student|schoolgirl|schoolboy|teenager|1[0-7]\s*years?\s*old)\b/i.test(combined)) {
    return { safe: false, reason: 'Counterparts must be adults in a professional role.' };
  }
  return { safe: true };
}

// ─── Main check ──────────────────────────────────────────────────────────────

export async function checkSafety(
  message: string,
  context: string,
  userId?: string
): Promise<SafetyResult> {
  const normalised = normalizeLeet(message);

  // ── CRITICAL — federal CSAM. Zero tolerance, immutable log, 451. ──────────
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(message) || pattern.test(normalised)) {
      await logCriticalViolation(userId ?? 'anonymous', 'csam-protect-act', message, context);
      await logSafetyEvent('csam-critical', context, message, userId);
      await logComplianceEvent('content_blocked', userId, message, 'csam-critical-block');
      if (userId) {
        const { count } = await supabase
          .from('critical_violations')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);
        if ((count ?? 0) >= 3) {
          await supabase.from('banned_users').upsert({ user_id: userId, reason: 'critical-repeat', banned_at: new Date().toISOString() });
          await supabase.from('users').update({ banned: true }).eq('id', userId);
          await logComplianceEvent('account_banned', userId, undefined, 'three-critical-violations');
          console.error('[SAFETY] Permanent ban applied to user:', userId);
        }
      }
      return {
        safe: false,
        category: 'csam-critical',
        refusal: 'This session cannot continue. This content is illegal and has been logged.',
        criticalViolation: true,
      };
    }
  }

  for (const pattern of MINOR_CONTENT_PATTERNS) {
    if (pattern.test(message) || pattern.test(normalised)) {
      await logSafetyEvent('minor-content', context, message, userId);
      return { safe: false, category: 'minor-content', refusal: SYSTEM_REFUSAL };
    }
  }

  for (const pattern of GROOMING_PATTERNS) {
    if (pattern.test(message) || pattern.test(normalised)) {
      await logSafetyEvent('grooming', context, message, userId);
      return { safe: false, category: 'grooming', refusal: SYSTEM_REFUSAL };
    }
  }

  for (const pattern of SEXUAL_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('sexual-content', context, message, userId);
      return { safe: false, category: 'sexual-content', refusal: SYSTEM_REFUSAL };
    }
  }

  // ── Targeted real-world harm — Parley's own layer ─────────────────────────
  for (const pattern of TARGETED_HARM_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('targeted-harm', context, message, userId);
      await logComplianceEvent('targeted_harm_blocked', userId, message, 'targeted-harm-block');
      return {
        safe: false,
        category: 'targeted-harm',
        refusal:
          'Parley rehearses conversations, not ways to pressure or disadvantage a specific person unlawfully. If you are trying to handle a hard situation legitimately, rephrase what outcome you actually want and the room will run.',
      };
    }
  }

  // ── Self-harm — SOFT FLAG. Allowed through with resources attached. ───────
  // Blocking someone who discloses distress produces worse outcomes than
  // meeting them; the caller injects care handling rather than refusing.
  for (const pattern of SELF_HARM_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('self-harm', context, message, userId);
      await logComplianceEvent('content_flagged', userId, message, 'self-harm-soft-flag');
      return {
        safe: true,
        category: 'self-harm',
        selfHarmDetected: true,
        emergencyResources: SELF_HARM_RESOURCES,
      };
    }
  }

  for (const pattern of VIOLENCE_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('violence-instructions', context, message, userId);
      return { safe: false, category: 'violence-instructions', refusal: SYSTEM_REFUSAL };
    }
  }

  for (const pattern of VIOLENCE_MENTION_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('violence-mention', context, message, userId);
      return { safe: true, category: 'violence-mention', violenceMentionDetected: true };
    }
  }

  for (const pattern of DOXXING_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('doxxing', context, message, userId);
      return { safe: false, category: 'doxxing', refusal: SYSTEM_REFUSAL };
    }
  }

  for (const pattern of HATE_PATTERNS) {
    if (pattern.test(message)) {
      await logSafetyEvent('hate-speech', context, message, userId);
      return { safe: false, category: 'hate-speech', refusal: SYSTEM_REFUSAL };
    }
  }

  for (const pattern of BYPASS_PATTERNS) {
    if (pattern.test(message)) {
      if (userId && checkBypassRateLimit(userId)) {
        await logSafetyEvent('bypass-attempt-blocked', context, message, userId);
        return {
          safe: false,
          category: 'bypass-blocked',
          refusal: 'Your account has been temporarily restricted after repeated attempts to bypass safety guidelines.',
        };
      }
      await logSafetyEvent('bypass-attempt', context, message, userId);
      return {
        safe: false,
        category: 'bypass-attempt',
        refusal: 'The counterpart stays in role for the whole rehearsal — including their mandate. End the session to see it in the debrief.',
      };
    }
  }

  return { safe: true };
}

// Output-side patterns, applied to the counterpart's accumulated reply as it
// streams. Kept separate from the input patterns because the risk is
// different: the counterpart is a professional under pressure and is allowed
// to be rude, but must never sexualise the exchange or step outside role.
export const OUTPUT_BLOCK_PATTERNS: RegExp[] = [
  ...CRITICAL_PATTERNS,
  ...MINOR_CONTENT_PATTERNS,
  ...SEXUAL_PATTERNS,
  ...HATE_PATTERNS,
];
