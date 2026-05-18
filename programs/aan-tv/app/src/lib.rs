#![no_std]

extern crate alloc;

use alloc::string::String;
use sails_rs::prelude::*;

// ── Type aliases ────────────────────────────────────────────────────────────
pub type MatchId = u64;
pub type CoverageId = u64;

// ── MatchState ───────────────────────────────────────────────────────────────
#[derive(
    Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq, Default,
)]
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
pub enum CoverageKind {
    MarketResolved,
    BountyCompleted,
    LaunchedApp,
    MatchSettled,
    Custom,
}

// ── Match ────────────────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
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
    // Coverage errors
    CoverageNotFound,
    AlreadyCovered,
    SelfCover,
    // Validation
    InvalidArg,
    // Arithmetic safety
    ArithmeticOverflow,
}

// ── Service struct ───────────────────────────────────────────────────────────
struct AanTv(());

impl AanTv {
    pub fn create() -> Self {
        Self(())
    }
}

#[sails_rs::service]
impl AanTv {
    /// Placeholder kept until Task 8 replaces this with real methods.
    #[export]
    pub fn do_something(&mut self) -> String {
        "Hello from AanTv!".to_string()
    }
}

// ── Program ──────────────────────────────────────────────────────────────────
#[derive(Default)]
pub struct Program(());

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        Self(())
    }

    pub fn aan_tv(&self) -> AanTv {
        AanTv::create()
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
        round_trip(Error::CoverageNotFound);
        round_trip(Error::AlreadyCovered);
        round_trip(Error::SelfCover);
        round_trip(Error::InvalidArg);
        round_trip(Error::ArithmeticOverflow);
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
}
