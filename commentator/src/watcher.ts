/**
 * Main watcher loop for AAN-TV commentator bot.
 *
 * Every POLL_INTERVAL_MS:
 *   1. Refresh voucher if stale
 *   2. (Path B) Tick the paid coverage queue — process uncovered items first
 *   3. (Path A) Fetch interactions since last seen block and narrate organically
 *   4. Advance lastSeenBlock checkpoint
 *   5. Sleep POLL_INTERVAL_MS
 *
 * Rate-limit: Chat/Post enforces 5s per author. The chat.ts module tracks
 *   lastChatPostMs and waits. We do not need a separate tracker here.
 */

import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { isSelfLoop } from './self-loop-guard.js';
import {
  fetchInteractionsSinceBlock,
  fetchChainTipBlock,
  fetchCoverageQueue,
  fetchDigestData,
  resolveHandle,
  resolveApplicationHandle,
  type Interaction,
} from './indexer.js';
import {
  getLastSeenBlock,
  setLastSeenBlock,
  getLastSeenCoverageId,
  setLastSeenCoverageId,
  alreadyProcessed,
  recordProcessed,
  recordFailed,
  getLastDigestPostedAt,
  setLastDigestPostedAt,
  alreadyHandledBoardSignCallback,
  recordBoardSignCallback,
  lastBoardCallbackMsForCaller,
} from './checkpoint.js';
import { postChatAsApplication, markCovered } from './chat.js';
import { ensureFresh } from './voucher.js';
import {
  callRegisteredPartner,
  findPartnerCallForProgram,
  runIntegrationCycle,
} from './integration-runner.js';
import {
  narrateMarketResolved,
  narrateBountyCompleted,
  narrateLaunchedApp,
  narrateMatchSettled,
  narrateCustom,
  narrateActivity,
  narrateHourlyDigest,
  type NarratedPost,
  type DigestFacts,
} from './narrator.js';

const execFileAsync = promisify(_execFile);

// ── interesting-event allowlist ─────────────────────────────────────────────
//
// Format: { callee: string | '__OWN__' | '__PID__', methodNames: string[], kind: NarrationKind }
// __OWN__ is resolved at runtime to APP_HEX.
// __PID__ is resolved at runtime to PID (Vara A2A network program).

type NarrationKind =
  | 'MatchSettled'
  | 'MarketResolved'
  | 'BountyCompleted'
  | 'LaunchedApp'
  | 'Activity';   // generic "X interacted with Y" — used when no method-specific narrator fits

interface InterestingFilter {
  /** Match by callee hex OR sentinels `__OWN__` / `__PID__` */
  hex?: string;
  /** Match by pre-resolved calleeHandle (preferred when callee is a registered app) */
  handle?: string;
  kind: NarrationKind;
}

// ── Our AAN-TV cluster hexes (INBOUND calls to these always narrate per-event)
// Includes APP_HEX (aan-tv) plus the three cluster programs.
// Used for both the allowlist and for the per-event throttle decision.
const AAN_TV_BOARD_HEX = '0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d';
const AAN_TV_TIP_HEX = '0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02';
const AAN_TV_DATA_HEX = '0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c';

const CLUSTER_HEXES_STATIC = [
  AAN_TV_BOARD_HEX, // aan-tv-board
  AAN_TV_TIP_HEX,   // aan-tv-tip
  AAN_TV_DATA_HEX,  // aan-tv-data
];

// All allowlisted handles (for fetchDigestData)
const ALLOWLIST_HANDLES = [
  'vara-agents',
  'varapulse',
  'varabridge',
  'varaflow-org',
  'infinite-bounty-v3',
  'zeeast-casino',
  'skopos-bridge',
  'hy4-predict-app',
  'hy4-game-app',
  'thebookdex',
  'agent-tic-tac-toe',
];

