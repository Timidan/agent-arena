# AAN-TV Sails Program Spec

## Problem

The Vara A2A network has 34+ apps live and 1163+ chat messages in the past 7 days, but no purpose-built coverage layer. Apps that ship interesting events (matches, market resolutions, bounty completions) struggle to get organic visibility. Scheduled posters like `varapulse` and `varabridge` push their own content but don't react to other apps' state changes. As a result, apps farm `messagesSent` themselves and underuse the network-wide attention surface.

## User Goal

Two related user goals:

1. **As an app operator**, I want to pay AAN-TV a small fee to ensure my interesting on-chain events (a notable market resolution, a fresh launch, a milestone) get narrated to Chat with my @mention so the network notices.
2. **As a hackathon entrant**, I want to play a fast 1v1 dice match with verifiable randomness (commit-reveal) and win a real VARA pot — and have AAN-TV announce the result to the network for free.

## In Scope (MVP, ship by 2026-06-01)

- **Dice match (1v1)**: `OpenMatch` → `AcceptMatch` → `Commit` (both) → `Reveal` (both) → `Resolve` → auto-payout. 1 VARA buy-in per side; winner gets 90% of pot (1.8 VARA); 10% to protocol.
- **Coverage requests**: `RequestCoverage(event_kind, target_program, hint)` paid at 0.1 VARA; emits a queue entry. Read via `GetCoverageQueue`. Admin records bot's chat-message ID via `MarkCovered`.
- **Refund correctness**: every chargeable method returns `CommandReply<Result<T, E>>::with_value(refund)` on the Err path. No silent fund retention on errors.
- **Admin-only Sweep**: pull protocol cut to admin wallet.
- **Read state accessor**: `read_state` returns the full service state for off-chain bot consumption.

## Out of Scope (cut to fit 14-day window)

- Bracket/tournament structure (we are 1v1 only; bigger formats wait for v2)
- Coverage subscriptions (paid recurring access — RequestCoverage one-shot only)
- Multiple game modes (no RPS, no poker; just dice)
- ELO leaderboards (a simple win-count is enough)
- Multi-token support (VARA only)
- Spectator betting (dilutes scope; reintroduces refund complexity)
- Cross-program agent-to-agent calls (we expose state for others to read, not vice versa)

## Actors

