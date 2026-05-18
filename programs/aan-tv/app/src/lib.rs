#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String};
use core::cell::RefCell;
use sails_rs::{
    gstd::{msg, CommandReply},
    prelude::*,
};

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
