import { describe, it, expect } from 'vitest';
import {
  narrateMarketResolved,
  narrateBountyCompleted,
  narrateLaunchedApp,
  narrateMatchSettled,
  narrateCustom,
} from './narrator.js';

// Helper: UTF-8 byte length (Node Buffer.byteLength)
function byteLen(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

describe('narrateMarketResolved', () => {
  const facts = {
    event_id: 0,
    marketHandle: 'predict-app',
    marketHex: '0xaaaa' + 'a'.repeat(60),
    resolvedTo: 'Yes',
    potVara: '42.5',
  };

  it('body contains @marketHandle mention', () => {
    const post = narrateMarketResolved(facts);
    expect(post.body).toContain('@predict-app');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateMarketResolved(facts);
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });

  it('mentions deduped', () => {
    const post = narrateMarketResolved(facts);
    const hexSet = new Set(post.mentions.map((m) => m.hex));
    expect(post.mentions.length).toBe(hexSet.size);
  });

  it('mention count <= 8', () => {
    const post = narrateMarketResolved(facts);
    expect(post.mentions.length).toBeLessThanOrEqual(8);
  });

  it('picks template deterministically by event_id % 3', () => {
    const p0 = narrateMarketResolved({ ...facts, event_id: 0 });
    const p3 = narrateMarketResolved({ ...facts, event_id: 3 });
    expect(p0.body).toBe(p3.body);
  });
});

describe('narrateBountyCompleted', () => {
  const facts = {
    event_id: 1,
    bountyHandle: 'infinite-bounty-v3',
    bountyHex: '0xbbbb' + 'b'.repeat(60),
    claimerHandle: 'clever-agent',
    claimerHex: '0xcccc' + 'c'.repeat(60),
    rewardVara: '5',
  };

  it('body contains @bountyHandle', () => {
    const post = narrateBountyCompleted(facts);
    expect(post.body).toContain('@infinite-bounty-v3');
  });

  it('body contains @claimerHandle', () => {
    const post = narrateBountyCompleted(facts);
    expect(post.body).toContain('@clever-agent');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateBountyCompleted(facts);
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });

  it('mentions deduped', () => {
    const post = narrateBountyCompleted(facts);
    const hexSet = new Set(post.mentions.map((m) => m.hex));
    expect(post.mentions.length).toBe(hexSet.size);
  });
});

describe('narrateLaunchedApp', () => {
  const facts = {
    event_id: 2,
    appHandle: 'new-cool-app',
    appHex: '0xdddd' + 'd'.repeat(60),
    track: 'Open/Creative',
  };

  it('body contains @new-cool-app', () => {
    const post = narrateLaunchedApp(facts);
    expect(post.body).toContain('@new-cool-app');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateLaunchedApp(facts);
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });

  it('mentions deduped', () => {
    const post = narrateLaunchedApp(facts);
    const hexSet = new Set(post.mentions.map((m) => m.hex));
    expect(post.mentions.length).toBe(hexSet.size);
  });
});

describe('narrateMatchSettled — Winner outcome', () => {
  const facts = {
    event_id: 0,
    winnerHandle: 'alpha-agent',
    loserHandle: 'beta-agent',
    winnerHex: '0xeeee' + 'e'.repeat(60),
    loserHex: '0xffff' + 'f'.repeat(60),
    potVara: '1.8',
    outcomeKind: 'Winner' as const,
  };

  it('body contains winner handle', () => {
    const post = narrateMatchSettled(facts);
    expect(post.body).toContain('@alpha-agent');
  });

  it('body contains loser handle', () => {
    const post = narrateMatchSettled(facts);
    expect(post.body).toContain('@beta-agent');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateMatchSettled(facts);
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });

  it('mentions deduped', () => {
    const post = narrateMatchSettled(facts);
    const hexSet = new Set(post.mentions.map((m) => m.hex));
    expect(post.mentions.length).toBe(hexSet.size);
  });
});

describe('narrateMatchSettled — Abandoned outcome', () => {
  const facts = {
    event_id: 1,
    winnerHandle: 'alpha-agent',
    loserHandle: 'beta-agent',
    winnerHex: '0xeeee' + 'e'.repeat(60),
    loserHex: '0xffff' + 'f'.repeat(60),
    potVara: '2',
    outcomeKind: 'Abandoned' as const,
  };

  it('body handles Abandoned outcome without calling anyone a winner', () => {
    const post = narrateMatchSettled(facts);
    expect(post.body).not.toMatch(/winner|Winner/);
    expect(post.body).toContain('@alpha-agent');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateMatchSettled(facts);
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });
});

describe('narrateCustom', () => {
  it('body contains requesterHandle', () => {
    const post = narrateCustom({
      requesterHandle: 'my-app',
      hint: 'Just shipped a new feature!',
    });
    expect(post.body).toContain('@my-app');
  });

  it('body contains targetHandle when provided', () => {
    const post = narrateCustom({
      requesterHandle: 'my-app',
      hint: 'Integration with partner-app',
      targetHandle: 'partner-app',
    });
    expect(post.body).toContain('@partner-app');
  });

  it('body length <= 240 bytes', () => {
    const post = narrateCustom({
      requesterHandle: 'my-app',
      hint: 'x'.repeat(200),
    });
    expect(byteLen(post.body)).toBeLessThanOrEqual(240);
  });

  it('mentions deduped', () => {
    const post = narrateCustom({
      requesterHandle: 'my-app',
      hint: 'hello',
      targetHandle: 'my-app', // same as requester — should dedup
    });
    const hexSet = new Set(post.mentions.map((m) => m.hex));
    expect(post.mentions.length).toBe(hexSet.size);
  });

  it('mention count <= 8', () => {
    const post = narrateCustom({
      requesterHandle: 'my-app',
      hint: 'hello',
    });
    expect(post.mentions.length).toBeLessThanOrEqual(8);
  });
});

describe('mention count cap across all narrators', () => {
  it('narrateMatchSettled never exceeds 8 mentions even with duplicate inputs', () => {
    const post = narrateMatchSettled({
      event_id: 0,
      winnerHandle: 'a',
      loserHandle: 'b',
      winnerHex: '0x' + '1'.repeat(64),
      loserHex: '0x' + '2'.repeat(64),
      potVara: '1.8',
      outcomeKind: 'Winner',
    });
    expect(post.mentions.length).toBeLessThanOrEqual(8);
  });
});
