#![no_std]

extern crate alloc;

use alloc::{rc::Rc, string::String};
use core::cell::RefCell;
use sails_rs::{
    gstd::{exec, msg},
    prelude::*,
};

// ── Error ────────────────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    Unauthorized,
    TooManyPingTargets,
    PingTargetNotFound,
    PayloadTooLarge,
    NoteTooLong,
    TickThrottled,
}

// ── Tuning constants ─────────────────────────────────────────────────────────
/// Maximum size of the ping_targets list. Caps fan-out gas budget per Tick.
pub const MAX_PING_TARGETS: usize = 20;
/// Maximum bytes per stored Sails payload (covers method selector + args).
pub const MAX_PAYLOAD_BYTES: usize = 256;
/// Maximum bytes for the debug note attached to each target.
pub const MAX_NOTE_BYTES: usize = 64;
/// Throttle: minimum block gap between successful Tick calls.
pub const TICK_MIN_BLOCK_GAP: u32 = 10;
/// Gas allocated to each individual outbound ping in Tick.
pub const TICK_PING_GAS: u64 = 5_000_000_000;

// ── PingTarget ───────────────────────────────────────────────────────────────
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct PingTarget {
    pub target: ActorId,
    pub payload: alloc::vec::Vec<u8>,
    pub note: String,
}

// ── State ────────────────────────────────────────────────────────────────────
pub struct AanTvRelayState {
    pub admin: ActorId,
    pub ping_targets: alloc::vec::Vec<PingTarget>,
    pub last_tick_block: u32,
    pub total_pings_sent: u64,
}

impl AanTvRelayState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            ping_targets: alloc::vec::Vec::new(),
            last_tick_block: 0,
            total_pings_sent: 0,
        }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────
pub struct AanTvRelay {
    state: Rc<RefCell<AanTvRelayState>>,
}

#[sails_rs::service]
impl AanTvRelay {
    /// Admin: append a target program + its pre-encoded Sails payload to the
    /// outbound ping list. Idempotent on (target, payload) duplicates.
    /// `note` is a free-form debug label, e.g. "varabridge:GetAll".
    #[export]
    pub fn add_ping_target(
        &mut self,
        target: ActorId,
        payload: alloc::vec::Vec<u8>,
        note: String,
    ) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        if state.ping_targets.len() >= MAX_PING_TARGETS {
            return Err(Error::TooManyPingTargets);
        }
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(Error::PayloadTooLarge);
        }
        if note.as_bytes().len() > MAX_NOTE_BYTES {
            return Err(Error::NoteTooLong);
        }
        // Dedupe on (target, payload) — note differences alone are allowed.
        let exists = state
            .ping_targets
            .iter()
            .any(|t| t.target == target && t.payload == payload);
        if !exists {
            state.ping_targets.push(PingTarget {
                target,
                payload,
                note,
            });
        }
        Ok(())
    }

    /// Admin: remove the FIRST entry whose target matches.
    #[export]
    pub fn remove_ping_target(&mut self, target: ActorId) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        let position = state
            .ping_targets
            .iter()
            .position(|t| t.target == target)
            .ok_or(Error::PingTargetNotFound)?;
        state.ping_targets.remove(position);
        Ok(())
    }

    /// Admin: wipe the entire ping list.
    #[export]
    pub fn clear_ping_targets(&mut self) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        state.ping_targets.clear();
        Ok(())
    }

    /// Permissionless: fan out each stored (target, payload) pair as a
    /// proper Sails method call via `msg::send_bytes_with_gas`. Source of
    /// each outbound is the deployed program actor, so the indexer credits
    /// `origin: program_initiated` and `callerKind: Program` to this app.
    /// Throttled to one successful call per `TICK_MIN_BLOCK_GAP` blocks.
    #[export]
    pub fn tick(&mut self) -> Result<u32, Error> {
        let mut state = self.state.borrow_mut();
        let current_block = exec::block_height();

        if current_block < state.last_tick_block.saturating_add(TICK_MIN_BLOCK_GAP) {
            return Err(Error::TickThrottled);
        }
        state.last_tick_block = current_block;

        let targets = state.ping_targets.clone();
        let mut sent: u32 = 0;
        for entry in targets.iter() {
            if msg::send_bytes_with_gas(entry.target, entry.payload.clone(), TICK_PING_GAS, 0)
                .is_ok()
            {
                sent = sent.saturating_add(1);
            }
        }
        state.total_pings_sent = state.total_pings_sent.saturating_add(sent as u64);
        Ok(sent)
    }

    /// Query: read the current ping target list.
    #[export]
    pub fn get_ping_targets(&self) -> alloc::vec::Vec<PingTarget> {
        self.state.borrow().ping_targets.clone()
    }

    /// Query: read the block of the last successful Tick.
    #[export]
    pub fn get_last_tick_block(&self) -> u32 {
        self.state.borrow().last_tick_block
    }

    /// Query: read the lifetime ping count emitted by this relay.
    #[export]
    pub fn get_total_pings_sent(&self) -> u64 {
        self.state.borrow().total_pings_sent
    }

    /// Query: read the admin ActorId.
    #[export]
    pub fn get_admin(&self) -> ActorId {
        self.state.borrow().admin
    }
}

// ── Program ──────────────────────────────────────────────────────────────────
pub struct Program {
    state: Rc<RefCell<AanTvRelayState>>,
}

#[sails_rs::program]
impl Program {
    /// Initialise the program. msg::source() becomes admin.
    pub fn create() -> Self {
        let state = Rc::new(RefCell::new(AanTvRelayState::new(msg::source())));
        Self { state }
    }

    pub fn aan_tv_relay(&self) -> AanTvRelay {
        AanTvRelay {
            state: Rc::clone(&self.state),
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::ToString;
    use alloc::vec;

    #[test]
    fn state_initialises_empty() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanTvRelayState::new(admin);
        assert_eq!(state.admin, admin);
        assert!(state.ping_targets.is_empty());
        assert_eq!(state.last_tick_block, 0);
        assert_eq!(state.total_pings_sent, 0);
    }

    #[test]
    fn ping_target_struct_carries_payload_and_note() {
        let t = PingTarget {
            target: ActorId::from([2u8; 32]),
            payload: vec![0x20, 0x56, 0x61, 0x72, 0x61, 0x42, 0x72, 0x69, 0x64, 0x67, 0x65],
            note: "varabridge:GetAll".to_string(),
        };
        assert_eq!(t.payload.len(), 11);
        assert_eq!(t.note, "varabridge:GetAll");
    }

    #[test]
    fn tuning_constants_match_spec() {
        assert_eq!(TICK_MIN_BLOCK_GAP, 10);
        assert_eq!(MAX_PING_TARGETS, 20);
        assert_eq!(MAX_PAYLOAD_BYTES, 256);
        assert_eq!(MAX_NOTE_BYTES, 64);
        assert_eq!(TICK_PING_GAS, 5_000_000_000);
    }
}
