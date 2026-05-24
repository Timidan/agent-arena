# Mission Control Launch Runbook

Date: 2026-05-24

Mission Control is not live until `programs/aan-missions` is deployed and
`MISSION_PROGRAM_HEX` is configured. This runbook keeps every step before that
deployment gate read-only.

## 1. No-write predeploy check

Run this from the repo root:

```bash
scripts/mission-control-predeploy.sh
```

The script runs release gtests, checks the generated Mission Control IDLs, runs
a `vara-wallet program upload --dry-run`, prints artifact hashes, and checks the
operator wallet balance. It does not upload code, transfer VARA, create
missions, start services, or enable approval writes.

Expected hard gates:

- `programs/aan-missions` release gtests pass.
- `aan_missions.opt.wasm` and `aan_missions.idl` exist under
  `programs/aan-missions/target/wasm32-gear/release/`.
- `programs/aan-missions/client/aan_missions_client.idl` matches the build IDL.
- `commentator/idls/aan_missions_client.idl` matches the generated client IDL.
- `MISSION_VERIFIER_APPROVALS_ENABLED` is not `true`.
- The upload dry run says `willSubmit:false`.

## 2. Deployment command

Only run this after explicit approval to spend VARA:

```bash
vara-wallet --network mainnet --account agent-arena \
  program upload programs/aan-missions/target/wasm32-gear/release/aan_missions.opt.wasm \
  --idl programs/aan-missions/target/wasm32-gear/release/aan_missions.idl \
  --init Create
```

Capture the returned `programId` as `MISSION_PROGRAM_HEX`.

Immediately verify the deployed interface:

```bash
vara-wallet --network mainnet discover "$MISSION_PROGRAM_HEX" \
  --idl programs/aan-missions/target/wasm32-gear/release/aan_missions.idl

vara-wallet --network mainnet call "$MISSION_PROGRAM_HEX" AanMissions/GetStats \
  --args '[]' \
  --idl programs/aan-missions/target/wasm32-gear/release/aan_missions.idl
```

## 3. Configure read-only runtime

On the VM, set:

```bash
MISSION_PROGRAM_HEX=0x...
MISSION_IDL=./idls/aan_missions_client.idl
MISSION_VERIFIER_ENABLED=false
MISSION_VERIFIER_APPROVALS_ENABLED=false
MISSION_VERIFIER_POST_HIGHLIGHTS=false
MAX_DAILY_MISSION_VERIFIER_CALLS=0
MISSION_VERIFIER_ESTIMATED_SPEND_RAW=0
```

Then run the no-write probe:

```bash
cd /home/agent/agent-arena/commentator
npm run mission:verify:read-only
```

This evaluates pending proofs, if any, but forces approvals and highlight posts
off for that one run.

Do not enable `aan-missions-verifier.service` until the read-only probe is
clean against the deployed program.

## 4. Dashboard config

Set the dashboard env vars after deployment:

```bash
NEXT_PUBLIC_MISSION_PROGRAM_HEX=0x...
NEXT_PUBLIC_MISSION_VERIFIER_MODE=read-only
NEXT_PUBLIC_MISSION_REWARD_BUDGET_VARA=250
NEXT_PUBLIC_MISSION_DAILY_REWARD_CAP_VARA=25
NEXT_PUBLIC_MISSION_MAX_REWARD_VARA=5
```

The UI must show `program live` only after the deployed program id is present.

## 5. First mission creation flow

Estimate every mission before sending it. Use raw units for attached reward
pools. For example, a 2 VARA reward with 10 approval slots needs
`20000000000000` raw planck attached.

Generate the first mission payloads after `MISSION_PROGRAM_HEX` is known:

```bash
scripts/mission-control-bootstrap.mjs --program "$MISSION_PROGRAM_HEX"
```

The script writes args files under `.mission-control/seed-missions/`, prints the
total reward pool, and prints one no-write `--estimate` command per mission.
It does not submit `CreateMission`.

Run estimates for all first missions:

```bash
scripts/mission-control-bootstrap.mjs --program "$MISSION_PROGRAM_HEX" --estimate
```

For the staged first launch, generate and estimate only M1/M2 first:

```bash
scripts/mission-control-bootstrap.mjs \
  --program "$MISSION_PROGRAM_HEX" \
  --mission M1 \
  --mission M2

scripts/mission-control-bootstrap.mjs \
  --program "$MISSION_PROGRAM_HEX" \
  --mission M1 \
  --mission M2 \
  --estimate
```

If the estimates succeed and the mission set is still desired, send the printed
commands one by one without `--estimate`. Start with M1/M2 before funding the
full launch set. The bootstrap script validates mission templates against the
contract's title, instruction, action, reward, and approval-count limits before
it writes any args files.

The initial mission templates live in
`ui/lib/mission-templates.json`, which is also used by the dashboard. Each
template includes `maxParticipantValueRaw`; keep first-launch missions at
0-0.1 VARA attached by the claimant. Mission Control stores this as
`max_participant_value`, and the verifier rejects proof transactions whose
indexed `valuePaidRaw` exceeds it.

The staged first set should stay cheap for other bots:

- M1: `AanMissions/ClaimMission`, 0 VARA attached.
- M2: `AanTvBoard/Sign`, 0 VARA attached.
- M3: registered non-AAN app call, 0 VARA attached.
- M4: `AanTvData/SubmitStat`, 0.01 VARA attached.
- M5: `AanTv/RequestCoverage`, 0.1 VARA attached.

## 6. Approval mode gate

Approval writes stay disabled until all of these are true:

- at least one real claimant has claimed a mission;
- `SubmitProof` creates a pending proof;
- `npm run mission:verify:read-only` finds the proof and prints the expected
  approve/reject/defer decision;
- the decision matches the indexer evidence manually;
- daily verifier call caps are set intentionally;
- the funded mission pool is small enough to tolerate one bad approval.

Only then set:

```bash
MISSION_VERIFIER_ENABLED=true
MISSION_VERIFIER_APPROVALS_ENABLED=true
MAX_DAILY_MISSION_VERIFIER_CALLS=<small positive cap>
```

Start with read-only service operation or one-shot runs before enabling a
long-running approval service.
