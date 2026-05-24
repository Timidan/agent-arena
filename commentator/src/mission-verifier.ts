import { execFile as _execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  fetchApplicationInfo,
  fetchChainTipBlock,
  fetchInteractionByProofHash,
  type Interaction,
} from './indexer.js';
import { postChatAsApplication, type Executor } from './chat.js';
import { ensureFresh } from './voucher.js';
import { reserveMissionVerifierCallBudget } from './spend-guard.js';

const execFile = promisify(_execFile);

const AAN_TV_BOARD_HEX = '0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d';
const AAN_TV_TIP_HEX = '0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02';
const AAN_TV_DATA_HEX = '0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c';

export interface MissionVerifierProof {
  id: string;
  missionId: string;
  claimId: string;
  claimant: string;
  proofTxHash: string;
  note: string;
  submittedAtBlock: number;
  status: 'Pending' | 'Approved' | 'Rejected' | string;
}

export interface MissionVerifierMission {
  id: string;
  title: string;
  targetProgram: string | null;
  requiredAction: string;
  reward: string;
  deadlineBlock: number;
  createdAtBlock: number;
  closed: boolean;
}

export interface VerificationOptions {
  operatorHex?: string;
  appHex?: string;
  missionProgramHex?: string;
  maxIndexerLagBlocks: number;
  strictMethod: boolean;
  chainTipBlock: number;
  calleeRegistered?: boolean;
}

export type VerificationDecision =
  | { action: 'approve'; reason: string; interaction: Interaction }
  | { action: 'reject'; reason: string; interaction?: Interaction }
  | { action: 'defer'; reason: string };

interface ProofPage {
  items: MissionVerifierProof[];
  nextCursor: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
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

function lowerHex(value: string | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

function normalizeProofTxHash(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeStatus(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys[0] ?? '';
  }
  return '';
}

function stringField(row: Record<string, unknown>, snake: string, camel: string): string {
  return String(row[snake] ?? row[camel] ?? '');
}

function numberField(row: Record<string, unknown>, snake: string, camel: string): number {
  return Number(row[snake] ?? row[camel] ?? 0);
}

function optionalStringField(row: Record<string, unknown>, snake: string, camel: string): string | null {
  const value = row[snake] ?? row[camel];
  return typeof value === 'string' ? value : null;
}

export function parseMission(raw: unknown): MissionVerifierMission | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = stringField(row, 'id', 'id');
  if (!id) return null;
  return {
    id,
    title: stringField(row, 'title', 'title'),
    targetProgram: optionalStringField(row, 'target_program', 'targetProgram'),
    requiredAction: stringField(row, 'required_action', 'requiredAction'),
    reward: stringField(row, 'reward', 'reward'),
    deadlineBlock: numberField(row, 'deadline_block', 'deadlineBlock'),
    createdAtBlock: numberField(row, 'created_at_block', 'createdAtBlock'),
    closed: Boolean(row['closed']),
  };
}

export function parseProof(raw: unknown): MissionVerifierProof | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = stringField(row, 'id', 'id');
  if (!id) return null;
  return {
    id,
    missionId: stringField(row, 'mission_id', 'missionId'),
    claimId: stringField(row, 'claim_id', 'claimId'),
    claimant: stringField(row, 'claimant', 'claimant'),
    proofTxHash: stringField(row, 'proof_tx_hash', 'proofTxHash'),
    note: stringField(row, 'note', 'note'),
    submittedAtBlock: numberField(row, 'submitted_at_block', 'submittedAtBlock'),
    status: normalizeStatus(row['status']),
  };
}

function ownHexes(opts: VerificationOptions): Set<string> {
  return new Set(
    [
      opts.operatorHex,
      opts.appHex,
      opts.missionProgramHex,
      AAN_TV_BOARD_HEX,
      AAN_TV_TIP_HEX,
      AAN_TV_DATA_HEX,
    ]
      .map(lowerHex)
      .filter((value): value is string => value != null),
  );
}

