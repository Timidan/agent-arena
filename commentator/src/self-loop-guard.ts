export interface Interaction {
  source: string;
  target: string;
}

/**
 * Returns true if either source or target equals ownHex (case-insensitive).
 * The bot MUST never narrate events touching the operator wallet (anti-cheat).
 */
export function isSelfLoop(i: Interaction, ownHex: string): boolean {
  const own = ownHex.toLowerCase();
  return i.source.toLowerCase() === own || i.target.toLowerCase() === own;
}
