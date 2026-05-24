/**
 * Dormant outbound integration runner for AAN-TV Phase 1.
 *
 * Enabled only with INTEGRATION_RUNNER_ENABLED=true. Calls are wallet-signed
 * gas-only/free reads against external partner programs; no voucher is used.
 */

import { execFile as _execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { fetchApplicationInfo, fetchChainTipBlock } from './indexer.js';
import {
  getIntegrationPartnerState,
  recordIntegrationPartnerAttempt,
  type IntegrationPartnerState,
} from './checkpoint.js';
import { PARTNER_CALLS, type PartnerCall } from './partner-registry.js';
import { reservePartnerCallBudget } from './spend-guard.js';

const execFile = promisify(_execFile);

const OPERATOR_HEX = '0xc292ca129fadeb52f0c047274dbb7a8eabc49f0bcfae9857bc1ef2b1bd482b10';
const AAN_TV_BOARD_HEX = '0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d';
const AAN_TV_TIP_HEX = '0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02';
const AAN_TV_DATA_HEX = '0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c';

export interface PartnerCallAttempt {
  key: string;
  handle: string;
  method: string;
  status: 'ok' | 'failed' | 'dry_run' | 'skipped';
  txHash?: string;
  error?: string;
}

export interface IntegrationCycleSummary {
  cycle_id: string;
  partners_called: PartnerCallAttempt[];
  partners_skipped: Array<{ key: string; handle: string; reason: string }>;
  errors: Array<{ key: string; handle: string; error: string }>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function isEnabled(): boolean {
  return process.env.INTEGRATION_RUNNER_ENABLED === 'true';
}

function isDryRun(): boolean {
  return process.env.INTEGRATION_RUNNER_DRY_RUN === 'true' || process.env.DRY_RUN === 'true';
}

function lower(value: string | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

function ownHexSet(): Set<string> {
  return new Set(
    [
      OPERATOR_HEX,
      process.env.OPERATOR_HEX,
      process.env.APP_HEX,
      AAN_TV_BOARD_HEX,
      AAN_TV_TIP_HEX,
      AAN_TV_DATA_HEX,
    ]
      .map(lower)
      .filter((v): v is string => v != null),
  );
}

function buildArgs(partner: PartnerCall): unknown[] | null {
  if (partner.args == null) return null;
  return typeof partner.args === 'function' ? partner.args() : partner.args;
}

async function skipReasonForPartner(partner: PartnerCall): Promise<string | null> {
  const ownHexes = ownHexSet();
  if (ownHexes.has(partner.programId.toLowerCase())) {
    return 'own-cluster-program';
  }

  const info = await fetchApplicationInfo(partner.programId);
  if (info?.operator && ownHexes.has(info.operator.toLowerCase())) {
    return 'owned-by-operator';
  }

  return null;
}

function commandFor(partner: PartnerCall, argsFile: string | null): string[] {
  const acct = requireEnv('ACCT');
  const network = process.env.VARA_NETWORK ?? 'mainnet';
  const gasLimit = process.env.INTEGRATION_RUNNER_GAS_LIMIT ?? '8000000000';

  const varaArgs = [
    '--account', acct,
    '--network', network,
    '--json',
    'call',
    partner.programId,
    partner.method,
    '--gas-limit', gasLimit,
  ];

  if (argsFile) varaArgs.push('--args-file', argsFile);
  if (partner.idl) varaArgs.push('--idl', partner.idl);

  return varaArgs;
}

async function executePartnerCall(partner: PartnerCall): Promise<{ txHash: string }> {
  const callArgs = buildArgs(partner);
  const tmpPath =
    callArgs == null
      ? null
      : join(tmpdir(), `aan-tv-integration-${randomBytes(8).toString('hex')}.json`);

  if (tmpPath) {
    await writeFile(tmpPath, JSON.stringify(callArgs), 'utf8');
  }

  try {
    const varaArgs = commandFor(partner, tmpPath);

    if (isDryRun()) {
      console.log(
        JSON.stringify({
          kind: 'aan_tv_integration_dry_run',
          command: 'vara-wallet',
          args: varaArgs,
          partner: partner.key,
          call_args: callArgs,
        }),
      );
      return { txHash: 'dry-run' };
    }

    reservePartnerCallBudget();

    const { stdout } = await execFile('vara-wallet', varaArgs, { timeout: 60_000 });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON: ${stdout.slice(0, 200)}`);
    }

    const programMessage = parsed['programMessage'];
    if (programMessage != null) {
      throw new Error(`partner call panicked: ${JSON.stringify(programMessage)}`);
    }

    return { txHash: (parsed['txHash'] as string | undefined) ?? '' };
  } finally {
    if (tmpPath) await unlink(tmpPath).catch(() => undefined);
  }
}

async function attemptPartnerCall(
  partner: PartnerCall,
  blockNumber: number,
): Promise<PartnerCallAttempt> {
  const skipReason = await skipReasonForPartner(partner);
  if (skipReason) {
    recordIntegrationPartnerAttempt(partner.key, blockNumber, 'skipped', skipReason);
    return {
      key: partner.key,
      handle: partner.handle,
      method: partner.method,
      status: 'skipped',
      error: skipReason,
    };
  }

  try {
    const result = await executePartnerCall(partner);
    const status = isDryRun() ? 'dry_run' : 'ok';
    recordIntegrationPartnerAttempt(partner.key, blockNumber, status);
    return {
      key: partner.key,
      handle: partner.handle,
      method: partner.method,
      status,
      txHash: result.txHash,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordIntegrationPartnerAttempt(partner.key, blockNumber, 'failed', error);
    return {
      key: partner.key,
      handle: partner.handle,
      method: partner.method,
      status: 'failed',
      error,
    };
  }
}

function wasSuccessful(status: string | null): boolean {
  return status === 'ok' || status === 'dry_run';
}

function eligiblePartner(
  partner: PartnerCall,
  state: IntegrationPartnerState,
  nowMs: number,
): { eligible: boolean; reason?: string } {
  if (partner.runOnce && wasSuccessful(state.lastStatus)) {
    return { eligible: false, reason: 'run-once-already-attempted' };
  }

  if (wasSuccessful(state.lastStatus)) {
    const elapsedMs = nowMs - state.lastCalledAtMs;
    if (elapsedMs < partner.minIntervalMs) {
      return { eligible: false, reason: 'cooldown' };
    }
  }

  return { eligible: true };
}

export function findPartnerCallForProgram(programId: string): PartnerCall | null {
  const target = programId.toLowerCase();
  return PARTNER_CALLS.find((partner) => partner.programId.toLowerCase() === target) ?? null;
}

export async function callRegisteredPartner(programId: string): Promise<PartnerCallAttempt | null> {
  const partner = findPartnerCallForProgram(programId);
  if (!partner) return null;

  const state = getIntegrationPartnerState(partner.key);
  if (partner.runOnce && wasSuccessful(state.lastStatus)) {
    return {
      key: partner.key,
      handle: partner.handle,
      method: partner.method,
      status: 'skipped',
      error: 'run-once-already-attempted',
    };
  }

  const blockNumber = await fetchChainTipBlock();
  return attemptPartnerCall(partner, blockNumber);
}

export async function runIntegrationCycle(limit = 6): Promise<IntegrationCycleSummary | null> {
  if (!isEnabled()) return null;

  const cycleId = `${new Date().toISOString()}-${randomBytes(4).toString('hex')}`;
  const nowMs = Date.now();
  const partnersSkipped: IntegrationCycleSummary['partners_skipped'] = [];
  const errors: IntegrationCycleSummary['errors'] = [];
  const eligible = PARTNER_CALLS
    .map((partner) => ({ partner, state: getIntegrationPartnerState(partner.key) }))
    .filter(({ partner, state }) => {
      const result = eligiblePartner(partner, state, nowMs);
      if (!result.eligible) {
        partnersSkipped.push({
          key: partner.key,
          handle: partner.handle,
          reason: result.reason ?? 'not-eligible',
        });
      }
      return result.eligible;
    })
    .sort((a, b) => {
      const byBlock = a.state.lastCalledAtBlock - b.state.lastCalledAtBlock;
      if (byBlock !== 0) return byBlock;
      return a.state.lastCalledAtMs - b.state.lastCalledAtMs;
    })
    .slice(0, limit);

  let blockNumber: number;
  try {
    blockNumber = await fetchChainTipBlock();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const summary = {
      cycle_id: cycleId,
      partners_called: [],
      partners_skipped: partnersSkipped,
      errors: [{ key: 'indexer:fetchChainTipBlock', handle: 'indexer', error }],
    };
    console.log(JSON.stringify(summary));
    return summary;
  }

  const partnersCalled: PartnerCallAttempt[] = [];

  for (const { partner } of eligible) {
    const attempt = await attemptPartnerCall(partner, blockNumber);
    if (attempt.status === 'skipped') {
      partnersSkipped.push({
        key: attempt.key,
        handle: attempt.handle,
        reason: attempt.error ?? 'skipped',
      });
    } else {
      partnersCalled.push(attempt);
    }
    if (attempt.status === 'failed') {
      errors.push({
        key: attempt.key,
        handle: attempt.handle,
        error: attempt.error ?? 'unknown error',
      });
    }
  }

  const summary = {
    cycle_id: cycleId,
    partners_called: partnersCalled,
    partners_skipped: partnersSkipped,
    errors,
  };

  console.log(JSON.stringify(summary));
  return summary;
}
