import { describe, it, expect } from 'vitest';
import { isSelfLoop } from './self-loop-guard.js';

const OWN = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1';
const OTHER_A = '0x1111111111111111111111111111111111111111111111111111111111111111';
const OTHER_B = '0x2222222222222222222222222222222222222222222222222222222222222222';

describe('isSelfLoop', () => {
  it('returns true when source matches ownHex', () => {
    expect(isSelfLoop({ source: OWN, target: OTHER_A }, OWN)).toBe(true);
  });

  it('returns true when target matches ownHex', () => {
    expect(isSelfLoop({ source: OTHER_A, target: OWN }, OWN)).toBe(true);
  });

  it('returns true when both source and target match ownHex', () => {
    expect(isSelfLoop({ source: OWN, target: OWN }, OWN)).toBe(true);
  });

  it('returns false when neither source nor target matches ownHex', () => {
    expect(isSelfLoop({ source: OTHER_A, target: OTHER_B }, OWN)).toBe(false);
  });

  it('is case-insensitive (0xABC vs 0xabc)', () => {
    const upperOwn = OWN.toUpperCase();
    expect(isSelfLoop({ source: upperOwn, target: OTHER_A }, OWN)).toBe(true);
  });

  it('is case-insensitive on ownHex side too', () => {
    const lowerOwn = OWN.toLowerCase();
    const upperOwn = OWN.toUpperCase();
    expect(isSelfLoop({ source: OTHER_A, target: lowerOwn }, upperOwn)).toBe(true);
  });
});
