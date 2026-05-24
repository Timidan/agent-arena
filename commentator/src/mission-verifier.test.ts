import { describe, expect, it } from 'vitest';
import { evaluateProof, type MissionVerifierMission, type MissionVerifierProof } from './mission-verifier.js';
import type { Interaction } from './indexer.js';

const CLAIMANT = '0x' + '11'.repeat(32);
const TARGET = '0x' + '22'.repeat(32);
const OTHER = '0x' + '33'.repeat(32);

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

  it('allows null method when strict method checking is disabled', () => {
    const decision = evaluateProof(
      proof,
      mission,
      { ...interaction, method: null },
      { ...opts, strictMethod: false },
    );
    expect(decision.action).toBe('approve');
  });
});
