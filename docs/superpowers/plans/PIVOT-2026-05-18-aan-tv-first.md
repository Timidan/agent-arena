# Pivot addendum — AAN-TV becomes the primary product

**Date:** 2026-05-18 (day 0, after ecosystem scan)
**Supersedes:** Tasks 6–16 + Tasks 21–27 scope in [2026-05-18-agent-arena-aan-tv.md](2026-05-18-agent-arena-aan-tv.md)
**Driver:** Ecosystem scan revealed 34 registered apps, 11 identity cards, 38 announcements, 1163 chat messages in 7 days. Original "primitive in an empty network" thesis is dead; field is mature, integration economy is active, 5 game-shaped competitors already live, handle `agent-arena` already taken.

## What changes

### 1. APP_HANDLE: `agent-arena` → `aan-tv`

Original handle collided with program `0x88d21f05…7166` (a tic-tac-toe coordinator). Already swapped in [scripts/preflight-mainnet.sh](../../scripts/preflight-mainnet.sh).

### 2. Product framing flips

| Original framing | New framing |
|---|---|
| **AgentArena is the product**: full bracket tournament with commit-reveal dice. AAN-TV is a narrator add-on. | **AAN-TV is the product**: on-chain ESPN for the Vara Agent Network. Narrates ALL hackathon apps' events. The dice match is *one of many* events covered — a seed-content proof-of-format. |

### 3. Sails program: dramatically simpler

**Cut** (bracket logic was 60% of the original Sails LOC):
- `CreateTournament` (admin-spawned brackets)
- `StartCommit` / `StartReveal` (phase transitions)
- `AdvanceRound` (bracket promotion)
- 8-player bracket state with rounds

**Replaced with** (1v1 dice matches — anyone can open):
- `OpenMatch` — anyone pays 1 VARA to open a public dice challenge → emits `match_id`
- `AcceptMatch(match_id)` — anyone pays 1 VARA to accept the open challenge
- `Commit(match_id, hash)` — both parties submit hash(move, salt)
- `Reveal(match_id, move, salt)` — both reveal
- `Resolve(match_id)` — winner takes 90% of pot (1.8 VARA), 10% to protocol
- `Sweep(amount)` — admin pulls protocol cut

**Added** (this is what makes us a service, not just a game):
- `RequestCoverage(event_kind, target_program, hint)` — anyone pays 0.1 VARA to request AAN-TV cover a specific event. Returns `coverage_id`. Other apps will call this to get featured.
- `GetCoverageQueue(cursor, limit)` — read-only paginated queue read; off-chain bot polls this every 30s.
- `MarkCovered(coverage_id, chat_msg_id)` — admin-only: bot calls this after posting the narrated chat message, recording the on-chain receipt.

**LOC estimate:** ~400 (down from ~600 with brackets). Net SIMPLER.

### 4. Off-chain commentator: much richer

**Original scope:** subscribe to OUR program's events, narrate dice matches.

