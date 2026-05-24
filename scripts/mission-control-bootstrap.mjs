#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const templatesPath = path.join(root, 'ui/lib/mission-templates.json');
const defaultEnvFile = path.join(root, 'commentator/.env');
const defaultOutDir = path.join(root, '.mission-control/seed-missions');

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_DEADLINE_OFFSET_BLOCKS = 300_000;

const FALLBACKS = {
  AAN_TV_BOARD_HEX: '0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d',
  VARABRIDGE_HEX: '0xfb7ed5a79dc2ff15283a524a4489321b5e1f6341db2b9892be83b9568cc1fcb4',
};

function usage() {
  console.log(`usage: scripts/mission-control-bootstrap.mjs [options]

Generates first-mission CreateMission argument files and optional gas estimates.
This script never submits CreateMission calls.

Options:
  --program <hex>            Deployed Mission Control program id.
  --env-file <path>          Env file to read. Default: commentator/.env
  --out-dir <path>           Output directory. Default: .mission-control/seed-missions
  --deadline-block <number>  Use an exact deadline block.
  --deadline-offset <blocks> Offset from current indexer tip. Default: 300000
  --estimate                 Run vara-wallet --estimate for each CreateMission call.
  -h, --help                 Show this help.
`);
}

function parseArgs(argv) {
  const opts = {
    envFile: defaultEnvFile,
    outDir: defaultOutDir,
    deadlineBlock: null,
    deadlineOffset: DEFAULT_DEADLINE_OFFSET_BLOCKS,
    estimate: false,
    programHex: process.env.MISSION_PROGRAM_HEX ?? '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--program':
        opts.programHex = argv[++i] ?? '';
        break;
      case '--env-file':
        opts.envFile = path.resolve(argv[++i] ?? '');
        break;
      case '--out-dir':
        opts.outDir = path.resolve(argv[++i] ?? '');
        break;
      case '--deadline-block':
        opts.deadlineBlock = Number(argv[++i]);
        break;
      case '--deadline-offset':
        opts.deadlineOffset = Number(argv[++i]);
        break;
      case '--estimate':
        opts.estimate = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (opts.deadlineBlock != null && !Number.isSafeInteger(opts.deadlineBlock)) {
    throw new Error('--deadline-block must be an integer');
  }
  if (!Number.isSafeInteger(opts.deadlineOffset) || opts.deadlineOffset <= 0) {
    throw new Error('--deadline-offset must be a positive integer');
  }

  return opts;
}

function loadEnvFile(file) {
  const env = {};
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return env;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = normalized.indexOf('=');
    if (eq === -1) continue;

    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }

  return env;
}

function mergedEnv(envFile) {
  return { ...loadEnvFile(envFile), ...process.env };
}

async function fetchChainTip(endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query ChainTip {
        allInteractions(first: 1, orderBy: SUBSTRATE_BLOCK_NUMBER_DESC) {
          nodes { substrateBlockNumber }
        }
      }`,
    }),
  });

  if (!response.ok) {
    throw new Error(`indexer returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const tip = Number(data?.data?.allInteractions?.nodes?.[0]?.substrateBlockNumber ?? 0);
  if (!Number.isSafeInteger(tip) || tip <= 0) {
    throw new Error('indexer did not return a chain tip block');
  }
  return tip;
}

function refValue(ref, env, programHex) {
  if (ref == null) return null;
  if (ref === 'MISSION_PROGRAM_HEX') return programHex;
  return env[ref] ?? FALLBACKS[ref] ?? '';
}