// NOTE: the live indexer schema does NOT expose `method` on Interaction (always null).
// We can only filter by callee, not by method. Anything matching here is narrated as
// the kind below; for the generic `Activity` kind we just say "X interacted with Y".
const INTERESTING_FILTERS: InterestingFilter[] = [
  // Our own AAN-TV program — any call to us is worth narrating
  { hex: '__OWN__',  kind: 'Activity' },
  // Our cluster apps (deployed 2026-05-19) — calls to ANY of these get covered
  { hex: CLUSTER_HEXES_STATIC[0], kind: 'Activity' }, // aan-tv-board
  { hex: CLUSTER_HEXES_STATIC[1], kind: 'Activity' }, // aan-tv-tip
  { hex: CLUSTER_HEXES_STATIC[2], kind: 'Activity' }, // aan-tv-data
  // NOTE: __PID__ (vara-agents network program) removed per codex pre-deploy review —
  // matched EVERY chat/board/register call across the network, drowning chat with
  // @infinitebuilder narrations and diluting our signal. Focus on app-level activity.
  // High-activity Season-1 apps
  { handle: 'vara-agents',      kind: 'Activity' },
  { handle: 'varapulse',        kind: 'Activity' },
  { handle: 'varabridge',       kind: 'Activity' },
  { handle: 'varaflow-org',     kind: 'Activity' },
  { handle: 'infinite-bounty-v3', kind: 'BountyCompleted' },
  { handle: 'zeeast-casino',    kind: 'MatchSettled' },
  // Other apps from the day-0 scan that are likely to be active
  { handle: 'skopos-bridge',    kind: 'Activity' },
  { handle: 'hy4-predict-app',  kind: 'MarketResolved' },
  { handle: 'hy4-game-app',     kind: 'Activity' },
  { handle: 'thebookdex',       kind: 'Activity' },
  { handle: 'agent-tic-tac-toe', kind: 'Activity' },
];

// Threshold for "high-value" per-event narration: 1 VARA in plancks
const HIGH_VALUE_THRESHOLD_RAW = 1_000_000_000_000n;

function resolveHexSentinel(raw: string): string {
  if (raw === '__OWN__') return process.env.APP_HEX ?? '';
  if (raw === '__PID__') return process.env.PID ?? '';
  return raw;
}

/**
 * Returns the full set of cluster callee hexes (AAN-TV + board + tip + data).
 * Computed at call time so APP_HEX is resolved from env (set by boot time).
 */
function getClusterHexes(): string[] {
  const appHex = process.env.APP_HEX ?? '';
  return [appHex, ...CLUSTER_HEXES_STATIC].filter(Boolean).map((h) => h.toLowerCase());
}

/**
 * Returns true if this interaction's callee is one of our cluster programs.
 * Inbound calls to our cluster are always narrated per-event.
 */
function isClusterCallee(interaction: Interaction): boolean {
  return getClusterHexes().includes(interaction.callee.toLowerCase());
}

/**
 * Returns true if this interaction has a value paid >= 1 VARA.
 */
function isHighValue(interaction: Interaction): boolean {
  if (!interaction.valuePaidRaw || interaction.valuePaidRaw === '0') return false;
  try {
    return BigInt(interaction.valuePaidRaw) >= HIGH_VALUE_THRESHOLD_RAW;
  } catch {
    return false;
  }
}

/**
 * Build a DigestFacts object from raw bucket data for use in narrateHourlyDigest.
 */
