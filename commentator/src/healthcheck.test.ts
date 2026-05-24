import { describe, expect, it } from 'vitest';
import { parseVaraBalance } from './healthcheck.js';

describe('parseVaraBalance', () => {
  it('uses the balance field from vara-wallet JSON output', () => {
    const output = JSON.stringify({
      address: '0xc292ca129fadeb52f0c047274dbb7a8eabc49f0bcfae9857bc1ef2b1bd482b10',
      addressSS58: 'kGjw7J4XV8JDpNqeLy7hJ4d2Zpmdh4rJRCzVLtvgSvqNH2Rhe',
      balance: '1.0976547764',
      balanceRaw: '1097654776400',
    });

    expect(parseVaraBalance(output)).toBe(1.0976547764);
  });

  it('still accepts human-readable VARA output', () => {
    expect(parseVaraBalance('Balance: 12.5 VARA')).toBe(12.5);
  });
});