function actionMatches(requiredAction: string, method: string | null): boolean {
  const required = requiredAction.trim().toLowerCase();
  if (!required || required === 'any') return true;
  if (!method) return false;

  const actual = method.trim().toLowerCase();
  const actualTail = actual.split('/').pop() ?? actual;
  const requiredTail = required.split('/').pop() ?? required;

  return (
    actual === required ||
    actualTail === requiredTail ||
    required.includes(actual) ||
    required.includes(actualTail) ||
    actual.includes(required)
  );
}

function requiresExternalRegisteredApp(requiredAction: string): boolean {
  return requiredAction.trim().toLowerCase() === 'external_registered_app';
}

export function evaluateProof(
  proof: MissionVerifierProof,
  mission: MissionVerifierMission,
  interaction: Interaction | null,
  opts: VerificationOptions,
): VerificationDecision {
  if (proof.status !== 'Pending') {
    return { action: 'defer', reason: `proof is ${proof.status}` };
  }

  if (mission.closed) {
    return { action: 'reject', reason: 'mission is closed' };
  }

  if (!interaction) {
    const age = Math.max(0, opts.chainTipBlock - proof.submittedAtBlock);
    if (age <= opts.maxIndexerLagBlocks) {
      return {
        action: 'defer',
        reason: `proof tx not indexed yet; age=${age}/${opts.maxIndexerLagBlocks} blocks`,
      };
    }
    return { action: 'reject', reason: 'proof tx not found after indexer lag window' };
  }

  const claimant = proof.claimant.toLowerCase();
  if (interaction.caller.toLowerCase() !== claimant) {
    return {
      action: 'reject',
      reason: `caller mismatch: proof claimant ${proof.claimant} but tx caller ${interaction.caller}`,
      interaction,
    };
  }

  if (ownHexes(opts).has(interaction.caller.toLowerCase())) {
    return {
      action: 'reject',
      reason: 'own operator or cluster caller is not reward-eligible',
      interaction,
    };
  }

  if (mission.targetProgram && interaction.callee.toLowerCase() !== mission.targetProgram.toLowerCase()) {
    return {
      action: 'reject',
      reason: `target mismatch: expected ${mission.targetProgram} got ${interaction.callee}`,
      interaction,
    };
  }

  if (requiresExternalRegisteredApp(mission.requiredAction)) {
    if (ownHexes(opts).has(interaction.callee.toLowerCase())) {
      return {
        action: 'reject',
        reason: 'external mission cannot target our own cluster',
        interaction,
      };
    }

    if (opts.calleeRegistered !== true) {
      return {
        action: 'reject',
        reason: 'external mission target is not a registered application',
        interaction,
      };
    }
  }

  if (interaction.blockNumber < mission.createdAtBlock) {
    return {
      action: 'reject',
      reason: 'proof tx predates mission creation',
      interaction,
    };
  }

  if (interaction.blockNumber > mission.deadlineBlock) {
    return {
      action: 'reject',
      reason: 'proof tx is after mission deadline',
      interaction,
    };
  }

  if (
    opts.strictMethod &&
    !requiresExternalRegisteredApp(mission.requiredAction) &&
    !actionMatches(mission.requiredAction, interaction.method)
  ) {
    return {
      action: 'reject',
      reason: `method mismatch: expected ${mission.requiredAction}, got ${interaction.method ?? 'null'}`,
      interaction,
    };
  }

  return { action: 'approve', reason: 'proof matches indexed interaction', interaction };
}

