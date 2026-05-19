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

import { isSelfLoop } from './self-loop-guard.js';
import {
  fetchInteractionsSinceBlock,
  fetchChainTipBlock,
  fetchCoverageQueue,
  resolveHandle,
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
} from './checkpoint.js';
import { postChatAsApplication, markCovered } from './chat.js';
import { ensureFresh } from './voucher.js';
import {
  narrateMarketResolved,
  narrateBountyCompleted,
  narrateLaunchedApp,
  narrateMatchSettled,
  narrateCustom,
  narrateActivity,
  type NarratedPost,
} from './narrator.js';

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

// NOTE: the live indexer schema does NOT expose `method` on Interaction (always null).
// We can only filter by callee, not by method. Anything matching here is narrated as
// the kind below; for the generic `Activity` kind we just say "X interacted with Y".
const INTERESTING_FILTERS: InterestingFilter[] = [
  // Our own AAN-TV program — any call to us is worth narrating
  { hex: '__OWN__',  kind: 'Activity' },
  // Our cluster apps (deployed 2026-05-19) — calls to ANY of these get covered
  { hex: '0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d', kind: 'Activity' }, // aan-tv-board
  { hex: '0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02', kind: 'Activity' }, // aan-tv-tip
  { hex: '0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c', kind: 'Activity' }, // aan-tv-data
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

function resolveHexSentinel(raw: string): string {
  if (raw === '__OWN__') return process.env.APP_HEX ?? '';
  if (raw === '__PID__') return process.env.PID ?? '';
  return raw;
}

/** Returns a display handle: pre-resolved handle or truncated hex fallback */
function displayHandle(handle: string | null, hex: string): string {
  return handle ?? hex.slice(0, 8) + '…';
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
      if (itemId > getLastSeenCoverageId()) {
        setLastSeenCoverageId(itemId);
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
      if (itemId > getLastSeenCoverageId()) {
        setLastSeenCoverageId(itemId);
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

  console.log('[aan-tv] Starting AAN-TV commentator watcher');
  console.log(`[aan-tv] APP_HEX: ${appHex}`);
  console.log(`[aan-tv] OPERATOR_HEX: ${operatorHex}`);
  console.log(`[aan-tv] Poll interval: ${opts.intervalMs}ms`);

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

        // Organic narration of interesting activity on known apps
        const kind = looksInteresting(interaction);
        if (kind) {
          console.log(
            `[aan-tv] Interesting interaction: ${interaction.method ?? '?'} on ${interaction.callee.slice(0, 16)}… kind=${kind}`,
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
          recordFailed(interaction.id, 'not-interesting: skipped');
        }
      }

      // 4. Advance checkpoint AFTER all per-item inserts to processed_interactions.
      if (maxBlock > sinceBlock) {
        setLastSeenBlock(maxBlock);
        console.log(`[aan-tv] Checkpoint advanced to block ${maxBlock}`);
      }
    } catch (err) {
      console.error('[aan-tv] Loop error (will retry):', err);
    }

    // 5. Sleep
    const elapsed = Date.now() - loopStart;
    const sleepMs = Math.max(0, opts.intervalMs - elapsed);
    console.log(`[aan-tv] Sleeping ${sleepMs}ms`);
    await new Promise<void>((r) => setTimeout(r, sleepMs));
  }
}
