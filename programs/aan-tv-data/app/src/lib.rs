#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String, vec::Vec};
use core::cell::RefCell;
use sails_rs::{
    gstd::{exec, msg, CommandReply},
    prelude::*,
};

// ── Types ────────────────────────────────────────────────────────────────────

pub type StatId = u64;

/// The kind of stat being recorded.
#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum StatKind {
    Calls,
    Mentions,
    Posts,
    Activity,
    Custom,
}

/// A single stat entry.
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct StatEntry {
    pub id: StatId,
    pub submitter: ActorId,
    pub app: ActorId,    // the app the stat is about
    pub kind: StatKind,
    pub value: u64,
    pub note: String,    // <=120 chars
    pub block: u32,
}

/// Batch input entry (no id/block — assigned by contract).
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct StatBatchEntry {
    pub app: ActorId,
    pub kind: StatKind,
    pub value: u64,
    pub note: String,
}

/// Paginated stat page.
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct StatPage {
    pub items: Vec<StatEntry>,
    pub next_cursor: Option<StatId>,
}

/// Aggregated stats for an app.
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq, Default)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct AppStatsAggregate {
    pub total_calls: u64,
    pub total_mentions: u64,
    pub total_posts: u64,
    pub latest_block: u32,
}

/// Caller summary for GetTopCallers.
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct CallerSummary {
    pub submitter: ActorId,
    pub count: u64,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    Unauthorized,
    InsufficientPayment,
    InvalidArg,          // note too long
    ArithmeticOverflow,
    InsufficientFunds,   // sweep > protocol_balance
    RefundFailed,
    BatchTooLarge,       // batch > 100 entries
}

// ── State ────────────────────────────────────────────────────────────────────

pub struct AanTvDataState {
    pub admin: ActorId,
    pub submit_fee: u128,        // 0.01 VARA per submission = 10_000_000_000 plancks
    pub protocol_balance: u128,
    pub next_stat_id: u64,
    pub stats: BTreeMap<u64, StatEntry>,
}

impl AanTvDataState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            submit_fee: 10_000_000_000, // 0.01 VARA
            protocol_balance: 0,
            next_stat_id: 1,
            stats: BTreeMap::new(),
        }
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

pub struct AanTvData {
    state: Rc<RefCell<AanTvDataState>>,
}

#[sails_rs::service]
impl AanTvData {
    /// Submit a stat entry. Requires 0.01 VARA fee (excess is refunded).
    #[export]
    pub fn submit_stat(
        &mut self,
        app: ActorId,
        kind: StatKind,
        value: u64,
        note: String,
    ) -> CommandReply<Result<StatId, Error>> {
        let attached = msg::value();
        let submitter = msg::source();
        let state_ref = self.state.borrow();
        let fee = state_ref.submit_fee;
        drop(state_ref);

        // Underpayment guard
        if attached < fee {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(attached);
        }

        let excess = attached - fee;

        // Note length guard (UTF-8 bytes)
        if note.as_bytes().len() > 120 {
            return CommandReply::new(Err(Error::InvalidArg)).with_value(attached);
        }

        let mut state = self.state.borrow_mut();

        // Overflow-safe stat ID
        let next = match state.next_stat_id.checked_add(1) {
            Some(n) => n,
            None => return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(attached),
        };

        // Overflow-safe protocol_balance accumulation
        let new_balance = match state.protocol_balance.checked_add(fee) {
            Some(b) => b,
            None => return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(attached),
        };

        let stat_id = state.next_stat_id;
        state.next_stat_id = next;
        state.protocol_balance = new_balance;

        let entry = StatEntry {
            id: stat_id,
            submitter,
            app,
            kind,
            value,
            note,
            block: exec::block_height(),
        };

        state.stats.insert(stat_id, entry);

        // Refund excess (with_value(0) is a no-op for exact payment)
        CommandReply::new(Ok(stat_id)).with_value(excess)
    }

