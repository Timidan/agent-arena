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

const execFile = promisify(_execFile);

// ── rate-limit tracker ────────────────────────────────────────────────────

let lastChatPostMs = 0;
const RATE_LIMIT_GAP_MS = 5500;

async function enforceRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastChatPostMs;
  if (elapsed < RATE_LIMIT_GAP_MS) {
    await new Promise<void>((r) => setTimeout(r, RATE_LIMIT_GAP_MS - elapsed));
  }
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

export async function postChatAsApplication(args: {
  body: string;
  mentions: ChatMention[];
}): Promise<PostResult> {
  await enforceRateLimit();

  const pid = requireEnv('PID');
  const appHex = requireEnv('APP_HEX');
  const acct = requireEnv('ACCT');
  const voucherNetwork = process.env.VARA_NETWORK ?? 'mainnet';
  const voucherId = process.env.VOUCHER_ID ?? '';
  const networkIdl = requireEnv('NETWORK_IDL');

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
      ...(voucherId ? ['--voucher', voucherId] : []),
    ];

    const { stdout } = await execFile('vara-wallet', varaArgs, { timeout: 60_000 });

    lastChatPostMs = Date.now();

    // Parse response: vara-wallet --json wraps in {"result": ...}
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON: ${stdout.slice(0, 200)}`);
    }

    const txHash = (parsed['txHash'] as string | undefined) ?? '';
    // Chat/Post returns the message id in .result
    const msgId = String((parsed['result'] as string | number | undefined) ?? '0');

    return { msgId, txHash };
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

// ── markCovered ───────────────────────────────────────────────────────────

export async function markCovered(
  coverageId: bigint,
  chatMsgId: bigint,
): Promise<void> {
  const appHex = requireEnv('APP_HEX');
  const acct = requireEnv('ACCT');
  const voucherNetwork = process.env.VARA_NETWORK ?? 'mainnet';
  const voucherId = process.env.VOUCHER_ID ?? '';
  // Our program IDL (Sails), not the network IDL
  const idl = requireEnv('IDL');

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
      ...(voucherId ? ['--voucher', voucherId] : []),
    ];

    const { stdout } = await execFile('vara-wallet', varaArgs, { timeout: 60_000 });

    // Check for errors in the response
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON for MarkCovered: ${stdout.slice(0, 200)}`);
    }

    const programMessage = parsed['programMessage'];
    if (programMessage && programMessage !== null) {
      throw new Error(`MarkCovered failed: ${JSON.stringify(programMessage)}`);
    }
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