function buildDigestFacts(
  bucket: Awaited<ReturnType<typeof fetchDigestData>>,
): DigestFacts {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const hour_label = `${hh}:${mm} UTC`;

  // Sort by count desc, take top N
  const topCallees = [...bucket.byCallee.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((c) => ({ handle: c.handle ?? c.hex.slice(0, 8) + '…', hex: c.hex, count: c.count }));

  const topCallers = [...bucket.byCaller.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((c) => ({
      handle: c.handle ?? c.hex.slice(0, 8) + '…',
      hex: c.hex,
      kind: (c.kind === 'Application' ? 'Application' : 'Participant') as 'Application' | 'Participant',
      count: c.count,
    }));

  const valueVara = Number(bucket.valueRawSum) / 1e12;

  return {
    hour_label,
    totalCalls: bucket.totalCalls,
    paidCalls: bucket.paidCalls,
    valueVara,
    topCallees,
    topCallers,
  };
}

/** Returns a display handle: pre-resolved handle or truncated hex fallback */
function displayHandle(handle: string | null, hex: string): string {
  return handle ?? hex.slice(0, 8) + '…';
}

function stripAt(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = s;
  while (Buffer.byteLength(out + '…', 'utf8') > maxBytes) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function shortTx(raw: string): string {
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 10)}…${raw.slice(-6)}`;
}

function hasBoardSignMethod(methodName: string | null): boolean {
  const method = methodName?.toLowerCase();
  return method === 'sign' || method === 'aan_tv_board/sign' || method === 'aantvboard/sign';
}

function boardPartnerCallbacksEnabled(): boolean {
  return process.env.BOARD_PARTNER_CALLBACKS_ENABLED === 'true';
}

function isBoardSignInteraction(interaction: Interaction): boolean {
  if (interaction.callee.toLowerCase() !== AAN_TV_BOARD_HEX.toLowerCase()) return false;
  return interaction.method == null || hasBoardSignMethod(interaction.method);
}

function boardIdlPath(): string {
  return (
    process.env.AAN_TV_BOARD_IDL ??
    fileURLToPath(new URL('../../docs/aan_tv_board.idl', import.meta.url))
  );
}

interface BoardEntry {
  id: number;
  author: string;
  thought: string;
  block: number;
}

function parseBoardEntry(raw: unknown): BoardEntry | null {
  const row = raw as Record<string, unknown>;
  const id = Number(row['id']);
  const author = row['author'];
  const thought = row['thought'];
  const block = Number(row['block']);

  if (!Number.isFinite(id) || typeof author !== 'string' || typeof thought !== 'string') {
    return null;
  }

  return {
    id,
    author,
    thought,
    block: Number.isFinite(block) ? block : 0,
  };
}

// In-process cache of the full board entry list. ReadState is expensive
// (returns ALL entries) and called from each board-Sign callback. Caching for
// ~45s collapses a bulk-sign burst into one ReadState instead of N.
let boardEntriesCache: { entries: BoardEntry[]; fetchedAtMs: number } | null = null;
const BOARD_ENTRIES_CACHE_TTL_MS = 45_000;

async function fetchBoardEntries(): Promise<BoardEntry[]> {
  const acct = process.env.ACCT;
  if (!acct) throw new Error('fetchBoardEntries: ACCT env var is required');

  const now = Date.now();
  if (
    boardEntriesCache !== null &&
    now - boardEntriesCache.fetchedAtMs < BOARD_ENTRIES_CACHE_TTL_MS
  ) {
    return boardEntriesCache.entries;
  }

  const network = process.env.VARA_NETWORK ?? 'mainnet';
  const { stdout } = await execFileAsync(
    'vara-wallet',
    [
      '--account', acct,
      '--network', network,
      '--json',
      'call',
      AAN_TV_BOARD_HEX,
      'AanTvBoard/ReadState',
      '--idl', boardIdlPath(),
    ],
    { timeout: 30_000 },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`ReadState returned non-JSON: ${stdout.slice(0, 200)}`);
  }

  if (parsed['programMessage'] != null) {
    throw new Error(`ReadState panicked: ${JSON.stringify(parsed['programMessage'])}`);
  }

  const result = parsed['result'];
  if (!Array.isArray(result)) return [];

  const entries = result.map(parseBoardEntry).filter((entry): entry is BoardEntry => entry != null);
  boardEntriesCache = { entries, fetchedAtMs: now };
  return entries;
}

function pickBoardEntryForInteraction(
  entries: BoardEntry[],
  interaction: Interaction,
  allowFallback: boolean,
): BoardEntry | null {
  const caller = interaction.caller.toLowerCase();
  const candidates = entries
    .filter((entry) => entry.author.toLowerCase() === caller)
    .sort((a, b) => {
      const byBlock = b.block - a.block;
      if (byBlock !== 0) return byBlock;
      return b.id - a.id;
    });

  if (candidates.length === 0) return null;

  const exact = candidates.find((entry) => entry.block === interaction.blockNumber);
  if (exact) return exact;

  const near = candidates.find((entry) => Math.abs(entry.block - interaction.blockNumber) <= 10);
  if (near) return near;

  return allowFallback ? candidates[0] : null;
}

interface BoardSignCallbackResult {
  handled: boolean;
  status: 'posted' | 'duplicate' | 'failed' | 'not-board-sign';
  msgId?: string;
  txHash?: string;
  error?: string;
}

async function handleBoardSignCallback(
  interaction: Interaction,
): Promise<BoardSignCallbackResult> {
  if (!isBoardSignInteraction(interaction)) {
    return { handled: false, status: 'not-board-sign' };
  }

  try {
    const entries = await fetchBoardEntries();
    const methodKnownSign = hasBoardSignMethod(interaction.method);
    const entry = pickBoardEntryForInteraction(entries, interaction, methodKnownSign);
    if (!entry) {
      if (!methodKnownSign) {
        return { handled: false, status: 'not-board-sign' };
      }
      return {
        handled: true,
        status: 'failed',
        error: 'board entry not found for Sign interaction',
      };
    }

    if (alreadyHandledBoardSignCallback(interaction.caller, entry.id)) {
      console.log(
        `[aan-tv] Board Sign callback already handled: caller=${interaction.caller} entry=${entry.id}`,
      );
      return { handled: true, status: 'duplicate' };
    }

    // Per-caller throttle: avoid 200-chat-post floods when a bounty hunter
    // signs in bulk. Default 1 hour; tune via BOARD_CALLBACK_PER_CALLER_INTERVAL_MS.
    const throttleMs = Number(
      process.env.BOARD_CALLBACK_PER_CALLER_INTERVAL_MS ?? 60 * 60_000,
    );
    const lastCallbackMs = lastBoardCallbackMsForCaller(interaction.caller);
    if (lastCallbackMs !== null && Date.now() - lastCallbackMs < throttleMs) {
      console.log(
        `[aan-tv] Board Sign callback throttled: caller=${interaction.caller} ` +
          `last=${new Date(lastCallbackMs).toISOString()} window=${throttleMs}ms`,
      );
      recordBoardSignCallback(interaction.caller, entry.id, new Date().toISOString());
      return { handled: true, status: 'duplicate' };
    }

    const applicationHandle = await resolveApplicationHandle(interaction.caller);
    const callerHandle = applicationHandle ?? displayHandle(interaction.callerHandle, interaction.caller);
    const callbackPartner = findPartnerCallForProgram(interaction.caller);
    const callbackEnabled = boardPartnerCallbacksEnabled();
    const callbackText = callbackPartner
      ? callbackEnabled
        ? `Calling back at ${callbackPartner.method}.`
        : 'Verified callback exists; outbound callbacks are budget-paused.'
      : 'No verified free callback registered yet.';

    const quotedThought = truncateUtf8(entry.thought, 72);
    const body = truncateUtf8(
      `AanTvBoard/Sign: @${stripAt(callerHandle)} signed our board ("${quotedThought}"). ${callbackText} tx:${shortTx(interaction.id)}`,
      240,
    );

    const mentionKind: 'Participant' | 'Application' =
      applicationHandle || interaction.callerKind === 'Application' ? 'Application' : 'Participant';
    const post = {
      body,
      mentions: [{ kind: mentionKind, hex: interaction.caller }],
    };

    const postResult = await postChatAsApplication(post);
    recordBoardSignCallback(interaction.caller, entry.id, new Date().toISOString());
    console.log(
      `[aan-tv] Board Sign callback posted: caller=${callerHandle} entry=${entry.id} msgId=${postResult.msgId}`,
    );

    if (callbackPartner && callbackEnabled) {
      try {
        const callbackResult = await callRegisteredPartner(interaction.caller);
        if (callbackResult?.status === 'failed') {
          console.error(
            `[aan-tv] Board Sign partner callback failed: ${callbackResult.key} ${callbackResult.error}`,
          );
        } else if (callbackResult) {
          console.log(
            `[aan-tv] Board Sign partner callback ${callbackResult.status}: ${callbackResult.key}`,
          );
        }
      } catch (callbackErr) {
        console.error('[aan-tv] Board Sign partner callback failed:', callbackErr);
      }
    } else if (callbackPartner) {
      console.log(
        `[aan-tv] Board Sign partner callback disabled by BOARD_PARTNER_CALLBACKS_ENABLED=false: ${callbackPartner.key}`,
      );
    }

    return {
      handled: true,
      status: 'posted',
      msgId: postResult.msgId,
      txHash: postResult.txHash,
    };
  } catch (err) {
    return {
      handled: true,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function looksInteresting(i: Interaction): NarrationKind | null {
  for (const f of INTERESTING_FILTERS) {
    if (f.hex) {
      const resolvedHex = resolveHexSentinel(f.hex);
      if (resolvedHex && i.callee.toLowerCase() === resolvedHex.toLowerCase()) return f.kind;
    }
    if (f.handle && i.calleeHandle === f.handle) return f.kind;
  }
  return null;
}

// ── narrate helper ──────────────────────────────────────────────────────────

let eventIdCounter = 0;

async function narrateInteraction(
  interaction: Interaction,
  kind: NarrationKind,
): Promise<NarratedPost | null> {
  const eventId = eventIdCounter++;

  // Use pre-resolved handles from indexer; fall back to resolveHandle for
  // unregistered wallets where callerHandle/calleeHandle are null.
  const callerHandle =
    interaction.callerHandle ?? (await resolveHandle(interaction.caller));
  const calleeHandle =
    interaction.calleeHandle ?? (await resolveHandle(interaction.callee));

  const callerDisplay = displayHandle(callerHandle, interaction.caller);
  const calleeDisplay = displayHandle(calleeHandle, interaction.callee);

  switch (kind) {
    case 'MatchSettled': {
      return narrateMatchSettled({
        event_id: eventId,
        winnerHandle: callerDisplay,
        loserHandle: calleeDisplay,
        winnerHex: interaction.caller,
        loserHex: interaction.callee,
        potVara: '?',
        outcomeKind: 'Winner',
      });
    }

    case 'MarketResolved': {
      return narrateMarketResolved({
        event_id: eventId,
        marketHandle: calleeDisplay,
        marketHex: interaction.callee,
        resolvedTo: '?',
        potVara: '?',
      });
    }

    case 'BountyCompleted': {
      return narrateBountyCompleted({
        event_id: eventId,
        bountyHandle: calleeDisplay,
        bountyHex: interaction.callee,
        claimerHandle: callerDisplay,
        claimerHex: interaction.caller,
        rewardVara: '?',
      });
    }

    case 'LaunchedApp': {
      // For RegisterApplication, caller is the registering operator.
      // calleeHandle is the registered program's handle if it was already
      // registered — otherwise fall back to caller data.
      return narrateLaunchedApp({
        event_id: eventId,
        appHandle: calleeHandle ? calleeDisplay : callerDisplay,
        appHex: calleeHandle ? interaction.callee : interaction.caller,
        track: 'Unknown',
      });
    }

    case 'Activity': {
      const callerKind = interaction.callerKind === 'Application' ? 'Application' : 'Participant';
      return narrateActivity({
        event_id: eventId,
        callerHandle: callerDisplay,
        calleeHandle: calleeDisplay,
        callerHex: interaction.caller,
        callerKind,
        calleeHex: interaction.callee,
        valueRaw: interaction.valuePaidRaw,
      });
    }

    default:
      return null;
  }
}

// ── Path B: tick coverage queue ─────────────────────────────────────────────

async function tickCoverageQueue(): Promise<void> {
  const cursor = getLastSeenCoverageId();
  let result: { items: Awaited<ReturnType<typeof fetchCoverageQueue>>['items']; nextCursor: bigint | null };
  try {
    result = await fetchCoverageQueue(cursor, 50);
  } catch (err) {
    console.error('[aan-tv] fetchCoverageQueue failed:', err);
    return;
  }

  for (const item of result.items) {
    // Already covered — skip silently
    if (item.chatMsgId != null) {
      // Advance cursor past this item so we don't re-check it every tick
      const itemId = BigInt(item.id);
      const nextCursor = itemId + 1n;
      if (nextCursor > getLastSeenCoverageId()) {
        setLastSeenCoverageId(nextCursor);
      }
      continue;
    }

    console.log(
      `[aan-tv] Coverage request id=${item.id} requester=${item.requester} hint="${item.hint.slice(0, 40)}"`,
    );

    // Resolve handles for requester and target
    const requesterHandle = await resolveHandle(item.requester);
    const targetHandle = item.targetProgram ? await resolveHandle(item.targetProgram) : undefined;

    const post = narrateCustom({
      requesterHandle: displayHandle(requesterHandle, item.requester),
      hint: item.hint,
      targetHandle: targetHandle ?? undefined,
      requesterHex: item.requester,
      targetHex: item.targetProgram ?? undefined,
    });

    console.log(`[aan-tv] Posting coverage narration: ${post.body.slice(0, 60)}…`);

    try {
      const postResult = await postChatAsApplication(post);
      console.log(
        `[aan-tv] Coverage narration posted: msgId=${postResult.msgId} txHash=${postResult.txHash}`,
      );

      // Mark covered on-chain
      try {
        await markCovered(BigInt(item.id), BigInt(postResult.msgId));
        console.log(`[aan-tv] MarkCovered OK: coverageId=${item.id}`);
      } catch (markErr) {
        // Non-fatal — the post already landed; log but keep going
        console.error(`[aan-tv] MarkCovered failed (post already made): ${markErr}`);
      }

      // Advance coverage cursor past this item
      const itemId = BigInt(item.id);
      const nextCursor = itemId + 1n;
      if (nextCursor > getLastSeenCoverageId()) {
        setLastSeenCoverageId(nextCursor);
      }
    } catch (err) {
      console.error('[aan-tv] Failed to post coverage narration:', err);
      // Don't advance cursor — retry next tick
    }
  }
}

// ── main loop ───────────────────────────────────────────────────────────────

export async function runWatcher(opts: { intervalMs: number }): Promise<never> {
  const operatorHex = process.env.OPERATOR_HEX ?? '';
  const appHex = process.env.APP_HEX ?? '';
  const integrationRunnerEnabled = process.env.INTEGRATION_RUNNER_ENABLED === 'true';
  const integrationRunnerIntervalMs = Number(
    process.env.INTEGRATION_RUNNER_INTERVAL_MS ?? 10 * 60_000,
  );
  let lastIntegrationCycleAt = 0;

  console.log('[aan-tv] Starting AAN-TV commentator watcher');
  console.log(`[aan-tv] APP_HEX: ${appHex}`);
  console.log(`[aan-tv] OPERATOR_HEX: ${operatorHex}`);
  console.log(`[aan-tv] Poll interval: ${opts.intervalMs}ms`);
  console.log(
    `[aan-tv] Integration runner: ${integrationRunnerEnabled ? 'enabled' : 'disabled'} interval=${integrationRunnerIntervalMs}ms`,
  );
  console.log(
    `[aan-tv] Board partner callbacks: ${boardPartnerCallbacksEnabled() ? 'enabled' : 'disabled'}`,
  );

  // Cold-start backfill — if checkpoint is 0 (fresh DB), seed to
  // chain tip - 100 so first tick processes recent history instead of all
  // network history from genesis.
  {
    const existingBlock = getLastSeenBlock();
    if (existingBlock === 0) {
      try {
        const tipBlock = await fetchChainTipBlock();
        const seedBlock = Math.max(0, tipBlock - 100);
        setLastSeenBlock(seedBlock);
        console.log(
          `[aan-tv] cold start: seeding checkpoint to block ${seedBlock} (chain tip ${tipBlock} - 100)`,
        );
      } catch (err) {
        console.warn('[aan-tv] cold-start tip fetch failed; starting from block 0:', err);
      }
    }
  }

  // Digest boot-time guard — if last_digest_ts is 0 or stale (> 24 h), set to
  // now so the first digest fires 60 min from boot, not immediately.
  {
    const lastDigest = getLastDigestPostedAt();
    const now = Date.now();
    const H24 = 24 * 3600_000;
    if (lastDigest === 0 || now - lastDigest > H24) {
      setLastDigestPostedAt(now);
      console.log('[aan-tv] digest boot-guard: first digest will fire in ~60 min');
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const loopStart = Date.now();

    try {
      // 1. ensureFresh() before EVERY tick — always GETs voucher state
      // (free/read-only), POSTs top-up only if balance is low or voucher
      // missing. If this throws (network error, no voucher), skip the tick
      // entirely — do NOT advance checkpoint.
      let voucherId: string;
      try {
        voucherId = await ensureFresh();
        console.log(`[aan-tv] Voucher OK: ${voucherId.slice(0, 16)}…`);
      } catch (err) {
        console.error('[aan-tv] Voucher ensureFresh failed — skipping tick:', err);
        const elapsed = Date.now() - loopStart;
        await new Promise<void>((r) => setTimeout(r, Math.max(0, opts.intervalMs - elapsed)));
        continue;
      }

      // 2. Path B (priority): tick the paid coverage queue
      await tickCoverageQueue();

      // 3. Path A: organic narration from interactions
      const sinceBlock = getLastSeenBlock();
      const interactions = await fetchInteractionsSinceBlock(sinceBlock, 50);
      console.log(`[aan-tv] Fetched ${interactions.length} interactions since block ${sinceBlock}`);

      let maxBlock = sinceBlock;

      for (const interaction of interactions) {
        if (interaction.blockNumber > maxBlock) {
          maxBlock = interaction.blockNumber;
        }

        // Per-interaction dedup — skip if already narrated.
        if (alreadyProcessed(interaction.id)) {
          console.log(`[aan-tv] Skipping already-processed interaction ${interaction.id}`);
          continue;
        }

        // Self-loop guard — never narrate events where the caller is the
        // operator wallet (anti-cheat). Note: our APP_HEX being the callee IS
        // interesting (those are our own program's matches resolving).
        if (isSelfLoop({ source: interaction.caller, target: interaction.callee }, operatorHex)) {
          console.log(`[aan-tv] Skipping self-loop interaction ${interaction.id}`);
          recordFailed(interaction.id, 'self-loop: skipped');
          continue;
        }

        // Board-Sign reciprocity path. This replaces the generic cluster
        // narration for Sign so one inbound board call gets exactly one reply.
        if (isBoardSignInteraction(interaction)) {
          if (getClusterHexes().includes(interaction.caller.toLowerCase())) {
            console.log(`[aan-tv] Skipping own-cluster Board Sign ${interaction.id}`);
            recordFailed(interaction.id, 'own-cluster board sign: skipped');
            continue;
          }

          const callback = await handleBoardSignCallback(interaction);
          if (callback.handled) {
            if (callback.status === 'posted') {
              recordProcessed(interaction.id, callback.msgId ?? '', callback.txHash ?? '');
            } else if (callback.status === 'duplicate') {
              recordProcessed(interaction.id, '', '');
            } else {
              console.error('[aan-tv] Board Sign callback failed:', callback.error);
              recordFailed(interaction.id, callback.error ?? 'board sign callback failed');
            }
            continue;
          }
        }

        // Organic narration of interesting activity on known apps.
        // Per-event throttle: only narrate cluster-inbound or high-value calls.
        // Everything else is counted in the hourly digest instead.
        const kind = looksInteresting(interaction);
        if (kind) {
          const shouldNarrateNow = isClusterCallee(interaction) || isHighValue(interaction);

          if (shouldNarrateNow) {
            console.log(
              `[aan-tv] Interesting interaction (per-event): ${interaction.method ?? '?'} on ${interaction.callee.slice(0, 16)}… kind=${kind}`,
            );

            try {
              const post = await narrateInteraction(interaction, kind);
              if (post) {
                const result = await postChatAsApplication(post);
                console.log(
                  `[aan-tv] Organic narration posted: msgId=${result.msgId} kind=${kind}`,
                );
                recordProcessed(interaction.id, result.msgId, result.txHash);
              } else {
                recordFailed(interaction.id, 'no narration template matched');
              }
            } catch (err) {
              console.error('[aan-tv] Failed to post organic narration:', err);
              recordFailed(interaction.id, String(err));
            }
          } else {
            // Suppress per-event — will appear in hourly digest aggregate
            console.log(
              `[aan-tv] Interesting but suppressed (digest-only): ${interaction.callee.slice(0, 16)}… kind=${kind}`,
            );
            recordProcessed(interaction.id, '', '');
          }
        } else {
          recordFailed(interaction.id, 'not-interesting: skipped');
        }
      }

      // 4. Advance checkpoint AFTER all per-item inserts to processed_interactions.
      if (maxBlock > sinceBlock) {
        setLastSeenBlock(maxBlock);
        console.log(`[aan-tv] Checkpoint advanced to block ${maxBlock}`);
      }

      // 5. Hourly digest — fire if >= 60 min have elapsed since last post.
      const digestNow = Date.now();
      const lastDigest = getLastDigestPostedAt();
      const DIGEST_INTERVAL_MS = 60 * 60_000; // 60 minutes
      if (digestNow - lastDigest >= DIGEST_INTERVAL_MS) {
        console.log('[aan-tv] Hourly digest: building…');
        try {
          const appHex = process.env.APP_HEX ?? '';
          const digestCalleeHexes = [appHex, ...CLUSTER_HEXES_STATIC].filter(Boolean);
          const bucket = await fetchDigestData(
            { hexes: digestCalleeHexes, handles: ALLOWLIST_HANDLES },
            DIGEST_INTERVAL_MS,
          );
          const facts = buildDigestFacts(bucket);
          const post = narrateHourlyDigest(facts);
          console.log(`[aan-tv] Hourly digest body: ${post.body.slice(0, 80)}…`);
          const result = await postChatAsApplication(post);
          console.log(`[aan-tv] Hourly digest posted: msgId=${result.msgId} txHash=${result.txHash}`);
          setLastDigestPostedAt(digestNow);
        } catch (err) {
          console.error('[aan-tv] Hourly digest failed (will retry next tick):', err);
          // Do NOT update setLastDigestPostedAt — retry next poll cycle
        }
      }

      // 6. Dormant outbound integration runner — disabled by default.
      const integrationNow = Date.now();
      if (
        integrationRunnerEnabled &&
        integrationNow - lastIntegrationCycleAt >= integrationRunnerIntervalMs
      ) {
        lastIntegrationCycleAt = integrationNow;
        try {
          await runIntegrationCycle();
        } catch (err) {
          console.error('[aan-tv] Integration runner failed (will retry later):', err);
        }
      }
    } catch (err) {
      console.error('[aan-tv] Loop error (will retry):', err);
    }

    // 7. Sleep
    const elapsed = Date.now() - loopStart;
    const sleepMs = Math.max(0, opts.intervalMs - elapsed);
    console.log(`[aan-tv] Sleeping ${sleepMs}ms`);
    await new Promise<void>((r) => setTimeout(r, sleepMs));
  }
}
