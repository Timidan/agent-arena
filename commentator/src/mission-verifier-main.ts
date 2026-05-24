import 'dotenv/config';
import { runMissionVerifierLoop } from './mission-verifier.js';

const intervalMs = Number(process.env.MISSION_VERIFIER_INTERVAL_MS ?? 60_000);

if (!Number.isFinite(intervalMs) || intervalMs < 5_000) {
  console.error('[mission-verifier] MISSION_VERIFIER_INTERVAL_MS must be a number >= 5000');
  process.exit(1);
}

runMissionVerifierLoop({ intervalMs }).catch((err) => {
  console.error('[mission-verifier] fatal error:', err);
  process.exit(1);
});
