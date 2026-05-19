import { describe, it, expect } from 'vitest';
import {
  narrateMarketResolved,
  narrateBountyCompleted,
  narrateLaunchedApp,
  narrateMatchSettled,
  narrateCustom,
  narrateHourlyDigest,
  type DigestFacts,
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

// ── narrateHourlyDigest ──────────────────────────────────────────────────────

function makeHex(seed: string): string {
  // 66-char hex (0x + 64 hex digits)
  return '0x' + seed.repeat(32).slice(0, 64);
}

describe('narrateHourlyDigest', () => {
  it('happy path: 12 calls across 3 callees, ≥1 paid — renders correctly', () => {
    // Use short handles so value clause fits in 240 bytes
    const facts: DigestFacts = {
      hour_label: '21:00 UTC',
      totalCalls: 12,
      paidCalls: 3,
      valueVara: 4.5,
      topCallees: [
        { handle: 'vara-a', hex: makeHex('a1'), count: 6 },
        { handle: 'vara-b', hex: makeHex('b2'), count: 4 },
        { handle: 'vara-c', hex: makeHex('c3'), count: 2 },
      ],
      topCallers: [
        { handle: 'bot-a', hex: makeHex('d4'), kind: 'Application', count: 5 },
        { handle: 'bot-b', hex: makeHex('e5'), kind: 'Participant',  count: 3 },
      ],
    };
    const post = narrateHourlyDigest(facts);

    expect(post.body).toContain('12 cross-agent calls');
    expect(post.body).toContain('@vara-a(6)');
    expect(post.body).toContain('@vara-b(4)');
    expect(post.body).toContain('@vara-c(2)');
    expect(post.body).toContain('21:00 UTC');
    expect(post.body).toContain('#AAN-TV');
    expect(post.body).toContain('4.50 VARA');
    expect(Buffer.byteLength(post.body, 'utf8')).toBeLessThanOrEqual(240);
  });

  it('empty path: 0 calls → renders "quiet on the network" fallback', () => {
    const facts: DigestFacts = {
      hour_label: '03:00 UTC',
      totalCalls: 0,
      paidCalls: 0,
      valueVara: 0,
      topCallees: [],
      topCallers: [],
    };
    const post = narrateHourlyDigest(facts);

    expect(post.body).toContain('quiet on the network');
    expect(post.body).toContain('#AAN-TV');
    expect(post.mentions).toHaveLength(0);
    expect(Buffer.byteLength(post.body, 'utf8')).toBeLessThanOrEqual(240);
  });

  it('truncation: many long handles still fit in 240 bytes', () => {
    // Build 3 callees with very long handles
    const facts: DigestFacts = {
      hour_label: '12:00 UTC',
      totalCalls: 50,
      paidCalls: 0,
      valueVara: 0,
      topCallees: [
        { handle: 'a-very-long-handle-name-that-pushes-limits', hex: makeHex('f1'), count: 20 },
        { handle: 'another-extremely-verbose-handle-name-here', hex: makeHex('f2'), count: 18 },
        { handle: 'yet-another-quite-wordy-handle-for-testing', hex: makeHex('f3'), count: 12 },
      ],
      topCallers: [
        { handle: 'super-long-caller-handle-name-extended', hex: makeHex('g1'), kind: 'Application', count: 10 },
        { handle: 'another-long-caller-name-for-test-case', hex: makeHex('g2'), kind: 'Participant', count: 5 },
      ],
    };
    const post = narrateHourlyDigest(facts);

    expect(Buffer.byteLength(post.body, 'utf8')).toBeLessThanOrEqual(240);
    expect(post.body).toContain('#AAN-TV');
    expect(post.body).toContain('50 cross-agent calls');
  });

  it('mention dedup: same hex in both top-callees and top-callers → only one entry', () => {
    const sharedHex = makeHex('aa');
    const facts: DigestFacts = {
      hour_label: '08:00 UTC',
      totalCalls: 5,
      paidCalls: 0,
      valueVara: 0,
      topCallees: [
        { handle: 'shared-app', hex: sharedHex, count: 3 },
      ],
      topCallers: [
        // same hex — should dedup in mentions
        { handle: 'shared-app', hex: sharedHex, kind: 'Application', count: 2 },
      ],
    };
    const post = narrateHourlyDigest(facts);

    const hexSet = new Set(post.mentions.map((m) => m.hex.toLowerCase()));
    expect(post.mentions.length).toBe(hexSet.size); // no duplicates
    expect(post.mentions.length).toBe(1);
  });

  it('mention count never exceeds 8', () => {
    const facts: DigestFacts = {
      hour_label: '15:00 UTC',
      totalCalls: 30,
      paidCalls: 0,
      valueVara: 0,
      topCallees: [
        { handle: 'app1', hex: makeHex('01'), count: 10 },
        { handle: 'app2', hex: makeHex('02'), count: 8 },
        { handle: 'app3', hex: makeHex('03'), count: 6 },
      ],
      topCallers: [
        { handle: 'caller1', hex: makeHex('04'), kind: 'Application', count: 5 },
        { handle: 'caller2', hex: makeHex('05'), kind: 'Participant', count: 3 },
      ],
    };
    const post = narrateHourlyDigest(facts);

    expect(post.mentions.length).toBeLessThanOrEqual(8);
    expect(Buffer.byteLength(post.body, 'utf8')).toBeLessThanOrEqual(240);
  });

  it('no value clause when paidCalls is 0', () => {
    const facts: DigestFacts = {
      hour_label: '10:00 UTC',
      totalCalls: 8,
      paidCalls: 0,
      valueVara: 0,
      topCallees: [{ handle: 'varabridge', hex: makeHex('aa'), count: 8 }],
      topCallers: [],
    };
    const post = narrateHourlyDigest(facts);

    expect(post.body).not.toContain('VARA flow');
    expect(post.body).not.toContain('paid calls');
    expect(Buffer.byteLength(post.body, 'utf8')).toBeLessThanOrEqual(240);
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
