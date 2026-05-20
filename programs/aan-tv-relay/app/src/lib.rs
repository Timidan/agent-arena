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
    InvalidGas,
}

// ── Tuning constants ─────────────────────────────────────────────────────────
pub const MAX_PING_TARGETS: usize = 20;
pub const MAX_PAYLOAD_BYTES: usize = 256;
pub const MAX_NOTE_BYTES: usize = 64;
pub const TICK_MIN_BLOCK_GAP: u32 = 10;
pub const DEFAULT_TICK_PING_GAS: u64 = 50_000_000_000;
pub const MIN_TICK_PING_GAS: u64 = 1_000_000_000;
pub const MAX_TICK_PING_GAS: u64 = 500_000_000_000;

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
    pub tick_ping_gas: u64,
}

impl AanTvRelayState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            ping_targets: alloc::vec::Vec::new(),
            last_tick_block: 0,
            total_pings_sent: 0,
            tick_ping_gas: DEFAULT_TICK_PING_GAS,
        }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────
pub struct AanTvRelay {
    state: Rc<RefCell<AanTvRelayState>>,
}

#[sails_rs::service]
impl AanTvRelay {
    /// Admin: append a target program + its pre-encoded Sails payload.
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

    /// Admin: tune per-ping gas at runtime so we don't need a redeploy
    /// to test 5B / 50B / 100B + values during diagnosis.
    #[export]
    pub fn set_tick_ping_gas(&mut self, gas: u64) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        if !(MIN_TICK_PING_GAS..=MAX_TICK_PING_GAS).contains(&gas) {
            return Err(Error::InvalidGas);
        }
        state.tick_ping_gas = gas;
        Ok(())
    }

    /// Permissionless: fan out each stored (target, payload) pair as a proper
    /// Sails method call via `msg::send_bytes_with_gas`, using the
    /// admin-tunable `tick_ping_gas` for each outbound. Source of each
    /// outbound is this deployed program actor.
    #[export]
    pub fn tick(&mut self) -> Result<u32, Error> {
        let mut state = self.state.borrow_mut();
        let current_block = exec::block_height();

        if current_block < state.last_tick_block.saturating_add(TICK_MIN_BLOCK_GAP) {
            return Err(Error::TickThrottled);
        }
        state.last_tick_block = current_block;

        let targets = state.ping_targets.clone();
        let gas = state.tick_ping_gas;
        let mut sent: u32 = 0;
        for entry in targets.iter() {
            if msg::send_bytes_with_gas(entry.target, entry.payload.clone(), gas, 0).is_ok() {
                sent = sent.saturating_add(1);
            }
        }
        state.total_pings_sent = state.total_pings_sent.saturating_add(sent as u64);
        Ok(sent)
    }

    /// Admin diagnostic: fire ONE ad-hoc outbound to any target with chosen
    /// gas and payload. Bypasses the ping_targets list and the throttle.
    /// Use this to isolate "is the issue at the receiver, at the gas level,
    /// or in the indexer" without burning the tick state.
    #[export]
    pub fn diag_ping(
        &mut self,
        target: ActorId,
        payload: alloc::vec::Vec<u8>,
        gas: u64,
    ) -> Result<(), Error> {
        let state = self.state.borrow();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        if !(MIN_TICK_PING_GAS..=MAX_TICK_PING_GAS).contains(&gas) {
            return Err(Error::InvalidGas);
        }
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(Error::PayloadTooLarge);
        }
        // We ignore the Result deliberately: diag_ping callers want to see
        // whether the message lands on the indexer afterwards.
        let _ = msg::send_bytes_with_gas(target, payload, gas, 0);
        Ok(())
    }

    // ── Queries ────────────────────────────────────────────────────────────

    #[export]
    pub fn get_ping_targets(&self) -> alloc::vec::Vec<PingTarget> {
        self.state.borrow().ping_targets.clone()
    }

    #[export]
    pub fn get_last_tick_block(&self) -> u32 {
        self.state.borrow().last_tick_block
    }

    #[export]
    pub fn get_total_pings_sent(&self) -> u64 {
        self.state.borrow().total_pings_sent
    }

    #[export]
    pub fn get_tick_ping_gas(&self) -> u64 {
        self.state.borrow().tick_ping_gas
    }

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
    fn state_initialises_with_default_gas() {
        let state = AanTvRelayState::new(ActorId::from([1u8; 32]));
        assert_eq!(state.tick_ping_gas, DEFAULT_TICK_PING_GAS);
        assert_eq!(state.tick_ping_gas, 50_000_000_000);
        assert!(state.ping_targets.is_empty());
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
    fn gas_bounds_match_spec() {
        assert_eq!(MIN_TICK_PING_GAS, 1_000_000_000);
        assert_eq!(MAX_TICK_PING_GAS, 500_000_000_000);
        assert_eq!(DEFAULT_TICK_PING_GAS, 50_000_000_000);
    }
}
