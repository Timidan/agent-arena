#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String};
use core::cell::RefCell;
use sails_rs::{
    gstd::{exec, msg, CommandReply},
    prelude::*,
};
use sha2::{Digest, Sha256};

// ── Type aliases ────────────────────────────────────────────────────────────
pub type MatchId = u64;
pub type CoverageId = u64;

// ── MatchState ───────────────────────────────────────────────────────────────
#[derive(
    Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq, Default,
)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum MatchState {
    #[default]
    Open,
    InCommit,
    InReveal,
    Resolved,
}

// ── CoverageKind ─────────────────────────────────────────────────────────────
#[derive(
    Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq,
)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum CoverageKind {
    MarketResolved,
    BountyCompleted,
    LaunchedApp,
    MatchSettled,
    Custom,
}

// ── Match ────────────────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Match {
    pub id: MatchId,
    pub player_a: ActorId,
    pub player_b: Option<ActorId>,
    pub commit_a: Option<[u8; 32]>,
    pub commit_b: Option<[u8; 32]>,
    pub reveal_a: Option<u8>,
    pub reveal_b: Option<u8>,
    pub winner: Option<ActorId>,
    pub pot: u128,
    pub commit_deadline_block: u32,
    pub reveal_deadline_block: u32,
    pub state: MatchState,
}

// ── CoverageRequest ──────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct CoverageRequest {
    pub id: CoverageId,
    pub requester: ActorId,
    pub event_kind: CoverageKind,
    pub target_program: Option<ActorId>,
    pub hint: String,
    pub paid: u128,
    pub posted_at_block: u32,
    pub chat_msg_id: Option<u64>,
}

// ── CoverageQueuePage ─────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct CoverageQueuePage {
    pub items: alloc::vec::Vec<CoverageRequest>,
    pub next_cursor: Option<CoverageId>,
}

// ── Error ────────────────────────────────────────────────────────────────────
#[derive(
    Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq,
)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    // Auth errors
    Unauthorized,
    // Payment errors
    InsufficientPayment,
    // Match lifecycle errors
    MatchNotFound,
    WrongPhase,
    DuplicateCommit,
    RevealMismatch,
    DeadlinePassed,
    DeadlineNotReached,
    // Coverage errors
    CoverageNotFound,
    AlreadyCovered,
    SelfCover,
    // Validation
    InvalidArg,
    // Arithmetic safety
    ArithmeticOverflow,
    // Payout failure
    RefundFailed,
}

// ── Service state (shared via Rc<RefCell<>>) ─────────────────────────────────
pub struct AanTvState {
    pub admin: ActorId,
    pub buy_in: u128,         // 1 VARA = 1_000_000_000_000 plancks
    pub protocol_bps: u16,    // 1000 = 10%
    pub coverage_fee: u128,   // 0.1 VARA = 100_000_000_000 plancks
    pub next_match_id: MatchId,
    pub next_coverage_id: CoverageId,
    pub matches: BTreeMap<MatchId, Match>,
    pub coverage_queue: BTreeMap<CoverageId, CoverageRequest>,
}

impl AanTvState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            buy_in: 1_000_000_000_000,
            protocol_bps: 1000,
            coverage_fee: 100_000_000_000,
            next_match_id: 1,
            next_coverage_id: 1,
            matches: BTreeMap::new(),
            coverage_queue: BTreeMap::new(),
        }
    }
}

// ── Service struct (holds Rc to shared state) ────────────────────────────────
pub struct AanTv {
    state: Rc<RefCell<AanTvState>>,
}

