import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateProof,
  runMissionVerifierCycle,
  type MissionVerifierMission,
  type MissionVerifierProof,
} from './mission-verifier.js';
import {
  fetchApplicationInfo,
  fetchChainTipBlock,
  fetchInteractionByProofHash,
} from './indexer.js';
import type { Executor } from './chat.js';
import type { Interaction } from './indexer.js';

vi.mock('./indexer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./indexer.js')>();
  return {
    ...actual,
    fetchApplicationInfo: vi.fn(),
    fetchChainTipBlock: vi.fn(),
    fetchInteractionByProofHash: vi.fn(),
  };
});

const CLAIMANT = '0x' + '11'.repeat(32);
const TARGET = '0x' + '22'.repeat(32);
const OTHER = '0x' + '33'.repeat(32);
const MISSION_PROGRAM = '0x' + '44'.repeat(32);

const mission: MissionVerifierMission = {
  id: '1',
  title: 'Sign the board',
  targetProgram: TARGET,
  requiredAction: 'AanTvBoard/Sign',
  reward: '1000000000000',
  deadlineBlock: 200,
  createdAtBlock: 100,
  closed: false,
};

const proof: MissionVerifierProof = {
  id: '1',
  missionId: '1',
  claimId: '1',
  claimant: CLAIMANT,
  proofTxHash: '0xabc',
  note: 'done',
  submittedAtBlock: 150,
  status: 'Pending',
};

const interaction: Interaction = {
  id: 'interaction:0xabc',
  blockNumber: 150,
  caller: CLAIMANT,
  callerHandle: 'agent-a',
  callerKind: 'Application',
  callee: TARGET,
  calleeHandle: 'aan-tv-board',
  method: 'AanTvBoard/Sign',
  valuePaidRaw: null,
};

const opts = {
  operatorHex: OTHER,
  appHex: undefined,
  missionProgramHex: undefined,
  maxIndexerLagBlocks: 10,
  strictMethod: true,
  chainTipBlock: 160,
};

const mockedFetchApplicationInfo = vi.mocked(fetchApplicationInfo);
const mockedFetchChainTipBlock = vi.mocked(fetchChainTipBlock);
const mockedFetchInteractionByProofHash = vi.mocked(fetchInteractionByProofHash);
let tempDir: string | null = null;

function missionRow(value: MissionVerifierMission) {
  return {
    id: value.id,
    title: value.title,
    target_program: value.targetProgram,
    required_action: value.requiredAction,
    reward: value.reward,
    deadline_block: value.deadlineBlock,
    created_at_block: value.createdAtBlock,
    closed: value.closed,
  };
}

function proofRow(value: MissionVerifierProof) {
  return {
    id: value.id,
    mission_id: value.missionId,
    claim_id: value.claimId,
    claimant: value.claimant,
    proof_tx_hash: value.proofTxHash,
    note: value.note,
    submitted_at_block: value.submittedAtBlock,
    status: value.status,
  };
}

function methodFromArgs(args: string[]): string {
  const method = args.find((arg) => arg.startsWith('AanMissions/'));
  if (!method) throw new Error(`missing method in args: ${args.join(' ')}`);
  return method;
}

function makeExecutor(overrides: Partial<Record<string, unknown>> = {}): Executor {
  return vi.fn(async (_command, args) => {
    const method = methodFromArgs(args);
    const result = overrides[method] ?? {
      'AanMissions/GetPendingProofs': {
        items: [proofRow(proof)],
        next_cursor: null,
      },
      'AanMissions/GetMission': missionRow(mission),
      'AanMissions/ApproveProof': {
        proof_id: proof.id,
        mission_id: proof.missionId,
        claimant: proof.claimant,
        amount: mission.reward,
      },
      'AanMissions/GetProof': proofRow({ ...proof, status: 'Approved' }),
      'AanMissions/RejectProof': null,
    }[method];

    return { stdout: JSON.stringify({ result }), stderr: '' };
  });
}

function calledMethods(executor: Executor): string[] {
  return vi.mocked(executor).mock.calls.map(([, args]) => methodFromArgs(args));
}

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = mkdtempSync(join(tmpdir(), 'aan-mission-verifier-'));
  process.env.CHECKPOINT_DB = join(tempDir, 'checkpoint.sqlite');
  process.env.MISSION_VERIFIER_ENABLED = 'true';
  process.env.MISSION_VERIFIER_APPROVALS_ENABLED = 'false';
  process.env.MISSION_VERIFIER_POST_HIGHLIGHTS = 'false';
  process.env.MISSION_VERIFIER_STRICT_METHOD = 'true';
  process.env.MISSION_PROGRAM_HEX = MISSION_PROGRAM;
  process.env.MISSION_IDL = '/tmp/aan_missions_client.idl';
  process.env.ACCT = 'agent-arena';
  process.env.OPERATOR_HEX = OTHER;
  process.env.VARA_NETWORK = 'mainnet';
  delete process.env.MAX_DAILY_MISSION_VERIFIER_CALLS;
  delete process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW;
  delete process.env.MAX_DAILY_SPEND_RAW;
  mockedFetchChainTipBlock.mockResolvedValue(160);
  mockedFetchInteractionByProofHash.mockResolvedValue(interaction);
  mockedFetchApplicationInfo.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.CHECKPOINT_DB;
  delete process.env.MISSION_VERIFIER_ENABLED;
  delete process.env.MISSION_VERIFIER_APPROVALS_ENABLED;
  delete process.env.MISSION_VERIFIER_POST_HIGHLIGHTS;
  delete process.env.MISSION_VERIFIER_STRICT_METHOD;
  delete process.env.MISSION_PROGRAM_HEX;
  delete process.env.MISSION_IDL;
  delete process.env.ACCT;
  delete process.env.OPERATOR_HEX;
  delete process.env.VARA_NETWORK;
  delete process.env.MAX_DAILY_MISSION_VERIFIER_CALLS;
  delete process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW;
  delete process.env.MAX_DAILY_SPEND_RAW;
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = null;
});