    /// Admin-only: bulk-import stats (trusted bot source). Returns count inserted.
    #[export]
    pub fn submit_batch(&mut self, stats: Vec<StatBatchEntry>) -> Result<u32, Error> {
        let caller = msg::source();
        let state_ref = self.state.borrow();
        if caller != state_ref.admin {
            return Err(Error::Unauthorized);
        }
        if stats.len() > 100 {
            return Err(Error::BatchTooLarge);
        }
        drop(state_ref);

        let mut state = self.state.borrow_mut();
        let submitter = state.admin;
        let mut inserted: u32 = 0;

        for batch_entry in stats {
            if batch_entry.note.as_bytes().len() > 120 {
                continue; // skip invalid notes in batch
            }

            let next = match state.next_stat_id.checked_add(1) {
                Some(n) => n,
                None => return Err(Error::ArithmeticOverflow),
            };

            let stat_id = state.next_stat_id;
            state.next_stat_id = next;

            let entry = StatEntry {
                id: stat_id,
                submitter,
                app: batch_entry.app,
                kind: batch_entry.kind,
                value: batch_entry.value,
                note: batch_entry.note,
                block: exec::block_height(),
            };

            state.stats.insert(stat_id, entry);
            inserted += 1;
        }

        Ok(inserted)
    }

    /// Admin-only: sweep protocol fees.
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

    /// Get aggregated stats for an app.
    #[export]
    pub fn get_app_stats(&self, app: ActorId) -> AppStatsAggregate {
        let state = self.state.borrow();
        let mut agg = AppStatsAggregate::default();

        for entry in state.stats.values() {
            if entry.app != app {
                continue;
            }
            match entry.kind {
                StatKind::Calls => agg.total_calls = agg.total_calls.saturating_add(entry.value),
                StatKind::Mentions => agg.total_mentions = agg.total_mentions.saturating_add(entry.value),
                StatKind::Posts => agg.total_posts = agg.total_posts.saturating_add(entry.value),
                StatKind::Activity | StatKind::Custom => {}
            }
            if entry.block > agg.latest_block {
                agg.latest_block = entry.block;
            }
        }

        agg
    }

    /// Paginated recent stats. cursor=None starts from ID 1.
    #[export]
    pub fn get_recent(&self, cursor: Option<StatId>, limit: u32) -> StatPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(100) as usize;

        let mut items = Vec::new();
        for (_id, entry) in state.stats.range(start_id..) {
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

        StatPage { items, next_cursor }
    }

    /// Top submitters by count.
    #[export]
    pub fn get_top_callers(&self, limit: u32) -> Vec<CallerSummary> {
        let state = self.state.borrow();
        let limit = limit.min(50) as usize;

        // Count per submitter
        let mut counts: BTreeMap<ActorId, u64> = BTreeMap::new();
        for entry in state.stats.values() {
            let c = counts.entry(entry.submitter).or_insert(0);
            *c = c.saturating_add(1);
        }

        // Collect and sort descending by count
        let mut summaries: Vec<CallerSummary> = counts
            .into_iter()
            .map(|(submitter, count)| CallerSummary { submitter, count })
            .collect();

        summaries.sort_by(|a, b| b.count.cmp(&a.count));
        summaries.truncate(limit);
        summaries
    }

    /// Read protocol balance (for tests).
    #[export]
    pub fn get_protocol_balance(&self) -> u128 {
        self.state.borrow().protocol_balance
    }
}

// ── Program ──────────────────────────────────────────────────────────────────

pub struct Program {
    state: Rc<RefCell<AanTvDataState>>,
}

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        let state = Rc::new(RefCell::new(AanTvDataState::new(msg::source())));
        Self { state }
    }

    pub fn aan_tv_data(&self) -> AanTvData {
        AanTvData {
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
        round_trip(Error::BatchTooLarge);
    }

    #[test]
    fn stat_kind_round_trips() {
        round_trip(StatKind::Calls);
        round_trip(StatKind::Mentions);
        round_trip(StatKind::Posts);
        round_trip(StatKind::Activity);
        round_trip(StatKind::Custom);
    }

    #[test]
    fn state_init_defaults() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanTvDataState::new(admin);
        assert_eq!(state.admin, admin);
        assert_eq!(state.submit_fee, 10_000_000_000);
        assert_eq!(state.protocol_balance, 0);
        assert_eq!(state.next_stat_id, 1);
        assert!(state.stats.is_empty());
    }
}