#[sails_rs::service]
impl AanTv {
    /// Open a new 1v1 dice match. Caller must attach at least `buy_in` VARA.
    ///
    /// Refund correctness (sails-rs 0.10.x):
    ///   - Overpayment: excess returned via `CommandReply::with_value(excess)`.
    ///   - Underpayment / any Err: full `value` returned via
    ///     `CommandReply::with_value(value)`.
    ///   DO NOT use `msg::send` for refunds — on Err paths in sails-rs 0.10,
    ///   outbound sends are NOT executed. `CommandReply::with_value` is the
    ///   only reliable refund primitive.
    #[export]
    pub fn open_match(&mut self) -> CommandReply<Result<MatchId, Error>> {
        let value = msg::value();
        let mut state = self.state.borrow_mut();
        let buy_in = state.buy_in;

        // Underpayment guard: full refund via reply.
        if value < buy_in {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(value);
        }

        let excess = value - buy_in;

        // Overflow-safe match ID allocation.
        let next = match state.next_match_id.checked_add(1) {
            Some(n) => n,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        let match_id = state.next_match_id;
        state.next_match_id = next;

        let new_match = Match {
            id: match_id,
            player_a: msg::source(),
            player_b: None,
            commit_a: None,
            commit_b: None,
            reveal_a: None,
            reveal_b: None,
            winner: None,
            pot: buy_in,
            commit_deadline_block: 0, // set on AcceptMatch
            reveal_deadline_block: 0, // set on AcceptMatch
            state: MatchState::Open,
        };

        state.matches.insert(match_id, new_match);

        // Refund excess (with_value(0) is a no-op for exact payment).
        CommandReply::new(Ok(match_id)).with_value(excess)
    }

    /// Accept an open 1v1 dice match as player_b. Caller must attach at least `buy_in` VARA.
    ///
    /// Refund correctness (sails-rs 0.10.x):
    ///   - Overpayment: excess returned via `CommandReply::with_value(excess)`.
    ///   - Underpayment / any Err: full `value` returned via
    ///     `CommandReply::with_value(value)`.
    ///   DO NOT use `msg::send` for refunds — on Err paths, outbound sends do
    ///   NOT fire. `CommandReply::with_value` is the only reliable refund primitive.
    #[export]
    pub fn accept_match(&mut self, match_id: MatchId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let caller = msg::source();
        let mut state = self.state.borrow_mut();
        let buy_in = state.buy_in;

        // Underpayment guard: full refund via reply.
        if value < buy_in {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(value);
        }

        let excess = value - buy_in;

        // Fetch match — full refund if not found.
        let m = match state.matches.get_mut(&match_id) {
            Some(m) => m,
            None => {
                return CommandReply::new(Err(Error::MatchNotFound)).with_value(value);
            }
        };

        // Phase guard: only Open matches can be accepted.
        if m.state != MatchState::Open {
            return CommandReply::new(Err(Error::WrongPhase)).with_value(value);
        }

        // Anti-self-accept: player_a cannot be their own opponent.
        if caller == m.player_a {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        // Overflow-safe pot accumulation.
        let new_pot = match m.pot.checked_add(buy_in) {
            Some(p) => p,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        // Set deadlines and transition state.
        // TUNED FOR DEMO: 30 blocks (~90 s at 3 s/block) for Commit window,
        // another 30 blocks for Reveal window. Production would use ~600 blocks
        // (30 min) for Commit and ~1200 blocks (60 min) for Reveal.
        let commit_deadline = exec::block_height() + 30;
        let reveal_deadline = commit_deadline + 30;

        m.player_b = Some(caller);
        m.pot = new_pot;
        m.commit_deadline_block = commit_deadline;
        m.reveal_deadline_block = reveal_deadline;
        m.state = MatchState::InCommit;

        // Refund excess (with_value(0) is a no-op for exact payment).
        CommandReply::new(Ok(())).with_value(excess)
    }

    /// Commit a SHA-256 commitment for the caller's move. Free — no msg::value required.
    ///
    /// Can only be called while the match is in `InCommit` state and before
    /// `commit_deadline_block`. Both players must commit before the phase
    /// auto-advances to `InReveal`.
    #[export]
    pub fn commit(&mut self, match_id: MatchId, commitment: [u8; 32]) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        let sender = msg::source();

        let m = match state.matches.get_mut(&match_id) {
            Some(m) => m,
            None => return Err(Error::MatchNotFound),
        };

        if m.state != MatchState::InCommit {
            return Err(Error::WrongPhase);
        }

        if exec::block_height() > m.commit_deadline_block {
            return Err(Error::DeadlinePassed);
        }

        if sender == m.player_a {
            if m.commit_a.is_some() {
                return Err(Error::DuplicateCommit);
            }
            m.commit_a = Some(commitment);
        } else if Some(sender) == m.player_b {
            if m.commit_b.is_some() {
                return Err(Error::DuplicateCommit);
            }
            m.commit_b = Some(commitment);
        } else {
            return Err(Error::Unauthorized);
        }

        // Auto-advance to InReveal once both players have committed.
        if m.commit_a.is_some() && m.commit_b.is_some() {
            m.state = MatchState::InReveal;
        }

        Ok(())
    }

    /// Reveal the preimage (`move_value`, `salt`) behind a prior commitment. Free — no msg::value.
    ///
    /// The contract verifies `SHA-256(move_value || salt) == stored_commitment`.
    /// On mismatch the caller receives `Err(RevealMismatch)` and may retry before
    /// the `reveal_deadline_block`. Resolve is handled separately (Task 11).
    #[export]
    pub fn reveal(&mut self, match_id: MatchId, move_value: u8, salt: [u8; 32]) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        let sender = msg::source();

        let m = match state.matches.get_mut(&match_id) {
            Some(m) => m,
            None => return Err(Error::MatchNotFound),
        };

        if m.state != MatchState::InReveal {
            return Err(Error::WrongPhase);
        }

        if exec::block_height() > m.reveal_deadline_block {
            return Err(Error::DeadlinePassed);
        }

        let expected_hash = Self::compute_commitment(move_value, &salt);

        if sender == m.player_a {
            if m.commit_a.is_none() {
                return Err(Error::WrongPhase);
            }
            if m.commit_a != Some(expected_hash) {
                return Err(Error::RevealMismatch);
            }
            m.reveal_a = Some(move_value);
        } else if Some(sender) == m.player_b {
            if m.commit_b.is_none() {
                return Err(Error::WrongPhase);
            }
            if m.commit_b != Some(expected_hash) {
                return Err(Error::RevealMismatch);
            }
            m.reveal_b = Some(move_value);
        } else {
            return Err(Error::Unauthorized);
        }

        Ok(())
    }

    /// Resolve a match after both players have revealed (or after the reveal deadline if only
    /// one player revealed). Pays the winner 90% of the pot; the remaining 10% stays in
    /// the program as protocol cut (retrievable by admin via `sweep`).
    ///
    /// Anyone may call Resolve — the caller pays only gas and receives nothing.
    ///
    /// Decision matrix:
    ///  1. Both revealed            → winner = higher mod-100 (ties go to player_a).
    ///  2. One revealed + deadline passed → revealer wins by default.
    ///  3. Neither revealed + deadline NOT passed → Err(DeadlineNotReached).
    ///  4. Neither revealed + deadline passed → Err(DeadlineNotReached).
    ///     FUTURE WORK: refund both players in case 4 (match abandoned).
    ///     Currently we treat it identically to case 3; a future migration can add
    ///     an `Err(MatchAbandoned)` variant and bilateral refund path.
    #[export]
    pub fn resolve(&mut self, match_id: MatchId) -> Result<ActorId, Error> {
        let mut state = self.state.borrow_mut();

        let m = match state.matches.get_mut(&match_id) {
            Some(m) => m,
            None => return Err(Error::MatchNotFound),
        };

        // Idempotent rejection: already resolved.
        if m.state == MatchState::Resolved {
            return Err(Error::WrongPhase);
        }

        // Must be in InReveal phase to settle.
        if m.state != MatchState::InReveal {
            return Err(Error::WrongPhase);
        }

        let player_a = m.player_a;
        let player_b = m.player_b.expect("InReveal requires player_b");

        let winner: ActorId = match (m.reveal_a, m.reveal_b) {
            (Some(ra), Some(rb)) => {
                // Both revealed: higher mod-100 wins; ties go to player_a.
                let a = (ra as u128) % 100;
                let b = (rb as u128) % 100;
                if b > a { player_b } else { player_a }
            }
            (Some(_), None) => {
                // Only player_a revealed; need deadline to have passed.
                if exec::block_height() <= m.reveal_deadline_block {
                    return Err(Error::DeadlineNotReached);
                }
                player_a
            }
            (None, Some(_)) => {
                // Only player_b revealed; need deadline to have passed.
                if exec::block_height() <= m.reveal_deadline_block {
                    return Err(Error::DeadlineNotReached);
                }
                player_b
            }
            (None, None) => {
                // Neither revealed. FUTURE WORK: refund both if deadline passed.
                // For MVP, return DeadlineNotReached in all cases.
                return Err(Error::DeadlineNotReached);
            }
        };

        let pot = m.pot;
        let protocol_bps = state.protocol_bps;

        // winner_cut = pot * (10_000 - protocol_bps) / 10_000
        // e.g. pot=2_000_000_000_000, bps=1000 → winner_cut=1_800_000_000_000
        let winner_cut = (pot * (10_000 - protocol_bps as u128)) / 10_000;

        // Settle the match before the outbound send so state is consistent.
        {
            let m = state.matches.get_mut(&match_id).expect("checked above");
            m.winner = Some(winner);
            m.state = MatchState::Resolved;
        }

        // Send winner their cut. Gas=0: the value transfer alone carries cost.
        // On gtest, this transfers `winner_cut` from program balance to winner.
        msg::send_bytes_with_gas(winner, sails_rs::Vec::new(), 0, winner_cut)
            .map_err(|_| Error::RefundFailed)?;

        Ok(winner)
    }

    /// Pull accumulated protocol fees to admin wallet.
    ///
    /// Only admin may call this. `amount` must not exceed the program's current
    /// balance minus the existential deposit or the underlying send will fail
    /// and propagate as `Err(RefundFailed)` — no special guard needed here.
    #[export]
    pub fn sweep(&mut self, amount: u128) -> Result<(), Error> {
        let admin = self.state.borrow().admin;
        if msg::source() != admin {
            return Err(Error::Unauthorized);
        }
        msg::send_bytes_with_gas(admin, sails_rs::Vec::new(), 0, amount)
            .map_err(|_| Error::RefundFailed)?;
        Ok(())
    }

    /// Read accessor: returns the `Match` for `match_id`, or `None` if absent.
    ///
    /// Used by off-chain clients and gtests to inspect match state without
    /// exposing the full program state. This is a partial Task 14 grab — it is
    /// load-bearing for Tasks 10 and 11 tests.
    #[export]
    pub fn get_match(&self, match_id: MatchId) -> Option<Match> {
        self.state.borrow().matches.get(&match_id).cloned()
    }

    /// Request coverage for an on-chain event. Caller must attach at least `coverage_fee` VARA.
    ///
    /// Refund correctness (sails-rs 0.10.x):
    ///   - Overpayment: excess returned via `CommandReply::with_value(excess)`.
    ///   - Any Err: full `value` returned via `CommandReply::with_value(value)`.
    ///   DO NOT use `msg::send` for refunds.
    #[export]
    pub fn request_coverage(
        &mut self,
        event_kind: CoverageKind,
        target_program: Option<ActorId>,
        hint: String,
    ) -> CommandReply<Result<CoverageId, Error>> {
        let value = msg::value();
        let caller = msg::source();
        let mut state = self.state.borrow_mut();
        let coverage_fee = state.coverage_fee;

        // Underpayment guard: full refund via reply.
        if value < coverage_fee {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(value);
        }

        let excess = value - coverage_fee;

        // Hint length guard: must be <= 240 UTF-8 bytes.
        if hint.as_bytes().len() > 240 {
            return CommandReply::new(Err(Error::InvalidArg)).with_value(value);
        }

        // Anti self-promotion: requester must not target themselves.
        if target_program == Some(caller) {
            return CommandReply::new(Err(Error::SelfCover)).with_value(value);
        }

        // Overflow-safe coverage ID allocation.
        let next = match state.next_coverage_id.checked_add(1) {
            Some(n) => n,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        let coverage_id = state.next_coverage_id;
        state.next_coverage_id = next;

        let entry = CoverageRequest {
            id: coverage_id,
            requester: caller,
            event_kind,
            target_program,
            hint,
            paid: coverage_fee, // record actual fee, not value — excess goes back via reply
            posted_at_block: exec::block_height(),
            chat_msg_id: None,
        };

        state.coverage_queue.insert(coverage_id, entry);

        // Refund excess (with_value(0) is a no-op for exact payment).
        CommandReply::new(Ok(coverage_id)).with_value(excess)
    }

    /// Read paginated coverage queue. Returns up to `limit` entries starting from `cursor`.
    ///
    /// Cursor semantics: `None` starts from ID 1; `Some(n)` starts from ID n.
    /// Bot uses `next_cursor` as the cursor for the next poll (incremental fetch).
    #[export]
    pub fn get_coverage_queue(
        &self,
        cursor: Option<CoverageId>,
        limit: u32,
    ) -> CoverageQueuePage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(100) as usize;

        let mut items = alloc::vec::Vec::new();
        for (&id, entry) in state.coverage_queue.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            items.push(entry.clone());
            let _ = id; // suppress unused warning — id used in range key
        }

        let next_cursor = if items.len() == limit {
            items.last().map(|e| e.id + 1)
        } else {
            None
        };

        CoverageQueuePage { items, next_cursor }
    }