- **Admin** — the operator wallet `0xc292ca12…2b10` (this project's owner). Can: create the program (init), Sweep protocol cuts, MarkCovered for the bot's chat-receipts. Cannot: arbitrate matches, refund unilaterally, freeze state.
- **Player** — any Vara wallet. Calls `OpenMatch` to open a public challenge or `AcceptMatch` to take one. Must follow Commit → Reveal within deadlines or forfeit.
- **Coverage requester** — any Vara wallet (typically another hackathon app's operator). Calls `RequestCoverage` to pay for narration of an event.
- **Off-chain commentator bot ("AAN-TV")** — polls `GetCoverageQueue` and chain-wide events, narrates via Claude Haiku LLM, posts to Chat as Application, then calls `MarkCovered` to close out paid requests. Runs as admin (operator wallet).

## State Changes

### Service state

```rust
pub struct AanTvService {
    pub admin: ActorId,
    pub buy_in: u128,                          // dice buy-in (1 VARA)
    pub protocol_bps: u16,                     // 1000 = 10% protocol cut
    pub coverage_fee: u128,                    // RequestCoverage price (0.1 VARA)
    pub next_match_id: MatchId,
    pub next_coverage_id: CoverageId,
    pub matches: BTreeMap<MatchId, Match>,
    pub coverage_queue: BTreeMap<CoverageId, CoverageRequest>,
}
```

### Match state

```rust
pub struct Match {
    pub id: MatchId,
    pub player_a: ActorId,
    pub player_b: Option<ActorId>,             // None until AcceptMatch
    pub commit_a: Option<[u8; 32]>,
    pub commit_b: Option<[u8; 32]>,
    pub reveal_a: Option<u8>,
    pub reveal_b: Option<u8>,
    pub winner: Option<ActorId>,
    pub pot: u128,
    pub commit_deadline_block: u32,            // set when both players present
    pub reveal_deadline_block: u32,
    pub state: MatchState,                     // Open | InCommit | InReveal | Resolved
}

pub enum MatchState { Open, InCommit, InReveal, Resolved }
```

### Coverage request

```rust
pub struct CoverageRequest {
    pub id: CoverageId,
    pub requester: ActorId,
    pub event_kind: CoverageKind,              // MarketResolved | BountyCompleted | LaunchedApp | MatchSettled | Custom
    pub target_program: Option<ActorId>,
    pub hint: String,                          // <= 240 chars; attacker-controlled
    pub paid: u128,
    pub posted_at_block: u32,
    pub chat_msg_id: Option<u64>,              // None until MarkCovered
}

pub enum CoverageKind { MarketResolved, BountyCompleted, LaunchedApp, MatchSettled, Custom }
```

## Messages and Replies

| Method | Args | Returns | Value (msg::value) | Caller |
|---|---|---|---|---|
| `OpenMatch` | `()` | `CommandReply<Result<MatchId, Error>>` | ≥ `buy_in` (1 VARA) | any wallet |
| `AcceptMatch` | `match_id: u64` | `CommandReply<Result<(), Error>>` | ≥ `buy_in` | any wallet (not player_a) |
| `Commit` | `match_id: u64, commitment: [u8; 32]` | `Result<(), Error>` | 0 | match's player_a or player_b |
| `Reveal` | `match_id: u64, move_value: u8, salt: [u8; 32]` | `Result<(), Error>` | 0 | match's player_a or player_b |
| `Resolve` | `match_id: u64` | `Result<ActorId, Error>` | 0 | any wallet (anyone can trigger settlement once both revealed or reveal deadline passed) |
| `RequestCoverage` | `event_kind: CoverageKind, target_program: Option<ActorId>, hint: String` | `CommandReply<Result<CoverageId, Error>>` | ≥ `coverage_fee` (0.1 VARA) | any wallet |
| `GetCoverageQueue` | `cursor: Option<CoverageId>, limit: u32` | `CoverageQueuePage` | 0 | any (read-only) |
| `MarkCovered` | `coverage_id: u64, chat_msg_id: u64` | `Result<(), Error>` | 0 | admin only |
| `Sweep` | `amount: u128` | `Result<(), Error>` | 0 | admin only |
| `read_state` | `()` | `AanTvState` | 0 | any (read-only) |

## Events

Emit on every state transition (via `sails::EventEmitter` or equivalent), so the indexer + off-chain bot pick them up:

| Event | Fields |
|---|---|
| `MatchOpened` | `match_id, player_a, buy_in` |
| `MatchAccepted` | `match_id, player_b, pot, commit_deadline_block, reveal_deadline_block` |
| `Committed` | `match_id, player` (no commitment hash in event — keeps it small) |
| `Revealed` | `match_id, player, move_value` |
| `MatchResolved` | `match_id, winner, pot_to_winner, protocol_cut` |
| `CoverageRequested` | `coverage_id, requester, event_kind, target_program, paid` |
| `CoverageMarked` | `coverage_id, chat_msg_id` |
| `Swept` | `amount` |

## Invariants

1. **Funds conservation** — for every match, total VARA in (buy-ins from both players) equals total VARA out (winner payout + protocol cut + any refunds). Tested by gtest balance-delta assertions on every test.
2. **No silent fund retention on Err** — every chargeable method (`OpenMatch`, `AcceptMatch`, `RequestCoverage`) returns full attached value via `CommandReply::with_value` on Err path. Tested by underpayment / wrong-phase / overflow tests.
3. **Commit binds reveal** — `Reveal` only accepts `(move_value, salt)` whose `SHA-256(move_value || salt) == commitment`. Wrong salt or wrong move → Err.
4. **Caller authorization** — `Commit` and `Reveal` only accept calls from `player_a` or `player_b`. `MarkCovered` and `Sweep` only accept calls from `admin`.
5. **Deadline monotonic** — `commit_deadline_block < reveal_deadline_block`. Resolve permits per-side default-win if one side missed the reveal window.
6. **Match-id and coverage-id monotonic, non-recycling** — `checked_add` on every increment; overflow returns `Error::ArithmeticOverflow` (and refunds).
7. **Coverage queue is append-only** — `RequestCoverage` only adds; `MarkCovered` only sets `chat_msg_id`; no entry is ever deleted. Bot can paginate forward indefinitely.
8. **No self-cover** — `RequestCoverage` rejects `requester == target_program` (anti self-promotion abuse).

## Edge Cases

- **`OpenMatch` overpayment**: refund excess via `CommandReply::with_value(excess)`.
- **`OpenMatch` underpayment**: full refund via `CommandReply::with_value(value)`, return `Err(InsufficientPayment)`.
- **`AcceptMatch` of a match that's no longer Open** (someone already accepted, or it was Resolved): full refund, return `Err(WrongPhase)`.
- **Player tries to Accept their own match**: refund, return `Err(Unauthorized)`.
- **Player commits twice for same match**: return `Err(DuplicateCommit)`.
- **Player reveals with wrong salt**: return `Err(RevealMismatch)`. Caller may re-call `Reveal` with correct salt before deadline.
- **Reveal after deadline**: return `Err(DeadlinePassed)`; opponent can `Resolve` and wins by default.
- **One player commits, opponent never commits, deadline passes**: `Resolve` after deadline gives the committing player the win.
- **Both players commit, both reveal, opponent's number > yours mod 100**: opponent wins. Ties go to `player_a`.
- **`Resolve` called twice**: second call returns `Err(WrongPhase)` (match.state == Resolved).
- **`RequestCoverage` with hint > 240 chars**: contract rejects with `Err(InvalidArg)`. (Add `InvalidArg` to Error enum.)
- **`MarkCovered` for non-existent coverage_id**: `Err(CoverageNotFound)`.
- **`MarkCovered` twice**: `Err(AlreadyCovered)`.

## Acceptance Criteria

Compiled IDL exposes 10 methods (9 above + `read_state`). All of these pass via `cargo test --release --test gtest`:

1. ✅ `error_enum_round_trips_via_idl`
2. ✅ `match_state_struct_defaults_are_sane`
3. ✅ `open_match_collects_buyin_into_pot`
4. ✅ `open_match_overpayment_refunds_excess`
5. ✅ `open_match_underpayment_full_refund_and_err`
6. ✅ `accept_match_self_rejected_with_full_refund`
7. ✅ `accept_match_after_resolve_rejected_with_full_refund`
8. ✅ `commit_stranger_rejected`
9. ✅ `commit_double_rejected`
10. ✅ `reveal_wrong_salt_rejected`
11. ✅ `reveal_after_deadline_default_loss`
12. ✅ `resolve_pays_winner_90_pct_and_protocol_10_pct`
13. ✅ `resolve_tie_goes_to_player_a`
14. ✅ `resolve_idempotent`
15. ✅ `request_coverage_collects_fee`
16. ✅ `request_coverage_self_target_rejected`
17. ✅ `request_coverage_long_hint_rejected`
18. ✅ `mark_covered_admin_only`
19. ✅ `mark_covered_double_rejected`
20. ✅ `sweep_admin_only`
21. ✅ `read_state_returns_full_state`
22. ✅ `funds_conservation_invariant_one_full_match`
23. ✅ `funds_conservation_invariant_after_sweep`

After all green: `vara-skills:sails-local-smoke` runs an end-to-end 1v1 match against a local node and verifies the winner balance delta is exactly 1.8 VARA.

Then deploy + register per Tasks 17–20 of the parent plan.
