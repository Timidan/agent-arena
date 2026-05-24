/**
 * External integration targets for the dormant AAN-TV outbound runner.
 *
 * Keep this list conservative: every enabled entry needs a concrete program ID
 * and a gas-only/read or one-time free integration method from local research.
 */

import { fileURLToPath } from 'url';

export type PartnerArgs = unknown[] | (() => unknown[]);

const localIdl = (filename: string): string =>
  fileURLToPath(new URL(`../idls/${filename}`, import.meta.url));

export interface PartnerCall {
  /** Stable SQLite key. Use handle + method so multiple reads can rotate independently. */
  key: string;
  handle: string;
  programId: string;
  method: string;
  args?: PartnerArgs;
  idl?: string;
  minIntervalMs: number;
  expectedCost: 'gas-only' | 'free-read';
  notes: string;
  runOnce?: boolean;
}

export const DEFAULT_PARTNER_MIN_INTERVAL_MS = 10 * 60_000;

const envOr = (name: string, fallback: string): string => process.env[name] ?? fallback;

const appHex = (): string => {
  const value = process.env.APP_HEX;
  if (!value) throw new Error('APP_HEX is required to build partner args');
  return value;
};

export const PARTNER_CALLS: PartnerCall[] = [
  {
    key: 'varabridge:VaraBridge/GetAll',
    handle: 'varabridge',
    programId: '0xfb7ed5a79dc2ff15283a524a4489321b5e1f6341db2b9892be83b9568cc1fcb4',
    method: 'VaraBridge/GetAll',
    idl: envOr('VARA_BRIDGE_IDL', localIdl('vara_bridge.idl')),
    minIntervalMs: DEFAULT_PARTNER_MIN_INTERVAL_MS,
    expectedCost: 'free-read',
    notes: 'vara-wallet cannot auto-discover IDL (no on-chain sails:idl). Local IDL fetched from Oltking/vara-trinity.',
  },
  {
    key: 'infinite-bounty-v3:BountyBoard/GetConfig',
    handle: 'infinite-bounty-v3',
    programId: '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8',
    method: 'BountyBoard/GetConfig',
    idl: envOr('INFINITE_BOUNTY_IDL', localIdl('infinite_bounties.idl')),
    minIntervalMs: DEFAULT_PARTNER_MIN_INTERVAL_MS,
    expectedCost: 'free-read',
    notes: 'Public free read advertised by infinite-bounty-v3.',
  },
  {
    key: 'infinite-bounty-v3:BountyBoard/GetBountiesByStatus',
    handle: 'infinite-bounty-v3',
    programId: '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8',
    method: 'BountyBoard/GetBountiesByStatus',
    args: [{ Open: null }, null, 50],
    idl: envOr('INFINITE_BOUNTY_IDL', localIdl('infinite_bounties.idl')),
    minIntervalMs: DEFAULT_PARTNER_MIN_INTERVAL_MS,
    expectedCost: 'free-read',
    notes: 'Open-bounty list read from local command samples.',
  },
  {
    key: 'zeeast-casino:Referral/Register',
    handle: 'zeeast-casino',
    programId: '0xb0b4312511d336db3c625a172b5c7da883d289efdf68648a79869f7b80da7a53',
    method: 'Referral/Register',
    args: () => [appHex()],
    idl: envOr('ZEEAST_CASINO_IDL', localIdl('zeeast_casino.idl')),
    minIntervalMs: 30 * 24 * 60 * 60_000,
    expectedCost: 'gas-only',
    notes: 'One-time free mutual integration endpoint advertised by zeeast-casino.',
    runOnce: true,
  },
];

export const PARTNER_TODOS = [
  'thebookdex: program ID is known, but Orderbook/GetLivePrice args/IDL compatibility were not verified in this sandbox.',
  'kai-oracle-app: program ID is known, but the actual free read method is inferred only; registered IDL is generic.',
  'hy4-predict-app: program ID is known, but no public custom IDL/free read shape was verified.',
  'musa-edge-social-app, iman-pulse-flow, zara-market-app, ada-coord-app, leo-services-app: program IDs are known, but free read methods were not verified.',
] as const;

// TODO(thebookdex): enable after verifying thebook.idl call shape.
// {
//   key: 'thebookdex:Orderbook/GetLivePrice',
//   handle: 'thebookdex',
//   programId: '0x7fa1988c57ba1134e2461c5fb36bc13d66c1dfbf47d36c5e9960b9ca2dc0e4c4',
//   method: 'Orderbook/GetLivePrice',
//   args: ['VARA'],
//   idl: 'https://raw.githubusercontent.com/deveier/thebook/master/thebook.idl',
//   minIntervalMs: DEFAULT_PARTNER_MIN_INTERVAL_MS,
//   expectedCost: 'free-read',
//   notes: 'Advertised by thebookdex; disabled until args are verified.',
// }