    /// Mark a coverage entry as covered by recording the bot's chat message ID.
    ///
    /// Admin only. Append-only: never removes entries (invariant #7).
    #[export]
    pub fn mark_covered(&mut self, coverage_id: CoverageId, chat_msg_id: u64) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();

        // Auth guard: only admin may mark.
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }

        // Fetch entry or return CoverageNotFound.
        let entry = match state.coverage_queue.get_mut(&coverage_id) {
            Some(e) => e,
            None => return Err(Error::CoverageNotFound),
        };

        // Idempotent rejection: already marked.
        if entry.chat_msg_id.is_some() {
            return Err(Error::AlreadyCovered);
        }

        entry.chat_msg_id = Some(chat_msg_id);
        Ok(())
    }

    /// Private helper: compute SHA-256(move_value || salt).
    fn compute_commitment(move_value: u8, salt: &[u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update([move_value]);
        hasher.update(salt);
        let out = hasher.finalize();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&out);
        arr
    }
}

// ── Program ──────────────────────────────────────────────────────────────────
pub struct Program {
    state: Rc<RefCell<AanTvState>>,
}

#[sails_rs::program]
impl Program {
    /// Initialise the program. `msg::source()` becomes admin.
    pub fn create() -> Self {
        let state = Rc::new(RefCell::new(AanTvState::new(msg::source())));
        Self { state }
    }

