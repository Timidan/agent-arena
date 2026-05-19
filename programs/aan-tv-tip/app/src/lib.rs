#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String, vec::Vec};
use core::cell::RefCell;
use sails_rs::{
    gstd::{exec, msg, CommandReply},
    prelude::*,
};

// ── Types ────────────────────────────────────────────────────────────────────

pub type TipId = u64;

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Tip {
    pub id: TipId,
    pub sender: ActorId,
    pub recipient: ActorId,
    pub amount: u128,              // total value attached
    pub recipient_received: u128,  // 99% of amount
    pub protocol_cut: u128,        // 1% of amount
    pub note: String,              // <=200 chars
    pub block: u32,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct TipPage {
    pub items: Vec<Tip>,
    pub next_cursor: Option<TipId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    Unauthorized,
    InsufficientPayment, // value == 0
    InvalidArg,          // note too long, OR sender == recipient
    ArithmeticOverflow,
    InsufficientFunds,   // sweep amount > protocol_balance
    RefundFailed,
}

// ── State ────────────────────────────────────────────────────────────────────

pub struct AanTvTipState {
    pub admin: ActorId,
    pub protocol_bps: u16,       // 100 = 1%
    pub protocol_balance: u128,
    pub next_tip_id: u64,
    pub tips: BTreeMap<u64, Tip>,
}

impl AanTvTipState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            protocol_bps: 100, // 1%
            protocol_balance: 0,
            next_tip_id: 1,
            tips: BTreeMap::new(),
        }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

pub struct AanTvTip {
    state: Rc<RefCell<AanTvTipState>>,
}

#[sails_rs::service]
impl AanTvTip {
    /// Send a tip to `recipient`. Takes msg::value. Splits 99% to recipient, 1% protocol.
    ///
    /// Refund correctness (sails-rs 0.10.x):
    /// - Anti-self-tip: sender == recipient → Err with full refund.
    /// - Zero value: value == 0 → Err with full refund.
    /// - Note too long: >200 bytes → Err with full refund.
    /// - Outbound send queued BEFORE state mutation.
    /// - CommandReply::with_value is the only reliable refund primitive on Err paths.
    #[export]
    pub fn tip(
        &mut self,
        recipient: ActorId,
        note: String,
    ) -> CommandReply<Result<TipId, Error>> {
        let value = msg::value();
        let sender = msg::source();

        // Zero-value guard
        if value == 0 {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(0);
        }

        // Anti-self-tip guard
        if sender == recipient {
            return CommandReply::new(Err(Error::InvalidArg)).with_value(value);
        }

        // Note length guard (UTF-8 bytes)
        if note.as_bytes().len() > 200 {
            return CommandReply::new(Err(Error::InvalidArg)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        // Split: protocol_cut = value * bps / 10_000
        let protocol_cut = match (value as u128).checked_mul(state.protocol_bps as u128) {
            Some(n) => n / 10_000,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };
        let recipient_share = value - protocol_cut;

        // Overflow-safe tip ID allocation
        let next = match state.next_tip_id.checked_add(1) {
            Some(n) => n,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        // Overflow-safe protocol_balance accumulation
        let new_balance = match state.protocol_balance.checked_add(protocol_cut) {
            Some(b) => b,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        // CRITICAL: Queue the outbound send BEFORE state mutation.
        // If send queue fails, refund full value via CommandReply.
        if msg::send_bytes_with_gas(recipient, sails_rs::Vec::new(), 0, recipient_share).is_err() {
            return CommandReply::new(Err(Error::RefundFailed)).with_value(value);
        }

        // Send queued successfully — commit state.
        let tip_id = state.next_tip_id;
        state.next_tip_id = next;
        state.protocol_balance = new_balance;

        let tip_entry = Tip {
            id: tip_id,
            sender,
            recipient,
            amount: value,
            recipient_received: recipient_share,
            protocol_cut,
            note,
            block: exec::block_height(),
        };

        state.tips.insert(tip_id, tip_entry);

        CommandReply::new(Ok(tip_id)).with_value(0)
    }

    /// Admin-only: sweep accumulated protocol fees to admin wallet.
    #[export]
    pub fn sweep(&mut self, amount: u128) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if msg::source() != state.admin {
            return Err(Error::Unauthorized);
        }
        if amount > state.protocol_balance {
            return Err(Error::InsufficientFunds);
        }
        let admin = state.admin;
        state.protocol_balance -= amount;
        msg::send_bytes_with_gas(admin, sails_rs::Vec::new(), 0, amount)
            .map_err(|_| {
                state.protocol_balance += amount;
                Error::RefundFailed
            })?;
        Ok(())
    }

    /// Get a tip by ID.
    #[export]
    pub fn get_tip(&self, id: TipId) -> Option<Tip> {
        self.state.borrow().tips.get(&id).cloned()
    }

    /// Paginated tips received by recipient. cursor=None starts from ID 1.
    #[export]
    pub fn get_tips_received(
        &self,
        recipient: ActorId,
        cursor: Option<TipId>,
        limit: u32,
    ) -> TipPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(100) as usize;

        let mut items = Vec::new();
        for (_id, tip) in state.tips.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            if tip.recipient == recipient {
                items.push(tip.clone());
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().map(|t| t.id + 1)
        } else {
            None
        };

        TipPage { items, next_cursor }
    }

    /// Paginated tips sent by sender. cursor=None starts from ID 1.
    #[export]
    pub fn get_tips_sent(
        &self,
        sender: ActorId,
        cursor: Option<TipId>,
        limit: u32,
    ) -> TipPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(100) as usize;

        let mut items = Vec::new();
        for (_id, tip) in state.tips.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            if tip.sender == sender {
                items.push(tip.clone());
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().map(|t| t.id + 1)
        } else {
            None
        };

        TipPage { items, next_cursor }
    }

    /// Read protocol balance (for admin/tests).
    #[export]
    pub fn get_protocol_balance(&self) -> u128 {
        self.state.borrow().protocol_balance
    }
}

// ── Program ──────────────────────────────────────────────────────────────────

pub struct Program {
    state: Rc<RefCell<AanTvTipState>>,
}

#[sails_rs::program]
impl Program {
    /// Initialise. msg::source() becomes admin.
    pub fn create() -> Self {
        let state = Rc::new(RefCell::new(AanTvTipState::new(msg::source())));
        Self { state }
    }

    pub fn aan_tv_tip(&self) -> AanTvTip {
        AanTvTip {
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
    fn error_enum_round_trips() {
        round_trip(Error::Unauthorized);
        round_trip(Error::InsufficientPayment);
        round_trip(Error::InvalidArg);
        round_trip(Error::ArithmeticOverflow);
        round_trip(Error::InsufficientFunds);
        round_trip(Error::RefundFailed);
    }

    #[test]
    fn state_init_defaults() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanTvTipState::new(admin);
        assert_eq!(state.protocol_bps, 100);
        assert_eq!(state.protocol_balance, 0);
        assert_eq!(state.next_tip_id, 1);
        assert!(state.tips.is_empty());
    }

    #[test]
    fn split_math_99_1() {
        // 1 VARA = 1_000_000_000_000 plancks, bps=100 (1%)
        let value: u128 = 1_000_000_000_000;
        let bps: u16 = 100;
        let cut = (value * bps as u128) / 10_000;
        let share = value - cut;
        assert_eq!(cut, 10_000_000_000);    // 1%
        assert_eq!(share, 990_000_000_000); // 99%
        assert_eq!(cut + share, value);
    }
}