function validateHex(value, label) {
  if (!HEX_32.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed 32-byte hex value`);
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatVara(raw) {
  const planck = BigInt(raw);
  const whole = planck / 1_000_000_000_000n;
  const frac = planck % 1_000_000_000_000n;
  if (frac === 0n) return `${whole}`;
  return `${whole}.${frac.toString().padStart(12, '0').replace(/0+$/, '')}`;
}

function buildMission(template, env, programHex, deadlineBlock) {
  const targetProgram = refValue(template.targetProgramRef, env, programHex);
  if (targetProgram != null) {
    validateHex(targetProgram, `${template.id} targetProgram`);
  }

  const rewardRaw = BigInt(template.rewardRaw);
  const maxApprovals = BigInt(template.maxApprovals);
  const poolRaw = rewardRaw * maxApprovals;

  const input = {
    title: template.title,
    instructions: template.instructions,
    target_program: targetProgram,
    required_action: template.requiredAction,
    reward: template.rewardRaw,
    max_approvals: template.maxApprovals,
    deadline_block: deadlineBlock,
  };

  return {
    ...template,
    targetProgram,
    poolRaw: poolRaw.toString(),
    args: [input],
    fileName: `${template.id.toLowerCase()}-${slug(template.title)}.json`,
  };
}

function printTable(missions) {
  console.log('| ID | Mission | Target | Reward | Slots | Pool |');
  console.log('| --- | --- | --- | ---: | ---: | ---: |');
  for (const mission of missions) {
    console.log(
      `| ${mission.id} | ${mission.title} | ${mission.target} | ` +
      `${formatVara(mission.rewardRaw)} VARA | ${mission.maxApprovals} | ` +
      `${formatVara(mission.poolRaw)} VARA |`,
    );
  }
}

function estimateMission({ mission, programHex, idl, account, network }) {
  const args = [
    '--network', network,
    '--account', account,
    'call', programHex,
    'AanMissions/CreateMission',
    '--args-file', mission.outputPath,
    '--idl', idl,
    '--value', mission.poolRaw,
    '--units', 'raw',
    '--estimate',
  ];

  console.log(`\nEstimating ${mission.id}...`);
  execFileSync('vara-wallet', args, { stdio: 'inherit' });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = mergedEnv(opts.envFile);
  const programHex = opts.programHex || env.MISSION_PROGRAM_HEX || '';
  validateHex(programHex, 'MISSION_PROGRAM_HEX');

  const endpoint = env.INDEXER_GRAPHQL_URL ?? 'https://agents-api.vara.network/graphql';
  const network = env.VARA_NETWORK ?? 'mainnet';
  const account = env.ACCT ?? 'agent-arena';
  const idl = path.join(root, 'programs/aan-missions/target/wasm32-gear/release/aan_missions.idl');
  const deadlineBlock = opts.deadlineBlock ?? (await fetchChainTip(endpoint)) + opts.deadlineOffset;
  const templates = JSON.parse(readFileSync(templatesPath, 'utf8'));
  const missions = templates.map((template) => buildMission(template, env, programHex, deadlineBlock));

  mkdirSync(opts.outDir, { recursive: true });
  for (const mission of missions) {
    mission.outputPath = path.join(opts.outDir, mission.fileName);
    writeFileSync(mission.outputPath, `${JSON.stringify(mission.args, null, 2)}\n`);
  }

  const totalPoolRaw = missions.reduce((sum, mission) => sum + BigInt(mission.poolRaw), 0n);

  console.log('Mission Control bootstrap payloads');
  console.log(`program:  ${programHex}`);
  console.log(`deadline: ${deadlineBlock}`);
  console.log(`out dir:  ${opts.outDir}`);
  console.log(`total pool: ${formatVara(totalPoolRaw.toString())} VARA`);
  console.log();
  printTable(missions);

  console.log('\nEstimate commands, no writes:');
  for (const mission of missions) {
    console.log(
      `vara-wallet --network ${network} --account ${account} ` +
      `call ${programHex} AanMissions/CreateMission ` +
      `--args-file ${mission.outputPath} --idl ${idl} ` +
      `--value ${mission.poolRaw} --units raw --estimate`,
    );
  }

  if (opts.estimate) {
    for (const mission of missions) {
      estimateMission({ mission, programHex, idl, account, network });
    }
  }

  console.log('\nNo CreateMission calls were submitted.');
}

main().catch((err) => {
  console.error(`FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
