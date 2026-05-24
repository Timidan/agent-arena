/**
 * Chat/Post and MarkCovered wrappers.
 *
 * postChatAsApplication — spawns vara-wallet to post as Application (MUST be
 *   Application for messagesSent credit, per agent-chat.md "Chat-specific rules").
 *
 * markCovered — calls AanTv/MarkCovered on our own program to record the
 *   chat message ID permanently on-chain.
 *
 * Rate limit: Chat/Post enforces 5s per author. We track lastChatPostMs and
 *   wait if < 5500ms have elapsed.
 */

import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { reserveChatPostBudget, reserveMarkCoveredBudget } from './spend-guard.js';

const execFile = promisify(_execFile);

// ── executor abstraction ───────────────────────────────────────────────────
//
// We use a dependency-injection pattern instead of vi.mock('node:child_process')
// because mocking ESM child_process internals via vitest is brittle with
// nodenext module resolution. Tests inject a mock executor directly.
// Production code uses the default (spawnVaraWallet).

/** Minimal shape of execFile output the caller cares about. */
export interface ExecResult {
  stdout: string;
}

/** Signature of the executor callback injected into post/mark functions. */
export type Executor = (command: string, args: string[], opts: { timeout: number }) => Promise<ExecResult>;

const defaultExecutor: Executor = async (command, args, opts) => {
  return execFile(command, args, opts);
};

// ── rate-limit tracker ────────────────────────────────────────────────────

let lastChatPostMs = 0;
const RATE_LIMIT_GAP_MS = 5500;

async function enforceRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastChatPostMs;
  if (elapsed < RATE_LIMIT_GAP_MS) {
    await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_GAP_MS - elapsed));
  }
}

/** Reset rate-limit state. For use in tests only. */
export function _resetRateLimitForTesting(): void {
  lastChatPostMs = 0;
}

// ── env helpers ───────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// ── postChatAsApplication ─────────────────────────────────────────────────

export interface ChatMention {
  kind: 'Participant' | 'Application';
  hex: string;
}

export interface PostResult {
  msgId: string;
  txHash: string;
}

export async function postChatAsApplication(
  args: { body: string; mentions: ChatMention[] },
  executor: Executor = defaultExecutor,
): Promise<PostResult> {
  await enforceRateLimit();

  const pid = requireEnv('PID');
  const appHex = requireEnv('APP_HEX');
  const acct = requireEnv('ACCT');
  const voucherNetwork = process.env.VARA_NETWORK ?? 'mainnet';
  const networkIdl = requireEnv('NETWORK_IDL');

  // Guard: VOUCHER_ID must be set before issuing writes — if not, crash early
  // rather than letting the call fail silently with a cryptic chain error.
  const voucherId = process.env.VOUCHER_ID;
  if (!voucherId) {
    throw new Error('VOUCHER_ID is not set — run ensureFresh() before posting');
  }

  reserveChatPostBudget();

  // Author MUST be Application for messagesSent credit
  const author = { Application: appHex };

  // Cap mentions at 8 (contract panics on > max_mentions_per_post)
  const mentionsPayload = args.mentions.slice(0, 8).map((m) =>
    m.kind === 'Application' ? { Application: m.hex } : { Participant: m.hex },
  );

  const callArgs = [args.body, author, mentionsPayload, null];

  // Write args to a temp file to avoid shell-escape pain
  const tmpPath = join(tmpdir(), `aan-tv-chat-${randomBytes(8).toString('hex')}.json`);
  await writeFile(tmpPath, JSON.stringify(callArgs), 'utf8');

  try {
    const varaArgs = [
      '--account', acct,
      '--network', voucherNetwork,
      '--json',
      'call',
      pid,
      'Chat/Post',
      '--args-file', tmpPath,
      '--idl', networkIdl,
      '--voucher', voucherId,
    ];

    const { stdout } = await executor('vara-wallet', varaArgs, { timeout: 60_000 });

    lastChatPostMs = Date.now();

    // Parse response: vara-wallet --json wraps every response in {"result": ...}
    // (universal wire-format rule #4 from SKILL.md)
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON: ${stdout.slice(0, 200)}`);
    }

    // Check for contract panics (RateLimited, Unauthorized, TooManyMentions, etc.)
    // programMessage is non-null when the contract panicked — mirror the pattern
    // already used in markCovered (see below).
    const programMessage = parsed['programMessage'];
    if (programMessage != null) {
      throw new Error(`Chat/Post panicked: ${JSON.stringify(programMessage)}`);
    }

    // Chat/Post returns the new message id in .result (e.g. "32").
    // null result means the call landed but the contract returned void — unexpected.
    if (parsed['result'] == null || parsed['result'] === 'null') {
      throw new Error(`Chat/Post returned null result (expected msg id)`);
    }

    const txHash = (parsed['txHash'] as string | undefined) ?? '';
    const msgId = String(parsed['result'] as string | number);

    return { msgId, txHash };
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

// ── markCovered ───────────────────────────────────────────────────────────

export async function markCovered(
  coverageId: bigint,
  chatMsgId: bigint,
  executor: Executor = defaultExecutor,
): Promise<void> {
  const appHex = requireEnv('APP_HEX');
  const acct = requireEnv('ACCT');
  const voucherNetwork = process.env.VARA_NETWORK ?? 'mainnet';
  // Our program IDL (Sails), not the network IDL
  const idl = requireEnv('IDL');

  // The shared hackathon voucher is scoped to the network program (PID) for
  // Chat/Post. MarkCovered writes to our own AAN-TV program, so only attach a
  // voucher when an app-specific one is explicitly configured.
  const voucherId = process.env.MARK_COVERED_VOUCHER_ID;

  reserveMarkCoveredBudget();

  // MarkCovered(coverage_id: u64, chat_msg_id: u64)
  const callArgs = [String(coverageId), String(chatMsgId)];

  const tmpPath = join(tmpdir(), `aan-tv-mark-${randomBytes(8).toString('hex')}.json`);
  await writeFile(tmpPath, JSON.stringify(callArgs), 'utf8');

  try {
    const varaArgs = [
      '--account', acct,
      '--network', voucherNetwork,
      '--json',
      'call',
      appHex,
      'AanTv/MarkCovered',
      '--args-file', tmpPath,
      '--idl', idl,
    ];

    if (voucherId) {
      varaArgs.push('--voucher', voucherId);
    }

    const { stdout } = await executor('vara-wallet', varaArgs, { timeout: 60_000 });

    // Check for errors in the response
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON for MarkCovered: ${stdout.slice(0, 200)}`);
    }

    const programMessage = parsed['programMessage'];
    if (programMessage != null) {
      throw new Error(`MarkCovered failed: ${JSON.stringify(programMessage)}`);
    }
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
