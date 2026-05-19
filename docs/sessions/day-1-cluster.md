# Day 1 — 2026-05-19 — 3-Program Cluster Deploy

## Summary

Deployed 3 new Sails programs (board → tip → data) taking the operator from 1 to 4 programs.

## Deploy artifacts

### aan-tv-board (Social track)

| Field | Value |
|---|---|
| APP_HEX | `0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d` |
| codeId | `0xb1dddeca1126b111d17347bf0a4d42ac912ea5bcf6a4f2c53329f51d12effbaf` |
| program upload txHash | `0x7267b4faed52f78a58a29bd5c02df5d652130cbf1a3180607cbad170e1828883` |
| program upload block | 33078053 |
| RegisterApplication txHash | `0x910e337242af3ba95f409531b8e4d9cc45b23dd03d468b079a2b229fd68c288e` |
| RegisterApplication block | 33078073 |
| SubmitApplication txHash | `0xfdd0aa3d57acd9205c2768b986820ef3e3e1c2eff14c0289e114e10eb6939150` |
| SubmitApplication block | 33078079 |
| SetIdentityCard txHash | `0x71a00c42449b4e45b97b425b3a05d8dbca3739782ea16b06d09ae9e1d5d626c8` |
| SetIdentityCard block | 33078091 |

### aan-tv-tip (Economy track)

| Field | Value |
|---|---|
| APP_HEX | `0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02` |
| program upload txHash | `0xbe697625e74bd08befa282f6e14b18418e4044d3a73b5ec27f247d2159357c3a` |
| program upload block | 33078097 |
| RegisterApplication txHash | `0x820ef1049c39d0a96e58f4c6d79db8dfadd019c50f7aa6b6c53f855aff18ba7f` |
| RegisterApplication block | 33078110 |
| SubmitApplication txHash | `0xe5ca1464b024a1e4e45f26e7e5d84f1fd5cc716f9807b498e3d94b942c7fac31` |
| SubmitApplication block | 33078114 |
| SetIdentityCard txHash | `0x1aec5f6b1a40ad6bda6118636ac5754fc1d1ca80ce2f0bd85eee40ce0852c571` |
| SetIdentityCard block | 33078205 |

### aan-tv-data (Services track)

| Field | Value |
|---|---|
| APP_HEX | `0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c` |
| program upload txHash | `0x38d38becc78b8ce2c01c571b0ea80dd9dd6b4a14ba00d031947c820f93dce9c4` |
| program upload block | 33078169 |
| RegisterApplication txHash | `0xad99e60fa46900ef0caf03ae45d8e772e77a75cafc7b8a7838bc33330c87cc06` |
| RegisterApplication block | 33078182 |
| SubmitApplication txHash | `0x76b5d85424d1598b84a012cdb0b22aa0c2aebc91cf20f08f0f6083b374890d5f` |
| SubmitApplication block | 33078187 |
| SetIdentityCard txHash | `0x52bb93c661e9b248bfd0a2afffca020e6fa9e52a31f1315824cd44548d2c2aac` |
| SetIdentityCard block | 33078193 |

## Indexer confirmation (post-deploy)

```json
{
  "data": {
    "allApplications": {
      "nodes": [
        { "handle": "aan-tv-board", "track": "Social",   "status": "Submitted" },
        { "handle": "aan-tv-tip",   "track": "Economy",  "status": "Submitted" },
        { "handle": "aan-tv",       "track": "Open",     "status": "Submitted" },
        { "handle": "aan-tv-data",  "track": "Services", "status": "Submitted" }
      ]
    }
  }
}
```

All identity cards confirmed via `identityCardById` on indexer.

## Test results

| Program | Tests | Result |
|---|---|---|
| aan-tv-board | 6 gtests | all green |
| aan-tv-tip | 6 gtests | all green |
| aan-tv-data | 4 gtests | all green |

## Wallet balance

- Before: 86.998 VARA
- After: 80.026 VARA
- Spent: ~6.97 VARA (within 6.5 VARA estimate — slight over due to gas spikes)

## Git commits

- `0311ee2` feat: vendor aan_tv_board.idl
- `b85a686` feat: vendor aan_tv_tip.idl
- `5a3860a` feat: vendor aan_tv_data.idl
- `ba3c891` feat: add 3 new Sails programs (board, tip, data)

## IDL URLs

- Board: https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/aan_tv_board.idl
- Tip:   https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/aan_tv_tip.idl
- Data:  https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/aan_tv_data.idl

## Notes

- `cargo sails new` had a crates.io 503 on tip+data; resolved by copying the board scaffold and patching all name references (src/lib.rs, client/src/lib.rs, all Cargo.toml files).
- `Error` type in gtests must be imported explicitly from the client crate (e.g. `use aan_tv_tip_client::Error`), not from the `aan_tv_tip::*` module glob.
- Tip identity card (Board/SetIdentityCard) had a ~2 min delay due to the 60s rate limit between Board writes.
- The first background-mode invocation of SetIdentityCard for tip appeared to stall in the output; re-ran directly after the rate-limit window and it succeeded.
