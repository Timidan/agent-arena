/**
 * Main watcher loop for AAN-TV commentator bot.
 *
 * Every POLL_INTERVAL_MS:
 *   1. Refresh voucher if stale
 *   2. Fetch interactions since last seen block
 *   3. For each interaction:
 *      a. Skip self-loops (source or target == OPERATOR_HEX)
 *      b. If RequestCoverage on our APP_HEX → narrate + markCovered
 *      c. If looks-interesting → route to appropriate narrator + post
 *   4. Advance lastSeenBlock checkpoint
 *   5. Sleep POLL_INTERVAL_MS
 *
 * Rate-limit: Chat/Post enforces 5s per author. The chat.ts module tracks
 *   lastChatPostMs and waits. We do not need a separate tracker here.
 */

import { isSelfLoop } from './self-loop-guard.js';
import {
  fetchInteractionsSinceBlock,
  resolveHandle,
  decodeRequestCoverageArgs,
  type Interaction,
} from './indexer.js';
import { getLastSeenBlock, setLastSeenBlock } from './checkpoint.js';
import { postChatAsApplication, markCovered } from './chat.js';
import { refreshVoucher } from './voucher.js';
import {
  narrateMarketResolved,
  narrateBountyCompleted,
  narrateLaunchedApp,
  narrateMatchSettled,
  narrateCustom,
  type NarratedPost,
} from './narrator.js';

// ── interesting-event allowlist ─────────────────────────────────────────────
//
// Format: { toApplicationId: string | '__OWN__', methodName: string | string[], kind: NarrationKind }
// __OWN__ is resolved at runtime to APP_HEX.
// __PID__ is resolved at runtime to PID (Vara A2A network program).

type NarrationKind =
  | 'MatchSettled'
  | 'MarketResolved'
  | 'BountyCompleted'
  | 'LaunchedApp';

interface InterestingFilter {
  toApplicationId: string;
  methodNames: string[];
  kind: NarrationKind;
}

const INTERESTING_FILTERS: InterestingFilter[] = [
  // Our own AAN-TV dice match resolutions
  {
    toApplicationId: '__OWN__',
    methodNames: ['Resolve'],
    kind: 'MatchSettled',
  },
  // Infinite Bounty v3 approvals / work submissions
  {
    toApplicationId: '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8',
    methodNames: ['Approve', 'SubmitWork'],
    kind: 'BountyCompleted',
  },
  // Zeeast casino notable methods
  {
    toApplicationId: '0xb0b4312511d336db3c625a172b5c7da883d289efdf68648a79869f7b80da7a53',
    methodNames: ['Play', 'Spin'],
    kind: 'MatchSettled', // casino matches treated as 1v1 for template purposes
  },
  // Vara A2A network — new app launches via RegisterApplication
  {
    toApplicationId: '__PID__',
    methodNames: ['RegisterApplication'],
    kind: 'LaunchedApp',
  },
];

function resolveFilterId(raw: string): string {
  if (raw === '__OWN__') return process.env.APP_HEX ?? '';
  if (raw === '__PID__') return process.env.PID ?? '';
  return raw;
}

function looksInteresting(i: Interaction): NarrationKind | null {
  for (const f of INTERESTING_FILTERS) {
    const resolvedId = resolveFilterId(f.toApplicationId);
    if (!resolvedId) continue;
    if (
      i.toApplicationId.toLowerCase() === resolvedId.toLowerCase() &&
      f.methodNames.includes(i.methodName)
    ) {
      return f.kind;
    }
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

  const fromHandle = await resolveHandle(interaction.fromActor);
  const toHandle = await resolveHandle(interaction.toApplicationId);

  switch (kind) {
    case 'MatchSettled': {
      // We don't have rich outcome data from the indexer interaction — use
      // fromActor as player and toApplicationId as app; treat as Winner outcome
      // with generic names when we can't resolve both players.
      return narrateMatchSettled({
        event_id: eventId,
        winnerHandle: fromHandle ?? interaction.fromActor.slice(0, 12) + '…',
        loserHandle: toHandle ?? interaction.toApplicationId.slice(0, 12) + '…',
        winnerHex: interaction.fromActor,
        loserHex: interaction.toApplicationId,
        potVara: '?',
        outcomeKind: 'Winner',
      });
    }

    case 'MarketResolved': {
      return narrateMarketResolved({
        event_id: eventId,
        marketHandle: toHandle ?? interaction.toApplicationId.slice(0, 12) + '…',
        marketHex: interaction.toApplicationId,
        resolvedTo: '?',
        potVara: '?',
      });
    }

    case 'BountyCompleted': {
      return narrateBountyCompleted({
        event_id: eventId,
        bountyHandle: toHandle ?? interaction.toApplicationId.slice(0, 12) + '…',
        bountyHex: interaction.toApplicationId,
        claimerHandle: fromHandle ?? interaction.fromActor.slice(0, 12) + '…',
        claimerHex: interaction.fromActor,
        rewardVara: '?',
      });
    }

    case 'LaunchedApp': {
      // For RegisterApplication, fromActor is the registering operator, not the app hex.
      // argsJson may contain the program_id. Attempt to decode it defensively.
      let appHex = interaction.fromActor;
      let appHandle = fromHandle;

      if (interaction.argsJson) {
        try {
          const parsed = JSON.parse(interaction.argsJson) as unknown;
          if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
            // First arg is typically program_id for RegisterApplication
            appHex = parsed[0] as string;
            appHandle = await resolveHandle(appHex);
          }
        } catch {
          // defensive fallback — use fromActor
        }
      }

      return narrateLaunchedApp({
        event_id: eventId,
        appHandle: appHandle ?? appHex.slice(0, 12) + '…',
        appHex,
        track: 'Unknown',
      });
    }

    default:
      return null;
  }
}

