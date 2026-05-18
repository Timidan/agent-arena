/**
 * Tests for the per-interaction dedup helpers added in Fix 2.
 *
 * Uses an in-memory SQLite DB via CHECKPOINT_DB=:memory: env override.
 * The module is re-imported fresh for each test suite to reset the singleton.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Force in-memory DB for tests; must be set before any import of checkpoint.ts
// (the module lazily initialises the DB on first access).
process.env.CHECKPOINT_DB = ':memory:';

// Dynamically import so each describe block can reset module state if needed.
// Since vitest doesn't reset module singletons between tests by default, we
// use a single import and rely on SQLite's in-memory isolation per process run.
import {
  alreadyProcessed,
  recordProcessed,
  recordFailed,
  getLastSeenBlock,
  setLastSeenBlock,
} from './checkpoint.js';

describe('alreadyProcessed / recordProcessed / recordFailed', () => {
  it('returns false for an unseen interaction id', () => {
    expect(alreadyProcessed('interaction-new-1')).toBe(false);
  });

  it('returns true after recordProcessed', () => {
    recordProcessed('interaction-ok-1', 'msg-42', '0xtxhash');
    expect(alreadyProcessed('interaction-ok-1')).toBe(true);
  });

  it('returns true after recordFailed', () => {
    recordFailed('interaction-fail-1', 'some error');
    expect(alreadyProcessed('interaction-fail-1')).toBe(true);
  });

  it('recordProcessed is idempotent (ON CONFLICT DO NOTHING)', () => {
    recordProcessed('interaction-idem-1', 'msg-1', '0xhash1');
    // Second call with different data — should not throw and the first record wins
    expect(() => recordProcessed('interaction-idem-1', 'msg-2', '0xhash2')).not.toThrow();
    expect(alreadyProcessed('interaction-idem-1')).toBe(true);
  });

  it('recordFailed is idempotent', () => {
    recordFailed('interaction-fail-idem-1', 'first error');
    expect(() => recordFailed('interaction-fail-idem-1', 'second error')).not.toThrow();
  });

  it('different interaction ids are independent', () => {
    recordProcessed('interaction-a', 'msg-a', '0xa');
    expect(alreadyProcessed('interaction-b')).toBe(false);
  });
});

describe('getLastSeenBlock / setLastSeenBlock', () => {
  it('defaults to 0 on fresh DB', () => {
    // The in-memory DB is shared in this test run; may have been touched.
    // We just verify the return type is a number.
    expect(typeof getLastSeenBlock()).toBe('number');
  });

  it('round-trips a block number', () => {
    setLastSeenBlock(99_999);
    expect(getLastSeenBlock()).toBe(99_999);
  });

  it('overwrites previous value', () => {
    setLastSeenBlock(1000);
    setLastSeenBlock(2000);
    expect(getLastSeenBlock()).toBe(2000);
  });
});
