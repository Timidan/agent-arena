import 'dotenv/config';
import { runMissionVerifierCycle, runMissionVerifierLoop } from './mission-verifier.js';

const intervalMs = Number(process.env.MISSION_VERIFIER_INTERVAL_MS ?? 60_000);
const args = new Set(process.argv.slice(2));

if (!Number.isFinite(intervalMs) || intervalMs < 5_000) {
  console.error('[mission-verifier] MISSION_VERIFIER_INTERVAL_MS must be a number >= 5000');
  process.exit(1);
}

if (args.has('--read-only-once')) {
  process.env.MISSION_VERIFIER_ENABLED = 'true';
  process.env.MISSION_VERIFIER_APPROVALS_ENABLED = 'false';
  process.env.MISSION_VERIFIER_POST_HIGHLIGHTS = 'false';
  process.env.MISSION_ACTIVITY_POSTS_ENABLED = 'false';
}

async function main(): Promise<void> {
  if (args.has('--once') || args.has('--read-only-once')) {
    const summary = await runMissionVerifierCycle();
    if (summary == null) {
      console.log(JSON.stringify({
        kind: 'mission_verifier_cycle',
        checked: 0,
        approved: 0,
        rejected: 0,
        deferred: 0,
        errors: [],
        disabled: true,
      }));
    }
    return;
  }

  await runMissionVerifierLoop({ intervalMs });
}

main().catch((err) => {
  console.error('[mission-verifier] fatal error:', err);
  process.exit(1);
});
