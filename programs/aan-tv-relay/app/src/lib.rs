#![no_std]

extern crate alloc;

use alloc::rc::Rc;
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
    TickThrottled,
}

// ── Tuning constants ─────────────────────────────────────────────────────────
/// Maximum size of the ping_targets list. Caps fan-out gas budget per Tick.
pub const MAX_PING_TARGETS: usize = 20;
/// Throttle: minimum block gap between successful Tick calls.
pub const TICK_MIN_BLOCK_GAP: u32 = 10;
/// Gas allocated to each individual outbound ping in Tick.
pub const TICK_PING_GAS: u64 = 5_000_000_000;

// ── State ────────────────────────────────────────────────────────────────────
pub struct AanTvRelayState {
    pub admin: ActorId,
    pub ping_targets: alloc::vec::Vec<ActorId>,
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
    /// Admin: append a program ActorId to the outbound ping list.
    /// Idempotent: duplicate targets are a no-op.
    #[export]
    pub fn add_ping_target(&mut self, target: ActorId) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        if state.ping_targets.len() >= MAX_PING_TARGETS {
            return Err(Error::TooManyPingTargets);
        }
        if !state.ping_targets.contains(&target) {
            state.ping_targets.push(target);
        }
        Ok(())
    }

    /// Admin: remove a target from the outbound ping list.
    #[export]
    pub fn remove_ping_target(&mut self, target: ActorId) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        let position = state
            .ping_targets
            .iter()
            .position(|t| t == &target)
            .ok_or(Error::PingTargetNotFound)?;
        state.ping_targets.remove(position);
        Ok(())
    }

    /// Permissionless: fan out a zero-value heartbeat to every target.
    /// Throttled to one successful call per `TICK_MIN_BLOCK_GAP` blocks.
    /// Each outbound is sent FROM this program actor, so the indexer
    /// attributes the call as `origin: program_initiated` to the relay's
    /// appMetric. Returns the number of targets pinged on success.
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
        for target in targets.iter() {
            // Ignore individual send failures — a stale target must not block the whole tick.
            if msg::send_bytes_with_gas(*target, sails_rs::Vec::new(), TICK_PING_GAS, 0).is_ok() {
                sent = sent.saturating_add(1);
            }
        }
        state.total_pings_sent = state.total_pings_sent.saturating_add(sent as u64);
        Ok(sent)
    }

    /// Query: read the current ping target list.
    #[export]
    pub fn get_ping_targets(&self) -> alloc::vec::Vec<ActorId> {
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
    fn add_and_remove_ping_target_in_memory() {
        let admin = ActorId::from([1u8; 32]);
        let mut state = AanTvRelayState::new(admin);

        let t1 = ActorId::from([2u8; 32]);
        let t2 = ActorId::from([3u8; 32]);

        state.ping_targets.push(t1);
        state.ping_targets.push(t2);
        assert_eq!(state.ping_targets.len(), 2);
        assert!(state.ping_targets.contains(&t1));

        let pos = state.ping_targets.iter().position(|t| t == &t1).unwrap();
        state.ping_targets.remove(pos);
        assert_eq!(state.ping_targets.len(), 1);
        assert!(!state.ping_targets.contains(&t1));
    }

    #[test]
    fn tuning_constants_match_spec() {
        assert_eq!(TICK_MIN_BLOCK_GAP, 10);
        assert_eq!(MAX_PING_TARGETS, 20);
        assert_eq!(TICK_PING_GAS, 5_000_000_000);
    }
}
