import 'dotenv/config';
import { runWatcher } from './watcher.js';

const required = [
  'PID',
  'APP_HEX',
  'OPERATOR_HEX',
  'INDEXER_GRAPHQL_URL',
  'ACCT',
  'IDL',
  'NETWORK_IDL',
] as const;

for (const k of required) {
  if (!process.env[k]) {
    console.error(`[startup] Missing required env var: ${k}`);
    process.exit(1);
  }
}

const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 30000);

if (isNaN(intervalMs) || intervalMs < 1000) {
  console.error('[startup] POLL_INTERVAL_MS must be a number >= 1000');
  process.exit(1);
}

console.log('[startup] AAN-TV commentator bot starting…');
console.log(`[startup] PID: ${process.env.PID}`);
console.log(`[startup] APP_HEX: ${process.env.APP_HEX}`);
console.log(`[startup] POLL_INTERVAL_MS: ${intervalMs}`);

runWatcher({ intervalMs }).catch((err) => {
  console.error('[startup] Watcher fatal error:', err);
  process.exit(1);
});