**New scope:**
- **Multi-source event router**: subscribes to allInteractions on the entire Vara A2A network (not just `aan-tv`'s program_id). Filters interesting events:
  - Match resolutions (ours + any other game program)
  - Market resolutions (`hy4-predict-app`, etc.)
  - Bounty completions (`infinite-bounty-v3`)
  - High-volume calls (whales)
  - New app launches (Registry/RegisterApplication events)
- **LLM narration via Claude Haiku 4.5**: was nice-to-have, now must-have. Templates as fallback.
- **Coverage queue polling**: paid `RequestCoverage` requests get priority. Reads via our own GetCoverageQueue.
- **Daily digest post**: once per day, posts a board announcement summarizing the day's top 5 events with @mentions.
- **Self-loop guard**: same as before, never narrate events sourced from our operator wallet.

### 5. Bootstrap strategy: post bounty + integrate with bounty board

**Original:** recruit hackathon entrants to play dice tournaments (manual).

**New (active integration economy):**
- **Day 1**: post a 5 VARA bounty on `infinite-bounty-v3` (PID `0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8`) — "5 VARA to any agent that calls AAN-TV's RequestCoverage method." This is BOTH outgoing-integration (bumps our `integrationsOut`) AND inbound-bait (anyone claiming the bounty bumps our `integrationsIn`).
- **Day 1**: post in chat tagging `@zeeast-casino` accepting their free mutual integration offer. Their identity card explicitly says: *"Free mutual integration (counts as integrationsIn for both sides)"*.
- **Days 2–13**: AAN-TV running daily means we automatically `integrationsOut` everywhere we narrate. Every featured app sees their `mentionCount` rise and often reciprocates by mentioning us.

### 6. Track decision

Stays **Open/Creative**. The product is "experimental broadcast service" — Open is the correct semantic match. Open also has lighter competition in the scan (2 apps observed in initial 20 sampled).

## Revised task list (replaces Tasks 6–27 of original plan)

### Sails program (Tasks 6–16, revised)
- **Task 6** — Scaffold via `vara-skills:sails-new-app` (unchanged)
- **Task 7** — Error enum (cut variants: `BracketFull`; keep `Unauthorized`, `InsufficientPayment`, `MatchNotFound`, `WrongPhase`, `DuplicateCommit`, `RevealMismatch`, `DeadlinePassed`, `DeadlineNotReached`, `ArithmeticOverflow`, `RefundFailed`; **add**: `CoverageNotFound`, `AlreadyCovered`)
- **Task 8** — Match state + Coverage state (replaces Tournament)
- **Task 9** — OpenMatch (TDD, value-guard + refund pattern)
- **Task 10** — AcceptMatch (TDD)
- **Task 11** — Commit (TDD)
- **Task 12** — Reveal (TDD)
- **Task 13** — Resolve + payout (TDD)
- **Task 14** — RequestCoverage (TDD)
- **Task 15** — GetCoverageQueue + MarkCovered (TDD)
- **Task 16** — Sweep + read_state (TDD)

### Bot (Tasks 21–27, revised)
- **Task 21** — Scaffold TS bot (unchanged)
- **Task 22** — Self-loop guard (unchanged)
- **Task 23** — Template narrator (extended to cover bounty/market/launch events)
- **Task 24** — Indexer client (extended: fetch interactions across ALL programs, not just ours; add resolveHandle batch)
- **Task 25** — Chat/Post wrapper (unchanged)
- **Task 26** — Watcher loop (extended: event-type router, coverage-queue poller)
- **Task 27** — End-to-end test post (unchanged)
- **Task 27.5 NEW** — LLM narration via Claude Haiku 4.5 (was nice-to-have, now must-have)
- **Task 27.6 NEW** — Daily-digest cron — once per day, summarize top events to Board

### Bootstrap (Tasks 28–31, partially revised)
- **Task 28** — Daily-event spawn cron — runs an `OpenMatch` once a day if no open matches exist (unchanged form, smaller scope)
- **Task 29** — Commentator systemd service (unchanged)
- **Task 30** — **REVISED**: post 5 VARA bounty on `infinite-bounty-v3` for "first 5 agents to call AAN-TV/RequestCoverage" + chat post tagging `@zeeast-casino` accepting their integration offer
- **Task 31** — First proof-of-life: open match + cover one external event + clear Mission Brief floor

### Tasks 32–40 unchanged in concept (UI, demo, submission), but UI shows the broader feed.

## Identity card content (for Task 20)

```json
{
  "who_i_am": "AAN-TV — the on-chain ESPN for the Vara Agent Network. Covers matches, markets, bounties, and launches across every registered app.",
  "what_i_do": "Watch chain activity across all hackathon apps. Post narrated highlights to Chat (authored as Application). Tag involved agents with @mentions. Run one dice-match daily as seed coverage.",
  "how_to_interact": "Pay 0.1 VARA to RequestCoverage(event_kind, target_program, hint) and AAN-TV will post a narrated highlight referencing your app, tagging the involved handles. Or play the daily dice match: OpenMatch / AcceptMatch with 1 VARA buy-in.",
  "what_i_offer": "Free visibility and mention-count for any app whose events we narrate organically. Paid priority coverage via RequestCoverage. A reliable daily content loop that survives past Season 1.",
  "tags": ["broadcast", "narration", "coverage", "tournament", "open-creative", "season-1"]
}
```

## Why this should still win Open/Creative

1. **Originality** — nobody else is doing event-driven narration with @mentions across the whole network. `varapulse` posts scheduled market summaries. `varabridge` posts scheduled prices. Neither does targeted "highlight reel" narration of other apps' on-chain events.
2. **Network Utility** — we make every app we cover more visible. Other apps WANT this. (Demonstrated by zeeast-casino offering free integration.)
3. **Quality of Integrations** — `integrationsIn` from `RequestCoverage` payers + `integrationsOut` to every app we narrate. Two-sided composability.
4. **Post-season durability** — narration is timeless; cron + LLM keeps running.
5. **Demo readiness** — 60-sec demo shows live chain event → AAN-TV narration → @mentions cascading → metrics ticking. Same wow-moment as before but now with multiple apps in frame, not just two players.

## What goes into the original plan vs. this addendum

This document supersedes Tasks 6–16 and Tasks 21–27 only. Everything else in the original plan stands: phases, calendar, deploy procedure (just with new handle), demo flow, submission steps. Subagents should be given the relevant task text from EITHER document depending on which is current for the task number.
