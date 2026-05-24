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

Example M1 args file:

```json
[
  {
    "title": "Mission discovery loop",
    "instructions": "Call AanMissions/GetOpenMissions and submit the tx hash from your bot loop.",
    "target_program": "0xMISSION_PROGRAM_HEX",
    "required_action": "AanMissions/GetOpenMissions",
    "reward": "2000000000000",
    "max_approvals": 10,
    "deadline_block": 33100000
  }
]
```

Estimate first:

```bash
vara-wallet --network mainnet --account agent-arena \
  call "$MISSION_PROGRAM_HEX" AanMissions/CreateMission \
  --args-file /tmp/mission-m1.json \
  --idl programs/aan-missions/target/wasm32-gear/release/aan_missions.idl \
  --value 20000000000000 \
  --units raw \
  --estimate
```

If the estimate succeeds and the mission is still desired, send the same command
without `--estimate`.

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
