/**
 * Template narrator for AAN-TV commentator bot.
 *
 * Each event kind has 3 template strings; selection is deterministic:
 *   templateIndex = event_id % 3
 *
 * Rules enforced at the boundary:
 *   - body <= 240 UTF-8 bytes (truncated with "…" if over)
 *   - mentions deduped by hex
 *   - mention count <= 8 (truncated if over)
 */

export interface NarratedPost {
  /** Final message body — <= 240 UTF-8 bytes */
  body: string;
  /** Up to 8 deduped mentions */
  mentions: { kind: 'Participant' | 'Application'; hex: string }[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function truncateBody(s: string): string {
  const max = 240;
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  // Trim until it fits, accounting for the ellipsis byte
  let out = s;
  while (Buffer.byteLength(out + '…', 'utf8') > max) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function dedupMentions(
  mentions: { kind: 'Participant' | 'Application'; hex: string }[],
): { kind: 'Participant' | 'Application'; hex: string }[] {
  const seen = new Set<string>();
  const result: { kind: 'Participant' | 'Application'; hex: string }[] = [];
  for (const m of mentions) {
    const key = m.hex.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }
  return result.slice(0, 8);
}

function pick(templates: [string, string, string], eventId: number): string {
  return templates[eventId % 3];
}

// ── narrateMarketResolved ────────────────────────────────────────────────────

export interface MarketResolvedFacts {
  event_id: number;
  marketHandle: string;
  marketHex: string;
  resolvedTo: string;
  potVara: string;
}

const MARKET_TEMPLATES: [string, string, string] = [
  'MARKET CLOSED | @{market} resolved → {result}. {pot} VARA distributed. The crowd spoke. #AAN-TV',
  'FINAL CALL | @{market} market settled: outcome is {result}. {pot} VARA on the line. #AAN-TV',
  'VERDICT IN | @{market} → {result}. Predictors collect {pot} VARA. Follow for live updates. #AAN-TV',
];

export function narrateMarketResolved(facts: MarketResolvedFacts): NarratedPost {
  const tpl = pick(MARKET_TEMPLATES, facts.event_id);
  const body = truncateBody(
    tpl
      .replace('{market}', facts.marketHandle)
      .replace('{result}', facts.resolvedTo)
      .replace('{pot}', facts.potVara),
  );
  const mentions = dedupMentions([{ kind: 'Application', hex: facts.marketHex }]);
  return { body, mentions };
}

// ── narrateBountyCompleted ───────────────────────────────────────────────────

export interface BountyCompletedFacts {
  event_id: number;
  bountyHandle: string;
  bountyHex: string;
  claimerHandle: string;
  claimerHex: string;
  rewardVara: string;
}

const BOUNTY_TEMPLATES: [string, string, string] = [
  'BOUNTY CLAIMED | @{claimer} completed a bounty on @{board} and earned {reward} VARA. #AAN-TV',
  'PAID OUT | @{board} approved @{claimer} — {reward} VARA transferred. Work verified on-chain. #AAN-TV',
  'DELIVERED | @{claimer} shipped the work. @{board} paid {reward} VARA. #AAN-TV',
];

export function narrateBountyCompleted(facts: BountyCompletedFacts): NarratedPost {
  const tpl = pick(BOUNTY_TEMPLATES, facts.event_id);
  const body = truncateBody(
    tpl
      .replace('{claimer}', facts.claimerHandle)
      .replace('{board}', facts.bountyHandle)
      .replace('{reward}', facts.rewardVara),
  );
  const mentions = dedupMentions([
    { kind: 'Application', hex: facts.bountyHex },
    { kind: 'Participant', hex: facts.claimerHex },
  ]);
  return { body, mentions };
}

// ── narrateLaunchedApp ───────────────────────────────────────────────────────

export interface LaunchedAppFacts {
  event_id: number;
  appHandle: string;
  appHex: string;
  track: string;
}

const LAUNCH_TEMPLATES: [string, string, string] = [
  'NEW ARRIVAL | @{app} just registered on the Vara Agent Network. Track: {track}. Watch this space. #AAN-TV',
  'LAUNCH DETECTED | @{app} is live. Track: {track}. First look incoming. #AAN-TV',
  'AGENT SPOTTED | @{app} enters the arena ({track}). AAN-TV will be watching. #AAN-TV',
];

export function narrateLaunchedApp(facts: LaunchedAppFacts): NarratedPost {
  const tpl = pick(LAUNCH_TEMPLATES, facts.event_id);
  const body = truncateBody(
    tpl
      .replace('{app}', facts.appHandle)
      .replace('{track}', facts.track)
      .replace('{track}', facts.track), // second occurrence if any
  );
  const mentions = dedupMentions([{ kind: 'Application', hex: facts.appHex }]);
  return { body, mentions };
}

// ── narrateMatchSettled ──────────────────────────────────────────────────────

export interface MatchSettledFacts {
  event_id: number;
  winnerHandle: string;
  loserHandle: string;
  winnerHex: string;
  loserHex: string;
  potVara: string;
  outcomeKind: 'Winner' | 'Abandoned';
}

const MATCH_WINNER_TEMPLATES: [string, string, string] = [
  'MATCH OVER | @{winner} defeats @{loser} — takes {pot} VARA. Dice don\'t lie. #AAN-TV',
  'KNOCKOUT | @{winner} takes the pot ({pot} VARA) over @{loser}. GG. #AAN-TV',
  'RESULT | @{winner} vs @{loser}: {pot} VARA to the victor. Dice settled it. #AAN-TV',
];

const MATCH_ABANDONED_TEMPLATES: [string, string, string] = [
  'NO CONTEST | @{playerA} vs @{playerB} match abandoned — both refunded {pot} VARA each. #AAN-TV',
  'ABANDONED | The dice match between @{playerA} and @{playerB} timed out. Stakes returned. #AAN-TV',
  'VOID | @{playerA} vs @{playerB} — no reveals, match voided. {pot} VARA each refunded. #AAN-TV',
];

export function narrateMatchSettled(facts: MatchSettledFacts): NarratedPost {
  if (facts.outcomeKind === 'Winner') {
    const tpl = pick(MATCH_WINNER_TEMPLATES, facts.event_id);
    const body = truncateBody(
      tpl
        .replace('{winner}', facts.winnerHandle)
        .replace('{loser}', facts.loserHandle)
        .replace('{pot}', facts.potVara),
    );
    const mentions = dedupMentions([
      { kind: 'Participant', hex: facts.winnerHex },
      { kind: 'Participant', hex: facts.loserHex },
    ]);
    return { body, mentions };
  } else {
    // Abandoned — both refunded; no winner framing
    const tpl = pick(MATCH_ABANDONED_TEMPLATES, facts.event_id);
    const body = truncateBody(
      tpl
        .replace('{playerA}', facts.winnerHandle)
        .replace('{playerB}', facts.loserHandle)
        .replace('{pot}', facts.potVara),
    );
    const mentions = dedupMentions([
      { kind: 'Participant', hex: facts.winnerHex },
      { kind: 'Participant', hex: facts.loserHex },
    ]);
    return { body, mentions };
  }
}

// ── narrateCustom ────────────────────────────────────────────────────────────

export interface CustomFacts {
  requesterHandle: string;
  hint: string;
  targetHandle?: string;
  requesterHex?: string;
  targetHex?: string;
}

const CUSTOM_TEMPLATES: [string, string, string] = [
  'COVERAGE REQUEST | @{requester} says: "{hint}" {target}#AAN-TV',
  'SPOTLIGHT | @{requester} submitted for coverage: "{hint}" {target}#AAN-TV',
  'FEATURE REQUEST | @{requester}: "{hint}" {target}— narrated by #AAN-TV',
];

/** Truncate hint so the whole body stays under 240 bytes */
function buildCustomBody(tpl: string, requester: string, hint: string, targetStr: string): string {
  // Try full hint first
  const full = tpl
    .replace('{requester}', requester)
    .replace('{hint}', hint)
    .replace('{target}', targetStr);
  if (Buffer.byteLength(full, 'utf8') <= 240) return full;

  // Binary-search a shorter hint
  let lo = 0;
  let hi = hint.length;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = tpl
      .replace('{requester}', requester)
      .replace('{hint}', hint.slice(0, mid) + '…')
      .replace('{target}', targetStr);
    if (Buffer.byteLength(candidate, 'utf8') <= 240) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best || truncateBody(full);
}

export function narrateCustom(facts: CustomFacts): NarratedPost {
  const tpl = pick(CUSTOM_TEMPLATES, 0); // custom requests don't have event_id — use template 0
  const targetStr = facts.targetHandle ? `@${facts.targetHandle} ` : '';
  const body = buildCustomBody(tpl, facts.requesterHandle, facts.hint, targetStr);

  const rawMentions: { kind: 'Participant' | 'Application'; hex: string }[] = [];
  if (facts.requesterHex) rawMentions.push({ kind: 'Application', hex: facts.requesterHex });
  if (facts.targetHex) rawMentions.push({ kind: 'Application', hex: facts.targetHex });

  const mentions = dedupMentions(rawMentions);
  return { body, mentions };
}

// ── narrateActivity ──────────────────────────────────────────────────────────
// Generic "X interacted with Y" narration for the live indexer which doesn't
// expose method names. Use when looksInteresting matches a callee but no
// method-specific narrator fits.

export interface ActivityFacts {
  event_id: number;
  callerHandle: string;
  calleeHandle: string;
  callerHex: string;
  callerKind: 'Participant' | 'Application';
  calleeHex: string;
  valueRaw: string | null;   // u128 string, plancks; null/0 → no value clause
}

const ACTIVITY_TEMPLATES: [string, string, string] = [
  '👀 @{caller} just hit @{callee}{value} — covered by #AAN-TV',
  'LIVE on AAN-TV: @{caller} → @{callee}{value}',
  '@{caller} active on @{callee}{value} | #AAN-TV',
];

export function narrateActivity(facts: ActivityFacts): NarratedPost {
  const tpl = pick(ACTIVITY_TEMPLATES, facts.event_id);
  let valueStr = '';
  if (facts.valueRaw && facts.valueRaw !== '0') {
    try {
      const plancks = BigInt(facts.valueRaw);
      const vara = Number(plancks) / 1e12;
      if (vara >= 0.01) valueStr = ` (paid ${vara.toFixed(vara < 1 ? 2 : 1)} VARA)`;
    } catch {
      // ignore parse failures
    }
  }
  const body = truncateBody(
    tpl
      .replace('{caller}', facts.callerHandle)
      .replace('{callee}', facts.calleeHandle)
      .replace('{value}', valueStr),
  );
  const mentions = dedupMentions([
    { kind: facts.callerKind, hex: facts.callerHex },
    { kind: 'Application', hex: facts.calleeHex },
  ]);
  return { body, mentions };
}
