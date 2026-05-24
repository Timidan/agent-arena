import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir: string | null = null;

function clearSpendEnv() {
  delete process.env.MAX_DAILY_CHAT_POSTS;
  delete process.env.MAX_DAILY_MARK_COVERED_CALLS;
  delete process.env.MAX_DAILY_PARTNER_CALLS;
  delete process.env.MAX_DAILY_MISSION_VERIFIER_CALLS;
  delete process.env.MAX_DAILY_SPEND_RAW;
  delete process.env.CHAT_POST_ESTIMATED_SPEND_RAW;
  delete process.env.MARK_COVERED_ESTIMATED_SPEND_RAW;
  delete process.env.PARTNER_CALL_ESTIMATED_SPEND_RAW;
  delete process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW;
}

beforeEach(() => {
  vi.resetModules();
  clearSpendEnv();
  tempDir = mkdtempSync(join(tmpdir(), 'aan-spend-guard-'));
  process.env.CHECKPOINT_DB = join(tempDir, 'checkpoint.sqlite');
});

afterEach(() => {
  clearSpendEnv();
  delete process.env.CHECKPOINT_DB;
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = null;
});

describe('mission verifier spend guard', () => {
  it('blocks approval writes by default', async () => {
    const { reserveMissionVerifierCallBudget } = await import('./spend-guard.js');

    expect(() => reserveMissionVerifierCallBudget()).toThrow(
      /mission verifier call daily cap reached: 1\/0/,
    );
  });

  it('allows only the configured number of mission verifier calls', async () => {
    process.env.MAX_DAILY_MISSION_VERIFIER_CALLS = '2';
    process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW = '10';

    const { reserveMissionVerifierCallBudget } = await import('./spend-guard.js');
    const { getDailySpendSnapshot } = await import('./checkpoint.js');

    expect(reserveMissionVerifierCallBudget().missionVerifierCalls).toBe(1);
    expect(reserveMissionVerifierCallBudget().missionVerifierCalls).toBe(2);
    expect(() => reserveMissionVerifierCallBudget()).toThrow(
      /mission verifier call daily cap reached: 3\/2/,
    );

    const snapshot = getDailySpendSnapshot();
    expect(snapshot.missionVerifierCalls).toBe(2);
    expect(snapshot.estimatedSpendRaw).toBe(20n);
  });

  it('blocks mission verifier calls that would exceed the global spend cap', async () => {
    process.env.MAX_DAILY_MISSION_VERIFIER_CALLS = '5';
    process.env.MISSION_VERIFIER_ESTIMATED_SPEND_RAW = '20';
    process.env.MAX_DAILY_SPEND_RAW = '30';

    const { reserveMissionVerifierCallBudget } = await import('./spend-guard.js');
    const { getDailySpendSnapshot } = await import('./checkpoint.js');

    expect(reserveMissionVerifierCallBudget().estimatedSpendRaw).toBe(20n);
    expect(() => reserveMissionVerifierCallBudget()).toThrow(
      /MAX_DAILY_SPEND_RAW cap reached: 40\/30/,
    );

    const snapshot = getDailySpendSnapshot();
    expect(snapshot.missionVerifierCalls).toBe(1);
    expect(snapshot.estimatedSpendRaw).toBe(20n);
  });
});