async function varaWalletCall(
  programHex: string,
  method: string,
  args: unknown[],
  idl: string,
  timeout: number,
  executor: Executor,
): Promise<Record<string, unknown>> {
  const tmpPath = join(tmpdir(), `aan-missions-${randomBytes(8).toString('hex')}.json`);
  await writeFile(tmpPath, JSON.stringify(args), 'utf8');

  try {
    const { stdout } = await executor(
      'vara-wallet',
      [
        '--account', requireEnv('ACCT'),
        '--network', process.env.VARA_NETWORK ?? 'mainnet',
        '--json',
        'call',
        programHex,
        method,
        '--args-file', tmpPath,
        '--idl', idl,
      ],
      { timeout },
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`vara-wallet returned non-JSON for ${method}: ${stdout.slice(0, 200)}`);
    }

    if (parsed['programMessage'] != null) {
      throw new Error(`${method} failed: ${JSON.stringify(parsed['programMessage'])}`);
    }

    return parsed;
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

const defaultExecutor: Executor = async (command, args, opts) => execFile(command, args, opts);

async function getPendingProofs(limit: number, executor: Executor): Promise<MissionVerifierProof[]> {
  const parsed = await varaWalletCall(
    requireEnv('MISSION_PROGRAM_HEX'),
    'AanMissions/GetPendingProofs',
    [null, limit],
    requireEnv('MISSION_IDL'),
    30_000,
    executor,
  );
  const result = parsed['result'] as { items?: unknown[]; next_cursor?: string | number | null } | null;
  const page: ProofPage = {
    items: (result?.items ?? []).map(parseProof).filter((proof): proof is MissionVerifierProof => proof != null),
    nextCursor: result?.next_cursor == null ? null : String(result.next_cursor),
  };
  return page.items;
}

async function getMission(missionId: string, executor: Executor): Promise<MissionVerifierMission | null> {
  const parsed = await varaWalletCall(
    requireEnv('MISSION_PROGRAM_HEX'),
    'AanMissions/GetMission',
    [missionId],
    requireEnv('MISSION_IDL'),
    30_000,
    executor,
  );
  return parseMission(parsed['result']);
}

async function getProof(proofId: string, executor: Executor): Promise<MissionVerifierProof | null> {
  const parsed = await varaWalletCall(
    requireEnv('MISSION_PROGRAM_HEX'),
    'AanMissions/GetProof',
    [proofId],
    requireEnv('MISSION_IDL'),
    30_000,
    executor,
  );
  return parseProof(parsed['result']);
}

async function approveProof(proofId: string, executor: Executor): Promise<void> {
  reserveMissionVerifierCallBudget();
  await varaWalletCall(
    requireEnv('MISSION_PROGRAM_HEX'),
    'AanMissions/ApproveProof',
    [proofId],
    requireEnv('MISSION_IDL'),
    60_000,
    executor,
  );
}

async function rejectProof(proofId: string, reason: string, executor: Executor): Promise<void> {
  reserveMissionVerifierCallBudget();
  await varaWalletCall(
    requireEnv('MISSION_PROGRAM_HEX'),
    'AanMissions/RejectProof',
    [proofId, reason.slice(0, 160)],
    requireEnv('MISSION_IDL'),
    60_000,
    executor,
  );
}

function shortHex(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatVara(raw: string): string {
  try {
    const planck = BigInt(raw);
    const whole = planck / 1_000_000_000_000n;
    const frac = (planck % 1_000_000_000_000n) / 10_000_000_000n;
    return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(2, '0')}`;
  } catch {
    return '?';
  }
}

async function postApprovalHighlight(
  mission: MissionVerifierMission,
  proof: MissionVerifierProof,
  interaction: Interaction,
): Promise<void> {
  await ensureFresh();
  const callerHandle = interaction.callerHandle ? `@${interaction.callerHandle}` : shortHex(proof.claimant);
  const body =
    `AAN Missions approved ${callerHandle}: "${mission.title}" ` +
    `paid ${formatVara(mission.reward)} VARA. tx:${shortHex(interaction.id)}`;
  await postChatAsApplication({
    body: body.length > 240 ? `${body.slice(0, 239)}…` : body,
    mentions: [{
      kind: interaction.callerKind === 'Application' ? 'Application' : 'Participant',
      hex: proof.claimant,
    }],
  });
}

export interface MissionVerifierCycleSummary {
  checked: number;
  approved: number;
  rejected: number;
  deferred: number;
  errors: Array<{ proofId: string; error: string }>;
}

export async function runMissionVerifierCycle(
  executor: Executor = defaultExecutor,
): Promise<MissionVerifierCycleSummary | null> {
  if (!envBool('MISSION_VERIFIER_ENABLED', false)) return null;

  const approvalsEnabled = envBool('MISSION_VERIFIER_APPROVALS_ENABLED', false);
  const postHighlights = envBool('MISSION_VERIFIER_POST_HIGHLIGHTS', false);
  const limit = envNumber('MISSION_VERIFIER_LIMIT', 25);
  const chainTipBlock = await fetchChainTipBlock();
  const proofs = await getPendingProofs(limit, executor);
  const summary: MissionVerifierCycleSummary = {
    checked: proofs.length,
    approved: 0,
    rejected: 0,
    deferred: 0,
    errors: [],
  };
  const seenProofTxHashes = new Set<string>();

  for (const proof of proofs) {
    try {
      const proofTxHash = normalizeProofTxHash(proof.proofTxHash);
      if (proof.status === 'Pending' && proofTxHash) {
        if (seenProofTxHashes.has(proofTxHash)) {
          const reason = 'duplicate proof tx hash in pending page';
          summary.rejected += 1;
          console.log(`[mission-verifier] reject proof=${proof.id}: ${reason}`);
          if (approvalsEnabled) await rejectProof(proof.id, reason, executor);
          continue;
        }
        seenProofTxHashes.add(proofTxHash);
      }

      const mission = await getMission(proof.missionId, executor);
      if (!mission) {
        summary.rejected += 1;
        if (approvalsEnabled) await rejectProof(proof.id, 'mission not found', executor);
        continue;
      }

      const interaction = await fetchInteractionByProofHash(proof.proofTxHash);
      const calleeRegistered = interaction && requiresExternalRegisteredApp(mission.requiredAction)
        ? Boolean(await fetchApplicationInfo(interaction.callee))
        : undefined;
      const decision = evaluateProof(proof, mission, interaction, {
        operatorHex: process.env.OPERATOR_HEX,
        appHex: process.env.APP_HEX,
        missionProgramHex: process.env.MISSION_PROGRAM_HEX,
        maxIndexerLagBlocks: envNumber('MISSION_VERIFIER_MAX_INDEXER_LAG_BLOCKS', 2400),
        strictMethod: envBool('MISSION_VERIFIER_STRICT_METHOD', false),
        chainTipBlock,
        calleeRegistered,
      });

      if (decision.action === 'defer') {
        summary.deferred += 1;
        console.log(`[mission-verifier] deferred proof=${proof.id}: ${decision.reason}`);
        continue;
      }

      if (decision.action === 'reject') {
        summary.rejected += 1;
        console.log(`[mission-verifier] reject proof=${proof.id}: ${decision.reason}`);
        if (approvalsEnabled) await rejectProof(proof.id, decision.reason, executor);
        continue;
      }

      summary.approved += 1;
      console.log(`[mission-verifier] approve proof=${proof.id}: ${decision.reason}`);
      if (!approvalsEnabled) continue;

      await approveProof(proof.id, executor);
      const confirmed = await getProof(proof.id, executor);
      if (confirmed?.status !== 'Approved') {
        throw new Error(`approval not confirmed for proof ${proof.id}`);
      }
      if (postHighlights) {
        await postApprovalHighlight(mission, confirmed, decision.interaction);
      }
    } catch (err) {
      summary.errors.push({
        proofId: proof.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(JSON.stringify({ kind: 'mission_verifier_cycle', ...summary }));
  return summary;
}

export async function runMissionVerifierLoop(opts: { intervalMs: number }): Promise<never> {
  console.log('[mission-verifier] starting');
  console.log(`[mission-verifier] enabled=${envBool('MISSION_VERIFIER_ENABLED', false)}`);
  console.log(`[mission-verifier] approvals=${envBool('MISSION_VERIFIER_APPROVALS_ENABLED', false)}`);
  console.log(`[mission-verifier] interval=${opts.intervalMs}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      await runMissionVerifierCycle();
    } catch (err) {
      console.error('[mission-verifier] cycle failed:', err);
    }
    const elapsed = Date.now() - started;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, opts.intervalMs - elapsed)));
  }
}