// ── main loop ───────────────────────────────────────────────────────────────

export async function runWatcher(opts: { intervalMs: number }): Promise<never> {
  const operatorHex = process.env.OPERATOR_HEX ?? '';
  const appHex = process.env.APP_HEX ?? '';

  console.log('[watcher] Starting AAN-TV commentator watcher');
  console.log(`[watcher] APP_HEX: ${appHex}`);
  console.log(`[watcher] OPERATOR_HEX: ${operatorHex}`);
  console.log(`[watcher] Poll interval: ${opts.intervalMs}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const loopStart = Date.now();

    try {
      // 1. Refresh voucher
      try {
        const voucherId = await refreshVoucher();
        console.log(`[watcher] Voucher OK: ${voucherId.slice(0, 16)}…`);
      } catch (err) {
        console.error('[watcher] Voucher refresh failed (continuing):', err);
      }

      // 2. Fetch interactions since last seen block
      const sinceBlock = getLastSeenBlock();
      const interactions = await fetchInteractionsSinceBlock(sinceBlock, 50);
      console.log(`[watcher] Fetched ${interactions.length} interactions since block ${sinceBlock}`);

      let maxBlock = sinceBlock;

      for (const interaction of interactions) {
        if (interaction.blockNumber > maxBlock) {
          maxBlock = interaction.blockNumber;
        }

        // 3a. Self-loop guard — never narrate events touching operator wallet
        if (
          isSelfLoop(
            { source: interaction.fromActor, target: interaction.toApplicationId },
            operatorHex,
          )
        ) {
          console.log(`[watcher] Skipping self-loop interaction ${interaction.id}`);
          continue;
        }

        // 3b. Paid coverage requests on our program
        if (
          interaction.methodName === 'RequestCoverage' &&
          interaction.toApplicationId.toLowerCase() === appHex.toLowerCase()
        ) {
          console.log(`[watcher] Coverage request from ${interaction.fromActor}`);

          const { eventKind, targetProgram, hint } = decodeRequestCoverageArgs(
            interaction.argsJson,
          );

          const requesterHandle = await resolveHandle(interaction.fromActor);
          const targetHandle = targetProgram ? await resolveHandle(targetProgram) : undefined;

          const post = narrateCustom({
            requesterHandle: requesterHandle ?? interaction.fromActor.slice(0, 12) + '…',
            hint,
            targetHandle: targetHandle ?? undefined,
            requesterHex: interaction.fromActor,
            targetHex: targetProgram ?? undefined,
          });

          console.log(`[watcher] Posting coverage narration: ${post.body.slice(0, 60)}…`);

          try {
            const result = await postChatAsApplication(post);
            console.log(`[watcher] Chat posted: msgId=${result.msgId} txHash=${result.txHash}`);

            // Derive coverage_id from the interaction: argsJson may not directly
            // contain it (it's the return value of RequestCoverage). We use a
            // best-effort approach: if the indexer includes a coverage_id in a
            // result field we can parse it; otherwise we skip markCovered and
            // log a warning. This is a known limitation — full coverage_id
            // tracking requires a Sails typed read (GetCoverageQueue) which is
            // deferred to post-MVP integration.
            console.log(
              '[watcher] NOTE: coverage_id not available from interaction argsJson alone.' +
                ' MarkCovered skipped for this interaction — see indexer.ts comment.' +
                ` eventKind=${eventKind} hint="${hint}"`,
            );
          } catch (err) {
            console.error('[watcher] Failed to post coverage narration:', err);
          }

          continue;
        }

        // 3c. Organic narration of interesting activity on other apps
        const kind = looksInteresting(interaction);
        if (kind) {
          console.log(
            `[watcher] Interesting interaction: ${interaction.methodName} on ${interaction.toApplicationId.slice(0, 16)}… kind=${kind}`,
          );

          try {
            const post = await narrateInteraction(interaction, kind);
            if (post) {
              const result = await postChatAsApplication(post);
              console.log(
                `[watcher] Organic narration posted: msgId=${result.msgId} kind=${kind}`,
              );
            }
          } catch (err) {
            console.error('[watcher] Failed to post organic narration:', err);
          }
        }
      }

      // 4. Advance checkpoint
      if (maxBlock > sinceBlock) {
        setLastSeenBlock(maxBlock);
        console.log(`[watcher] Checkpoint advanced to block ${maxBlock}`);
      }
    } catch (err) {
      console.error('[watcher] Loop error (will retry):', err);
    }

    // 5. Sleep
    const elapsed = Date.now() - loopStart;
    const sleepMs = Math.max(0, opts.intervalMs - elapsed);
    console.log(`[watcher] Sleeping ${sleepMs}ms`);
    await new Promise<void>((r) => setTimeout(r, sleepMs));
  }
}
