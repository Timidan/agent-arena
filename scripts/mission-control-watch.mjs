#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PROGRAM = '0x5a94f7ce047f9480c5b84afee1681a5fa82654f1029254bed5bf28d3e1b7a4d0';
const DEFAULT_OPERATOR = '0xc292ca129fadeb52f0c047274dbb7a8eabc49f0bcfae9857bc1ef2b1bd482b10';
const DEFAULT_INDEXER = 'https://agents-api.vara.network/graphql';
const DEFAULT_IDL = fileURLToPath(new URL('../docs/aan_missions.idl', import.meta.url));

function parseArgs(argv) {
  const opts = {
    program: process.env.MISSION_PROGRAM_HEX || DEFAULT_PROGRAM,
    operator: process.env.OPERATOR_HEX || DEFAULT_OPERATOR,
    indexer: process.env.INDEXER_GRAPHQL_URL || DEFAULT_INDEXER,
    idl: process.env.MISSION_IDL || DEFAULT_IDL,
    network: process.env.VARA_NETWORK || 'mainnet',
    intervalMs: Number(process.env.MISSION_WATCH_INTERVAL_MS || 60_000),
    timeoutMs: Number(process.env.MISSION_WATCH_TIMEOUT_MS || 0),
    sinceBlock: process.env.MISSION_WATCH_SINCE_BLOCK
      ? Number(process.env.MISSION_WATCH_SINCE_BLOCK)
      : null,
    once: false,
    exitOnHit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--program':
        opts.program = argv[++i] || '';
        break;
      case '--operator':
        opts.operator = argv[++i] || '';
        break;
      case '--indexer':
        opts.indexer = argv[++i] || '';
        break;
      case '--idl':
        opts.idl = argv[++i] || '';
        break;
      case '--network':
        opts.network = argv[++i] || '';
        break;
      case '--interval-ms':
        opts.intervalMs = Number(argv[++i]);
        break;
      case '--timeout-ms':
        opts.timeoutMs = Number(argv[++i]);
        break;
      case '--since-block':
        opts.sinceBlock = Number(argv[++i]);
        break;
      case '--once':
        opts.once = true;
        break;
      case '--exit-on-hit':
        opts.exitOnHit = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(opts.program)) throw new Error('--program must be a 32-byte hex id');
  if (!/^0x[0-9a-fA-F]{64}$/.test(opts.operator)) throw new Error('--operator must be a 32-byte hex id');
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs < 5_000) {
    throw new Error('--interval-ms must be at least 5000');
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 0) {
    throw new Error('--timeout-ms must be zero or positive');
  }
  if (opts.sinceBlock != null && (!Number.isSafeInteger(opts.sinceBlock) || opts.sinceBlock < 0)) {
    throw new Error('--since-block must be a non-negative integer');
  }

  return opts;
}

function usage() {
  console.log(`usage: scripts/mission-control-watch.mjs [options]

Polls Mission Control for real incoming activity.

Options:
  --program <hex>       Mission Control program id.
  --operator <hex>      Operator wallet hex to exclude from external-call hits.
  --indexer <url>       Vara Agent Network GraphQL endpoint.
  --idl <path>          AanMissions IDL path for GetStats.
  --network <name>      vara-wallet network. Default: mainnet.
  --since-block <n>     Start watching after this substrate block.
  --interval-ms <n>     Poll interval. Default: 60000.
  --timeout-ms <n>      Stop after this many ms. Default: 0, no timeout.
  --once                Print one snapshot and exit.
  --exit-on-hit         Exit after the first new external call, claim, or proof.
`);
}