describe('evaluateProof', () => {
  it('approves an indexed interaction that matches claimant, target, method, and window', () => {
    const decision = evaluateProof(proof, mission, interaction, opts);
    expect(decision.action).toBe('approve');
  });

  it('defers a missing interaction inside the indexer lag window', () => {
    const decision = evaluateProof(proof, mission, null, opts);
    expect(decision.action).toBe('defer');
  });

  it('rejects a missing interaction after the indexer lag window', () => {
    const decision = evaluateProof(proof, mission, null, { ...opts, chainTipBlock: 10_000 });
    expect(decision.action).toBe('reject');
  });

  it('rejects a caller mismatch', () => {
    const decision = evaluateProof(
      proof,
      mission,
      { ...interaction, caller: OTHER },
      opts,
    );
    expect(decision.action).toBe('reject');
    expect(decision.reason).toContain('caller mismatch');
  });

  it('rejects a target mismatch', () => {
    const decision = evaluateProof(
      proof,
      mission,
      { ...interaction, callee: OTHER },
      opts,
    );
    expect(decision.action).toBe('reject');
    expect(decision.reason).toContain('target mismatch');
  });

  it('rejects proofs from our own operator or cluster apps', () => {
    const decision = evaluateProof(
      { ...proof, claimant: OTHER },
      mission,
      { ...interaction, caller: OTHER },
      { ...opts, operatorHex: OTHER },
    );
    expect(decision.action).toBe('reject');
    expect(decision.reason).toContain('not reward-eligible');
  });

  it('rejects proofs outside the mission block window', () => {
    const before = evaluateProof(
      proof,
      mission,
      { ...interaction, blockNumber: 99 },
      opts,
    );
    const after = evaluateProof(
      proof,
      mission,
      { ...interaction, blockNumber: 201 },
      opts,
    );

    expect(before.action).toBe('reject');
    expect(before.reason).toContain('predates');
    expect(after.action).toBe('reject');
    expect(after.reason).toContain('after mission deadline');
  });

  it('allows null method when strict method checking is disabled', () => {
    const decision = evaluateProof(
      proof,
      mission,
      { ...interaction, method: null },
      { ...opts, strictMethod: false },
    );
    expect(decision.action).toBe('approve');
  });

  it('requires external integration missions to call registered non-cluster apps', () => {
    const externalMission = {
      ...mission,
      targetProgram: null,
      requiredAction: 'external_registered_app',
    };

    const unregistered = evaluateProof(
      proof,
      externalMission,
      interaction,
      { ...opts, strictMethod: true, calleeRegistered: false },
    );
    const ownTarget = evaluateProof(
      proof,
      externalMission,
      { ...interaction, callee: OTHER },
      { ...opts, strictMethod: true, appHex: OTHER, calleeRegistered: true },
    );
    const registered = evaluateProof(
      proof,
      externalMission,
      interaction,
      { ...opts, strictMethod: true, calleeRegistered: true },
    );

    expect(unregistered.action).toBe('reject');
    expect(unregistered.reason).toContain('not a registered application');
    expect(ownTarget.action).toBe('reject');
    expect(ownTarget.reason).toContain('own cluster');
    expect(registered.action).toBe('approve');
  });
});

describe('runMissionVerifierCycle', () => {
  it('checks pending proofs but does not submit approval writes in read-only mode', async () => {
    const executor = makeExecutor();

    const summary = await runMissionVerifierCycle(executor);

    expect(summary).toMatchObject({
      checked: 1,
      approved: 1,
      rejected: 0,
      deferred: 0,
      errors: [],
    });
    expect(mockedFetchInteractionByProofHash).toHaveBeenCalledWith(proof.proofTxHash);
    expect(calledMethods(executor)).toEqual([
      'AanMissions/GetPendingProofs',
      'AanMissions/GetMission',
    ]);
  });

  it('submits approval and confirms proof state when approval mode is enabled', async () => {
    process.env.MISSION_VERIFIER_APPROVALS_ENABLED = 'true';
    process.env.MAX_DAILY_MISSION_VERIFIER_CALLS = '1';
    process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW = '0';
    const executor = makeExecutor();

    const summary = await runMissionVerifierCycle(executor);

    expect(summary).toMatchObject({
      checked: 1,
      approved: 1,
      rejected: 0,
      deferred: 0,
      errors: [],
    });
    expect(calledMethods(executor)).toEqual([
      'AanMissions/GetPendingProofs',
      'AanMissions/GetMission',
      'AanMissions/ApproveProof',
      'AanMissions/GetProof',
    ]);
  });

  it('does not write deferred proofs when the indexer has not caught up', async () => {
    mockedFetchInteractionByProofHash.mockResolvedValue(null);
    const executor = makeExecutor();

    const summary = await runMissionVerifierCycle(executor);

    expect(summary).toMatchObject({
      checked: 1,
      approved: 0,
      rejected: 0,
      deferred: 1,
      errors: [],
    });
    expect(calledMethods(executor)).toEqual([
      'AanMissions/GetPendingProofs',
      'AanMissions/GetMission',
    ]);
  });
});