    /// Service accessor. Returns a fresh AanTv view sharing program state.
    pub fn aan_tv(&self) -> AanTv {
        AanTv {
            state: self.state.clone(),
        }
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use sails_rs::scale_codec::{Decode, Encode};

    fn round_trip<T: Encode + Decode + PartialEq + core::fmt::Debug>(value: T) {
        let encoded = value.encode();
        let decoded = T::decode(&mut &encoded[..]).expect("decode must succeed");
        assert_eq!(value, decoded);
    }

    #[test]
    fn error_enum_round_trips_all_variants() {
        round_trip(Error::Unauthorized);
        round_trip(Error::InsufficientPayment);
        round_trip(Error::MatchNotFound);
        round_trip(Error::WrongPhase);
        round_trip(Error::DuplicateCommit);
        round_trip(Error::RevealMismatch);
        round_trip(Error::DeadlinePassed);
        round_trip(Error::DeadlineNotReached);
        round_trip(Error::CoverageNotFound);
        round_trip(Error::AlreadyCovered);
        round_trip(Error::SelfCover);
        round_trip(Error::InvalidArg);
        round_trip(Error::ArithmeticOverflow);
        round_trip(Error::RefundFailed);
    }

    #[test]
    fn match_state_defaults_are_sane() {
        let state = MatchState::default();
        assert_eq!(state, MatchState::Open);

        round_trip(MatchState::Open);
        round_trip(MatchState::InCommit);
        round_trip(MatchState::InReveal);
        round_trip(MatchState::Resolved);
    }

    #[test]
    fn coverage_kind_round_trips_all_variants() {
        round_trip(CoverageKind::MarketResolved);
        round_trip(CoverageKind::BountyCompleted);
        round_trip(CoverageKind::LaunchedApp);
        round_trip(CoverageKind::MatchSettled);
        round_trip(CoverageKind::Custom);
    }

    #[test]
    fn aan_tv_state_init_has_correct_defaults() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanTvState::new(admin);
        assert_eq!(state.admin, admin);
        assert_eq!(state.buy_in, 1_000_000_000_000);
        assert_eq!(state.protocol_bps, 1000);
        assert_eq!(state.coverage_fee, 100_000_000_000);
        assert_eq!(state.next_match_id, 1);
        assert_eq!(state.next_coverage_id, 1);
        assert!(state.matches.is_empty());
        assert!(state.coverage_queue.is_empty());
    }
}
