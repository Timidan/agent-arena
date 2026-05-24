import 'dotenv/config';
import { execFile as _execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getDailySpendSnapshot, getLastSeenBlock } from './checkpoint.js';
import { fetchAppMetric, fetchChainTipBlock } from './indexer.js';

const execFile = promisify(_execFile);

type CheckStatus = 'ok' | 'warn' | 'fail';

interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  data?: Record<string, string | number | boolean | null>;
}

const checks: HealthCheck[] = [];

function addCheck(check: HealthCheck): void {
  checks.push(check);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkRequiredEnv(): void {
  const required = [
    'PID',
    'APP_HEX',
    'OPERATOR_HEX',
    'INDEXER_GRAPHQL_URL',
    'VOUCHER_URL',
    'ACCT',
    'IDL',
    'NETWORK_IDL',
  ] as const;
  const missing = required.filter((key) => !process.env[key]);

  addCheck({
    name: 'env.required',
    status: missing.length === 0 ? 'ok' : 'fail',
    detail: missing.length === 0 ? 'required env vars are present' : `missing: ${missing.join(', ')}`,
    data: { missingCount: missing.length },
  });
}

function checkLimitEnv(): void {
  const countLimitVars = [
    'MAX_DAILY_CHAT_POSTS',
    'MAX_DAILY_MARK_COVERED_CALLS',
    'MAX_DAILY_PARTNER_CALLS',
    'MAX_DAILY_MISSION_VERIFIER_CALLS',
  ];
  const rawAmountVars = [
    'MAX_DAILY_SPEND_RAW',
    'CHAT_POST_ESTIMATED_SPEND_RAW',
    'MARK_COVERED_ESTIMATED_SPEND_RAW',
    'PARTNER_CALL_ESTIMATED_SPEND_RAW',
    'MISSION_VERIFIER_ESTIMATED_SPEND_RAW',
  ];

  const errors: string[] = [];
  for (const key of countLimitVars) {
    const raw = process.env[key];
    if (raw == null || raw === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < -1) errors.push(`${key}=${raw}`);
  }

  for (const key of rawAmountVars) {
    const raw = process.env[key];
    if (raw == null || raw === '') continue;
    try {
      if (BigInt(raw) < 0n) errors.push(`${key}=${raw}`);
    } catch {
      errors.push(`${key}=${raw}`);
    }
  }

  addCheck({
    name: 'env.safetyCaps',
    status: errors.length === 0 ? 'ok' : 'fail',
    detail: errors.length === 0 ? 'safety cap env vars are valid' : `invalid values: ${errors.join(', ')}`,
    data: {
      partnerCallsEnabled: process.env.BOARD_PARTNER_CALLBACKS_ENABLED === 'true',
      integrationRunnerEnabled: process.env.INTEGRATION_RUNNER_ENABLED === 'true',
      missionVerifierEnabled: process.env.MISSION_VERIFIER_ENABLED === 'true',
      missionVerifierApprovalsEnabled: process.env.MISSION_VERIFIER_APPROVALS_ENABLED === 'true',
    },
  });
}

function checkMissionVerifierEnv(): void {
  const enabled = envBool('MISSION_VERIFIER_ENABLED', false);
  const approvalsEnabled = envBool('MISSION_VERIFIER_APPROVALS_ENABLED', false);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (enabled) {
    for (const key of ['MISSION_PROGRAM_HEX', 'MISSION_IDL'] as const) {
      if (!process.env[key]) errors.push(`missing ${key}`);
    }

    if (process.env.MISSION_IDL && !existsSync(process.env.MISSION_IDL)) {
      errors.push(`MISSION_IDL not found: ${process.env.MISSION_IDL}`);
    }
  }

  if (approvalsEnabled && !enabled) {
    warnings.push('approvals enabled but verifier disabled');
  }

  const rawApprovalCap = process.env.MAX_DAILY_MISSION_VERIFIER_CALLS ?? '0';
  const approvalCap = Number(rawApprovalCap);
  if (approvalsEnabled && Number.isFinite(approvalCap) && approvalCap === 0) {
    errors.push('approval writes enabled but MAX_DAILY_MISSION_VERIFIER_CALLS=0');
  }

  addCheck({
    name: 'env.missionVerifier',
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'ok',
    detail:
      errors.length > 0
        ? errors.join(', ')
        : warnings.length > 0
          ? warnings.join(', ')
          : enabled
            ? 'mission verifier env is valid'
            : 'mission verifier disabled',
    data: { enabled, approvalsEnabled },
  });
}

function checkCheckpoint(): void {
  try {
    const spend = getDailySpendSnapshot();
    addCheck({
      name: 'checkpoint.dailySpend',
      status: 'ok',
      detail: `daily spend ledger loaded for ${spend.day}`,
      data: {
        day: spend.day,
        chatPosts: spend.chatPosts,
        markCoveredCalls: spend.markCoveredCalls,
        partnerCalls: spend.partnerCalls,
        missionVerifierCalls: spend.missionVerifierCalls,
        estimatedSpendRaw: spend.estimatedSpendRaw.toString(),
      },
    });
  } catch (err) {
    addCheck({
      name: 'checkpoint.dailySpend',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function checkIndexer(timeoutMs: number): Promise<void> {
  let tip: number;
  try {
    tip = await withTimeout(fetchChainTipBlock(), timeoutMs, 'indexer chain tip query');
    addCheck({
      name: 'indexer.chainTip',
      status: 'ok',
      detail: `indexer reachable at block ${tip}`,
      data: { tip },
    });
  } catch (err) {
    addCheck({
      name: 'indexer.chainTip',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const lastSeen = getLastSeenBlock();
    const lagBlocks = Math.max(0, tip - lastSeen);
    const maxLagBlocks = envNumber('HEALTHCHECK_MAX_LAG_BLOCKS', 2400);
    const checkpointStarted = lastSeen > 0;
    const stale = checkpointStarted && lagBlocks > maxLagBlocks;
    const detail = !checkpointStarted
      ? 'checkpoint has not been seeded yet'
      : stale
        ? `checkpoint is ${lagBlocks} blocks behind tip`
        : `checkpoint lag is ${lagBlocks} blocks`;

    addCheck({
      name: 'checkpoint.lag',
      status: stale ? 'warn' : 'ok',
      detail,
      data: { tip, lastSeen, lagBlocks, maxLagBlocks },
    });
  } catch (err) {
    addCheck({
      name: 'checkpoint.lag',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function checkAppMetric(timeoutMs: number): Promise<void> {
  const appHex = process.env.APP_HEX;
  if (!appHex) return;

  try {
    const metric = await withTimeout(fetchAppMetric(appHex), timeoutMs, 'app metric query');
    if (!metric) {
      addCheck({
        name: 'indexer.appMetric',
        status: 'warn',
        detail: 'no appMetric record found for APP_HEX',
      });
      return;
    }

    addCheck({
      name: 'indexer.appMetric',
      status: 'ok',
      detail: 'appMetric record found',
      data: {
        messagesSent: metric.messagesSent,
        mentionCount: metric.mentionCount,
        integrationsIn: metric.integrationsIn,
        integrationsOut: metric.integrationsOut,
        postsActive: metric.postsActive,
      },
    });
  } catch (err) {
    addCheck({
      name: 'indexer.appMetric',
      status: 'warn',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export function parseVaraBalance(output: string): number | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed && typeof parsed === 'object' && 'balance' in parsed) {
      const balance = (parsed as { balance?: unknown }).balance;
      const value = typeof balance === 'number' ? balance : typeof balance === 'string' ? Number(balance) : NaN;
      return Number.isFinite(value) ? value : null;
    }
  } catch {
    // Non-JSON human output is handled below.
  }

  const match =
    output.match(/([0-9]+(?:\.[0-9]+)?)\s*VARA/i) ??
    output.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function checkWalletBalance(timeoutMs: number): Promise<void> {
  if (!envBool('HEALTHCHECK_WALLET', true)) return;
  const operatorHex = process.env.OPERATOR_HEX;
  if (!operatorHex) return;

  try {
    const { stdout } = await execFile(
      'vara-wallet',
      ['--network', process.env.VARA_NETWORK ?? 'mainnet', 'balance', operatorHex],
      { timeout: timeoutMs },
    );
    const balance = parseVaraBalance(stdout);
    const minBalance = envNumber('MIN_WALLET_BALANCE_VARA', 0);
    const belowMin = balance != null && minBalance > 0 && balance < minBalance;

    addCheck({
      name: 'wallet.balance',
      status: belowMin ? 'warn' : 'ok',
      detail: balance == null ? stdout.trim().slice(0, 160) : `${balance} VARA`,
      data: { balanceVara: balance, minBalanceVara: minBalance },
    });
  } catch (err) {
    addCheck({
      name: 'wallet.balance',
      status: 'warn',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  const timeoutMs = envNumber('HEALTHCHECK_TIMEOUT_MS', 10_000);

  checkRequiredEnv();
  checkLimitEnv();
  checkMissionVerifierEnv();
  checkCheckpoint();
  await checkIndexer(timeoutMs);
  await checkAppMetric(timeoutMs);
  await checkWalletBalance(timeoutMs);

  const hasFail = checks.some((check) => check.status === 'fail');
  const hasWarn = checks.some((check) => check.status === 'warn');
  const status: CheckStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok';

  console.log(JSON.stringify({ status, checkedAt: new Date().toISOString(), checks }, null, 2));

  if (hasFail || (hasWarn && envBool('HEALTHCHECK_STRICT', false))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(JSON.stringify({
      status: 'fail',
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  });
}
