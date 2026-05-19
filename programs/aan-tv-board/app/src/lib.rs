#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String, vec::Vec};
use core::cell::RefCell;
use sails_rs::{
    gstd::{exec, msg},
    prelude::*,
};

// ── Types ────────────────────────────────────────────────────────────────────

pub type EntryId = u64;

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Entry {
    pub id: EntryId,
    pub author: ActorId,
    pub author_kind: String, // "Wallet" | "Application"
    pub thought: String,     // <=100 UTF-8 bytes
    pub block: u32,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct EntryPage {
    pub items: Vec<Entry>,
    pub next_cursor: Option<EntryId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    Unauthorized,
    InvalidArg,       // thought too long
    ArithmeticOverflow,
}

// ── State ────────────────────────────────────────────────────────────────────

pub struct AanTvBoardState {
    pub admin: ActorId,
    pub next_entry_id: u64,
    pub entries: BTreeMap<u64, Entry>,
}

impl AanTvBoardState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            next_entry_id: 1,
            entries: BTreeMap::new(),
        }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

pub struct AanTvBoard {
    state: Rc<RefCell<AanTvBoardState>>,
}

#[sails_rs::service]
impl AanTvBoard {
    /// Sign the guestbook with a thought (<=100 UTF-8 bytes). Gas-only — no msg::value taken.
    #[export]
    pub fn sign(&mut self, thought: String) -> Result<EntryId, Error> {
        // Validate thought length (UTF-8 bytes, not chars)
        if thought.as_bytes().len() > 100 {
            return Err(Error::InvalidArg);
        }

        let mut state = self.state.borrow_mut();

        // Overflow-safe ID allocation
        let next = match state.next_entry_id.checked_add(1) {
            Some(n) => n,
            None => return Err(Error::ArithmeticOverflow),
        };

        let entry_id = state.next_entry_id;
        state.next_entry_id = next;

        let caller = msg::source();
        let entry = Entry {
            id: entry_id,
            author: caller,
            author_kind: "Wallet".into(), // default; Applications calling from contract would be "Application"
            thought,
            block: exec::block_height(),
        };

        state.entries.insert(entry_id, entry);

        Ok(entry_id)
    }

    /// Read full state (for tests and admin introspection).
    #[export]
    pub fn read_state(&self) -> alloc::vec::Vec<Entry> {
        self.state
            .borrow()
            .entries
            .values()
            .cloned()
            .collect()
    }

    /// Paginated entry list. cursor=None starts from ID 1.
    #[export]
    pub fn get_entries(&self, cursor: Option<EntryId>, limit: u32) -> EntryPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(100) as usize;

        let mut items = Vec::new();
        for (&_id, entry) in state.entries.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            items.push(entry.clone());
        }

        let next_cursor = if items.len() == limit {
            items.last().map(|e| e.id + 1)
        } else {
            None
        };

        EntryPage { items, next_cursor }
    }

    /// Filter entries by author ActorId.
    #[export]
    pub fn get_by_author(&self, author: ActorId, limit: u32) -> Vec<Entry> {
        let state = self.state.borrow();
        let limit = limit.min(100) as usize;

        state
            .entries
            .values()
            .filter(|e| e.author == author)
            .take(limit)
            .cloned()
            .collect()
    }
}

// ── Program ──────────────────────────────────────────────────────────────────

pub struct Program {
    state: Rc<RefCell<AanTvBoardState>>,
}

#[sails_rs::program]
impl Program {
    /// Initialise the program. msg::source() becomes admin.
    pub fn create() -> Self {
        let state = Rc::new(RefCell::new(AanTvBoardState::new(msg::source())));
        Self { state }
    }

    /// Service accessor.
    pub fn aan_tv_board(&self) -> AanTvBoard {
        AanTvBoard {
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
        round_trip(Error::InvalidArg);
        round_trip(Error::ArithmeticOverflow);
    }

    #[test]
    fn state_init_defaults() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanTvBoardState::new(admin);
        assert_eq!(state.admin, admin);
        assert_eq!(state.next_entry_id, 1);
        assert!(state.entries.is_empty());
    }
}
