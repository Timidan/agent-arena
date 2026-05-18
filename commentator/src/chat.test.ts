/**
 * Tests for postChatAsApplication.
 *
 * We use a dependency-injection pattern (optional `executor` callback) rather
 * than vi.mock('node:child_process') because mocking ESM child_process
 * internals is brittle under vitest + nodenext module resolution.
 * The executor receives (command, args, opts) and returns { stdout }.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { postChatAsApplication, _resetRateLimitForTesting, type Executor } from './chat.js';

// ── minimal env setup ──────────────────────────────────────────────────────

beforeEach(() => {
  // Reset rate-limit tracker so tests don't wait 5.5 s between each other
  _resetRateLimitForTesting();

  process.env.PID = '0x' + '1'.repeat(64);
  process.env.APP_HEX = '0x' + '2'.repeat(64);
  process.env.ACCT = 'test-account';
  process.env.NETWORK_IDL = '/tmp/fake.idl';
  process.env.VOUCHER_ID = '0x' + 'a'.repeat(64);
  process.env.VARA_NETWORK = 'testnet';
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeExecutor(stdout: string): Executor {
  return async (_command, _args, _opts) => ({ stdout });
}

const HAPPY_STDOUT = JSON.stringify({
  result: '42',
  txHash: '0x' + 'f'.repeat(64),
  programMessage: null,
  events: [],
});

const PANIC_STDOUT = JSON.stringify({
  result: null,
  txHash: '0x' + 'f'.repeat(64),
  programMessage: 'RateLimited',
  events: [],
});

const NULL_RESULT_STDOUT = JSON.stringify({
  result: null,
  txHash: '0x' + 'f'.repeat(64),
  programMessage: null,
  events: [],
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('postChatAsApplication', () => {
  it('happy path: returns parsed msgId and txHash', async () => {
    const result = await postChatAsApplication(
      { body: 'hello', mentions: [] },
      makeExecutor(HAPPY_STDOUT),
    );
    expect(result.msgId).toBe('42');
    expect(result.txHash).toBe('0x' + 'f'.repeat(64));
  });

  it('non-null programMessage throws with panic name in message', async () => {
    await expect(
      postChatAsApplication(
        { body: 'hello', mentions: [] },
        makeExecutor(PANIC_STDOUT),
      ),
    ).rejects.toThrow('Chat/Post panicked');
  });

  it('non-null programMessage includes the panic variant', async () => {
    await expect(
      postChatAsApplication(
        { body: 'hello', mentions: [] },
        makeExecutor(PANIC_STDOUT),
      ),
    ).rejects.toThrow('RateLimited');
  });

  it('null result (void return) throws about missing msg id', async () => {
    await expect(
      postChatAsApplication(
        { body: 'hello', mentions: [] },
        makeExecutor(NULL_RESULT_STDOUT),
      ),
    ).rejects.toThrow('null result');
  });

  it('non-JSON stdout throws with descriptive message', async () => {
    await expect(
      postChatAsApplication(
        { body: 'hello', mentions: [] },
        makeExecutor('not json at all'),
      ),
    ).rejects.toThrow('non-JSON');
  });

  it('missing VOUCHER_ID throws early before calling executor', async () => {
    delete process.env.VOUCHER_ID;
    let executorCalled = false;
    const executor: Executor = async () => {
      executorCalled = true;
      return { stdout: HAPPY_STDOUT };
    };
    await expect(
      postChatAsApplication({ body: 'hello', mentions: [] }, executor),
    ).rejects.toThrow('VOUCHER_ID');
    expect(executorCalled).toBe(false);
  });
});