async function gql(endpoint, query, variables = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(data.errors || data).slice(0, 500)}`);
  }
  return data.data;
}

async function latestBlock(opts) {
  const data = await gql(
    opts.indexer,
    `query LatestBlock {
      allInteractions(first: 1, orderBy: SUBSTRATE_BLOCK_NUMBER_DESC) {
        nodes { substrateBlockNumber }
      }
    }`,
  );
  return Number(data.allInteractions.nodes[0]?.substrateBlockNumber || 0);
}

async function appMetric(opts) {
  const data = await gql(
    opts.indexer,
    `query AppMetric($id: String!) {
      appMetricById(id: $id) {
        integrationsIn
        integrationsOut
        messagesSent
        mentionCount
        postsActive
      }
    }`,
    { id: `${opts.program}:1` },
  );
  return data.appMetricById || null;
}

async function incomingSince(opts, sinceBlock) {
  const data = await gql(
    opts.indexer,
    `query Incoming($program: String!, $sinceBlock: Int!) {
      allInteractions(
        first: 50
        orderBy: SUBSTRATE_BLOCK_NUMBER_ASC
        filter: {
          substrateBlockNumber: { greaterThan: $sinceBlock }
          callee: { equalTo: $program }
        }
      ) {
        nodes {
          id
          substrateBlockNumber
          caller
          callerHandle
          callerKind
          method
          valuePaidRaw
        }
      }
    }`,
    { program: opts.program, sinceBlock },
  );

  const own = new Set([opts.operator.toLowerCase(), opts.program.toLowerCase()]);
  return data.allInteractions.nodes.filter((node) => !own.has(String(node.caller).toLowerCase()));
}

async function readStats(opts) {
  const { stdout } = await execFileAsync(
    'vara-wallet',
    [
      '--network',
      opts.network,
      '--json',
      'call',
      opts.program,
      'AanMissions/GetStats',
      '--args',
      '[]',
      '--idl',
      opts.idl,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  if (!parsed.result) throw new Error(`GetStats returned no result: ${stdout.slice(0, 300)}`);
  return parsed.result;
}

function statBig(stats, key) {
  return BigInt(stats?.[key] ?? '0');
}

function statsChanged(prev, next) {
  return (
    statBig(next, 'total_claims') > statBig(prev, 'total_claims') ||
    statBig(next, 'pending_proofs') > statBig(prev, 'pending_proofs') ||
    statBig(next, 'approved_proofs') > statBig(prev, 'approved_proofs') ||
    statBig(next, 'rejected_proofs') > statBig(prev, 'rejected_proofs')
  );
}

function short(hex) {
  return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
}

function summarizeCall(call) {
  const caller = call.callerHandle ? `@${call.callerHandle}` : short(call.caller);
  return `${caller} block=${call.substrateBlockNumber} method=${call.method || '?'} tx=${call.id.replace(/^interaction:/, '')}`;
}

function printSnapshot({ stats, metric, calls, sinceBlock }) {
  const parts = [
    new Date().toISOString(),
    `since=${sinceBlock}`,
    `incoming_external=${calls.length}`,
    `claims=${stats.total_claims}`,
    `pending=${stats.pending_proofs}`,
    `approved=${stats.approved_proofs}`,
    `remaining=${stats.rewards_remaining}`,
  ];
  if (metric) {
    parts.push(
      `metricIn=${metric.integrationsIn}`,
      `messages=${metric.messagesSent}`,
      `posts=${metric.postsActive}`,
    );
  }
  console.log(parts.join(' '));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let sinceBlock = opts.sinceBlock ?? await latestBlock(opts);
  let baselineStats = await readStats(opts);
  const baselineMetric = await appMetric(opts);
  const startedAt = Date.now();

  console.log(
    [
      'watching Mission Control',
      `program=${opts.program}`,
      `since=${sinceBlock}`,
      `intervalMs=${opts.intervalMs}`,
      baselineMetric ? `metricIn=${baselineMetric.integrationsIn}` : 'metricIn=?',
    ].join(' '),
  );

  while (true) {
    const calls = await incomingSince(opts, sinceBlock);
    const stats = await readStats(opts);
    const metric = await appMetric(opts);
    printSnapshot({ stats, metric, calls, sinceBlock });

    if (calls.length > 0 || statsChanged(baselineStats, stats)) {
      console.log('NEW_MISSION_SIGNAL');
      for (const call of calls) console.log(`- ${summarizeCall(call)}`);
      if (statsChanged(baselineStats, stats)) {
        console.log(
          `- stats claims ${baselineStats.total_claims}->${stats.total_claims}, ` +
          `pending ${baselineStats.pending_proofs}->${stats.pending_proofs}, ` +
          `approved ${baselineStats.approved_proofs}->${stats.approved_proofs}`,
        );
      }
      if (opts.exitOnHit) return;
      baselineStats = stats;
      if (calls.length > 0) {
        sinceBlock = Math.max(...calls.map((call) => Number(call.substrateBlockNumber)));
      }
    }

    if (opts.once) return;
    if (opts.timeoutMs > 0 && Date.now() - startedAt >= opts.timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
}

main().catch((err) => {
  console.error(`mission-control-watch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
