#![no_std]

extern crate alloc;

use alloc::{collections::BTreeMap, rc::Rc, string::String, vec::Vec};
use core::cell::RefCell;
use sails_rs::{
    gstd::{CommandReply, exec, msg},
    prelude::*,
};

pub type MissionId = u64;
pub type ClaimId = u64;
pub type ProofId = u64;

const MAX_TITLE_BYTES: usize = 80;
const MAX_INSTRUCTIONS_BYTES: usize = 400;
const MAX_ACTION_BYTES: usize = 120;
const MAX_PROOF_TX_BYTES: usize = 100;
const MAX_NOTE_BYTES: usize = 240;
const MAX_REASON_BYTES: usize = 160;
const MAX_PAGE_LIMIT: u32 = 100;
const MAX_APPROVALS_PER_MISSION: u32 = 1_000;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum ClaimStatus {
    Claimed,
    ProofPending,
    Approved,
    Rejected,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum ProofStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    Unauthorized,
    InvalidArg,
    InsufficientPayment,
    MissionNotFound,
    MissionClosed,
    MissionExpired,
    MissionFull,
    ClaimNotFound,
    DuplicateClaim,
    DuplicateProof,
    ProofNotFound,
    WrongStatus,
    RewardPoolEmpty,
    ArithmeticOverflow,
    PayoutFailed,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionInput {
    pub title: String,
    pub instructions: String,
    pub target_program: Option<ActorId>,
    pub required_action: String,
    pub max_participant_value: u128,
    pub reward: u128,
    pub max_approvals: u32,
    pub deadline_block: u32,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Mission {
    pub id: MissionId,
    pub title: String,
    pub instructions: String,
    pub target_program: Option<ActorId>,
    pub required_action: String,
    pub max_participant_value: u128,
    pub reward: u128,
    pub max_approvals: u32,
    pub approvals_count: u32,
    pub deadline_block: u32,
    pub created_at_block: u32,
    pub closed: bool,
    pub funded_pool: u128,
    pub remaining_pool: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Claim {
    pub id: ClaimId,
    pub mission_id: MissionId,
    pub claimant: ActorId,
    pub claimed_at_block: u32,
    pub status: ClaimStatus,
    pub latest_proof_id: Option<ProofId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Proof {
    pub id: ProofId,
    pub mission_id: MissionId,
    pub claim_id: ClaimId,
    pub claimant: ActorId,
    pub proof_tx_hash: String,
    pub note: String,
    pub submitted_at_block: u32,
    pub status: ProofStatus,
    pub rejection_reason: Option<String>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct AgentRecord {
    pub agent: ActorId,
    pub completed_count: u32,
    pub total_rewards_earned: u128,
    pub rejected_proof_count: u32,
    pub last_completed_block: u32,
    pub distinct_targets: Vec<ActorId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionPage {
    pub items: Vec<Mission>,
    pub next_cursor: Option<MissionId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ClaimPage {
    pub items: Vec<Claim>,
    pub next_cursor: Option<ClaimId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ProofPage {
    pub items: Vec<Proof>,
    pub next_cursor: Option<ProofId>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct AgentRecordPage {
    pub items: Vec<AgentRecord>,
    pub next_cursor: Option<u32>,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct RewardPaid {
    pub proof_id: ProofId,
    pub mission_id: MissionId,
    pub claimant: ActorId,
    pub amount: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct RefundAmount {
    pub mission_id: MissionId,
    pub amount: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionStats {
    pub total_missions: u64,
    pub open_missions: u64,
    pub total_claims: u64,
    pub pending_proofs: u64,
    pub approved_proofs: u64,
    pub rejected_proofs: u64,
    pub rewards_paid: u128,
    pub rewards_remaining: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionCreatedEvent {
    pub mission_id: MissionId,
    pub admin: ActorId,
    pub title: String,
    pub target_program: Option<ActorId>,
    pub max_participant_value: u128,
    pub reward: u128,
    pub max_approvals: u32,
    pub funded_pool: u128,
    pub deadline_block: u32,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionClaimedEvent {
    pub mission_id: MissionId,
    pub claim_id: ClaimId,
    pub claimant: ActorId,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ProofSubmittedEvent {
    pub proof_id: ProofId,
    pub mission_id: MissionId,
    pub claim_id: ClaimId,
    pub claimant: ActorId,
    pub proof_tx_hash: String,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ProofApprovedEvent {
    pub proof_id: ProofId,
    pub mission_id: MissionId,
    pub claim_id: ClaimId,
    pub claimant: ActorId,
    pub amount: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ProofRejectedEvent {
    pub proof_id: ProofId,
    pub mission_id: MissionId,
    pub claim_id: ClaimId,
    pub claimant: ActorId,
    pub reason: String,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct MissionClosedEvent {
    pub mission_id: MissionId,
    pub refund_amount: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct RewardPaidEvent {
    pub proof_id: ProofId,
    pub mission_id: MissionId,
    pub claimant: ActorId,
    pub amount: u128,
}

#[sails_rs::event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Events {
    MissionCreated(MissionCreatedEvent),
    MissionClaimed(MissionClaimedEvent),
    ProofSubmitted(ProofSubmittedEvent),
    ProofApproved(ProofApprovedEvent),
    ProofRejected(ProofRejectedEvent),
    MissionClosed(MissionClosedEvent),
    RewardPaid(RewardPaidEvent),
}

pub struct AanMissionsState {
    pub admin: ActorId,
    pub next_mission_id: MissionId,
    pub next_claim_id: ClaimId,
    pub next_proof_id: ProofId,
    pub missions: BTreeMap<MissionId, Mission>,
    pub claims: BTreeMap<ClaimId, Claim>,
    pub proofs: BTreeMap<ProofId, Proof>,
    pub claim_by_mission_agent: BTreeMap<(MissionId, ActorId), ClaimId>,
    pub proof_by_tx_hash: BTreeMap<String, ProofId>,
    pub agent_records: BTreeMap<ActorId, AgentRecord>,
    pub rewards_paid: u128,
}

impl AanMissionsState {
    pub fn new(admin: ActorId) -> Self {
        Self {
            admin,
            next_mission_id: 1,
            next_claim_id: 1,
            next_proof_id: 1,
            missions: BTreeMap::new(),
            claims: BTreeMap::new(),
            proofs: BTreeMap::new(),
            claim_by_mission_agent: BTreeMap::new(),
            proof_by_tx_hash: BTreeMap::new(),
            agent_records: BTreeMap::new(),
            rewards_paid: 0,
        }
    }
}

pub struct AanMissions {
    state: Rc<RefCell<AanMissionsState>>,
}

#[sails_rs::service(events = Events)]
impl AanMissions {
    #[export]
    pub fn create_mission(
        &mut self,
        input: MissionInput,
    ) -> CommandReply<Result<MissionId, Error>> {
        let value = msg::value();
        let caller = msg::source();
        let mut state = self.state.borrow_mut();

        if caller != state.admin {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }
        if !Self::valid_mission_input(&input) {
            return CommandReply::new(Err(Error::InvalidArg)).with_value(value);
        }

        let required_pool = match input.reward.checked_mul(input.max_approvals as u128) {
            Some(pool) => pool,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };
        if value < required_pool {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(value);
        }

        let next = match state.next_mission_id.checked_add(1) {
            Some(next) => next,
            None => {
                return CommandReply::new(Err(Error::ArithmeticOverflow)).with_value(value);
            }
        };

        let mission_id = state.next_mission_id;
        state.next_mission_id = next;
        let event = MissionCreatedEvent {
            mission_id,
            admin: caller,
            title: input.title.clone(),
            target_program: input.target_program.clone(),
            max_participant_value: input.max_participant_value,
            reward: input.reward,
            max_approvals: input.max_approvals,
            funded_pool: required_pool,
            deadline_block: input.deadline_block,
        };
        state.missions.insert(
            mission_id,
            Mission {
                id: mission_id,
                title: input.title,
                instructions: input.instructions,
                target_program: input.target_program,
                required_action: input.required_action,
                max_participant_value: input.max_participant_value,
                reward: input.reward,
                max_approvals: input.max_approvals,
                approvals_count: 0,
                deadline_block: input.deadline_block,
                created_at_block: exec::block_height(),
                closed: false,
                funded_pool: required_pool,
                remaining_pool: required_pool,
            },
        );
        drop(state);

        let _ = self.emit_event(Events::MissionCreated(event));

        CommandReply::new(Ok(mission_id)).with_value(value - required_pool)
    }

    #[export]
    pub fn claim_mission(&mut self, mission_id: MissionId) -> Result<ClaimId, Error> {
        let caller = msg::source();
        let mut state = self.state.borrow_mut();
        let mission = state
            .missions
            .get(&mission_id)
            .ok_or(Error::MissionNotFound)?;

        Self::ensure_open(mission)?;
        if state
            .claim_by_mission_agent
            .contains_key(&(mission_id, caller))
        {
            return Err(Error::DuplicateClaim);
        }

        let next = state
            .next_claim_id
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let claim_id = state.next_claim_id;
        state.next_claim_id = next;

        state
            .claim_by_mission_agent
            .insert((mission_id, caller), claim_id);
        state.claims.insert(
            claim_id,
            Claim {
                id: claim_id,
                mission_id,
                claimant: caller,
                claimed_at_block: exec::block_height(),
                status: ClaimStatus::Claimed,
                latest_proof_id: None,
            },
        );
        drop(state);

        let _ = self.emit_event(Events::MissionClaimed(MissionClaimedEvent {
            mission_id,
            claim_id,
            claimant: caller,
        }));

        Ok(claim_id)
    }

    #[export]
    pub fn submit_proof(
        &mut self,
        mission_id: MissionId,
        proof_tx_hash: String,
        note: String,
    ) -> Result<ProofId, Error> {
        let caller = msg::source();
        if !Self::valid_text(&proof_tx_hash, MAX_PROOF_TX_BYTES)
            || !Self::valid_text(&note, MAX_NOTE_BYTES)
        {
            return Err(Error::InvalidArg);
        }

        let mut state = self.state.borrow_mut();
        let mission = state
            .missions
            .get(&mission_id)
            .ok_or(Error::MissionNotFound)?;
        Self::ensure_open(mission)?;

        if state.proof_by_tx_hash.contains_key(&proof_tx_hash) {
            return Err(Error::DuplicateProof);
        }

        let claim_id = *state
            .claim_by_mission_agent
            .get(&(mission_id, caller))
            .ok_or(Error::ClaimNotFound)?;
        let claim = state.claims.get(&claim_id).ok_or(Error::ClaimNotFound)?;
        if claim.status == ClaimStatus::ProofPending || claim.status == ClaimStatus::Approved {
            return Err(Error::WrongStatus);
        }

        let next = state
            .next_proof_id
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let proof_id = state.next_proof_id;
        state.next_proof_id = next;
        let proof_tx_hash_event = proof_tx_hash.clone();

        state
            .proof_by_tx_hash
            .insert(proof_tx_hash.clone(), proof_id);
        state.proofs.insert(
            proof_id,
            Proof {
                id: proof_id,
                mission_id,
                claim_id,
                claimant: caller,
                proof_tx_hash,
                note,
                submitted_at_block: exec::block_height(),
                status: ProofStatus::Pending,
                rejection_reason: None,
            },
        );

        let claim = state
            .claims
            .get_mut(&claim_id)
            .ok_or(Error::ClaimNotFound)?;
        claim.status = ClaimStatus::ProofPending;
        claim.latest_proof_id = Some(proof_id);
        drop(state);

        let _ = self.emit_event(Events::ProofSubmitted(ProofSubmittedEvent {
            proof_id,
            mission_id,
            claim_id,
            claimant: caller,
            proof_tx_hash: proof_tx_hash_event,
        }));

        Ok(proof_id)
    }

    #[export]
    pub fn approve_proof(&mut self, proof_id: ProofId) -> Result<RewardPaid, Error> {
        let caller = msg::source();
        let mut state = self.state.borrow_mut();
        if caller != state.admin {
            return Err(Error::Unauthorized);
        }

        let proof = state
            .proofs
            .get(&proof_id)
            .ok_or(Error::ProofNotFound)?
            .clone();
        if proof.status != ProofStatus::Pending {
            return Err(Error::WrongStatus);
        }

        let mission = state
            .missions
            .get(&proof.mission_id)
            .ok_or(Error::MissionNotFound)?
            .clone();
        Self::ensure_open(&mission)?;
        if mission.approvals_count >= mission.max_approvals {
            return Err(Error::MissionFull);
        }
        if mission.remaining_pool < mission.reward {
            return Err(Error::RewardPoolEmpty);
        }

        msg::send_bytes_with_gas(proof.claimant, Vec::new(), 0, mission.reward)
            .map_err(|_| Error::PayoutFailed)?;

        {
            let proof_mut = state
                .proofs
                .get_mut(&proof_id)
                .ok_or(Error::ProofNotFound)?;
            proof_mut.status = ProofStatus::Approved;
        }
        {
            let claim = state
                .claims
                .get_mut(&proof.claim_id)
                .ok_or(Error::ClaimNotFound)?;
            claim.status = ClaimStatus::Approved;
        }
        {
            let mission_mut = state
                .missions
                .get_mut(&proof.mission_id)
                .ok_or(Error::MissionNotFound)?;
            mission_mut.remaining_pool -= mission.reward;
            mission_mut.approvals_count += 1;
        }

        state.rewards_paid = state
            .rewards_paid
            .checked_add(mission.reward)
            .ok_or(Error::ArithmeticOverflow)?;
        Self::record_approval(
            &mut state,
            proof.claimant,
            mission.target_program.clone(),
            mission.reward,
        )?;

        let paid = RewardPaid {
            proof_id,
            mission_id: proof.mission_id,
            claimant: proof.claimant,
            amount: mission.reward,
        };
        let approved_event = ProofApprovedEvent {
            proof_id,
            mission_id: proof.mission_id,
            claim_id: proof.claim_id,
            claimant: proof.claimant,
            amount: mission.reward,
        };
        let paid_event = RewardPaidEvent {
            proof_id,
            mission_id: proof.mission_id,
            claimant: proof.claimant,
            amount: mission.reward,
        };
        drop(state);

        let _ = self.emit_event(Events::ProofApproved(approved_event));
        let _ = self.emit_event(Events::RewardPaid(paid_event));

        Ok(paid)
    }

    #[export]
    pub fn reject_proof(&mut self, proof_id: ProofId, reason: String) -> Result<(), Error> {
        let caller = msg::source();
        if !Self::valid_text(&reason, MAX_REASON_BYTES) {
            return Err(Error::InvalidArg);
        }

        let mut state = self.state.borrow_mut();
        if caller != state.admin {
            return Err(Error::Unauthorized);
        }

        let proof = state
            .proofs
            .get(&proof_id)
            .ok_or(Error::ProofNotFound)?
            .clone();
        if proof.status != ProofStatus::Pending {
            return Err(Error::WrongStatus);
        }

        {
            let proof_mut = state
                .proofs
                .get_mut(&proof_id)
                .ok_or(Error::ProofNotFound)?;
            proof_mut.status = ProofStatus::Rejected;
            proof_mut.rejection_reason = Some(reason.clone());
        }
        {
            let claim = state
                .claims
                .get_mut(&proof.claim_id)
                .ok_or(Error::ClaimNotFound)?;
            claim.status = ClaimStatus::Rejected;
        }
        Self::record_rejection(&mut state, proof.claimant)?;
        drop(state);

        let _ = self.emit_event(Events::ProofRejected(ProofRejectedEvent {
            proof_id,
            mission_id: proof.mission_id,
            claim_id: proof.claim_id,
            claimant: proof.claimant,
            reason,
        }));

        Ok(())
    }

    #[export]
    pub fn close_mission(&mut self, mission_id: MissionId) -> Result<RefundAmount, Error> {
        let caller = msg::source();
        let mut state = self.state.borrow_mut();
        if caller != state.admin {
            return Err(Error::Unauthorized);
        }

        let mission = state
            .missions
            .get(&mission_id)
            .ok_or(Error::MissionNotFound)?
            .clone();
        if mission.closed {
            return Err(Error::MissionClosed);
        }

        if mission.remaining_pool > 0 {
            msg::send_bytes_with_gas(state.admin, Vec::new(), 0, mission.remaining_pool)
                .map_err(|_| Error::PayoutFailed)?;
        }

        let mission_mut = state
            .missions
            .get_mut(&mission_id)
            .ok_or(Error::MissionNotFound)?;
        mission_mut.closed = true;
        mission_mut.remaining_pool = 0;

        let refund = RefundAmount {
            mission_id,
            amount: mission.remaining_pool,
        };
        drop(state);

        let _ = self.emit_event(Events::MissionClosed(MissionClosedEvent {
            mission_id,
            refund_amount: refund.amount,
        }));

        Ok(refund)
    }

    #[export]
    pub fn get_open_missions(&self, cursor: Option<MissionId>, limit: u32) -> MissionPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for (&id, mission) in state.missions.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            if Self::is_open(mission) {
                items.push(mission.clone());
            }
            if id == u64::MAX {
                break;
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|mission| mission.id.checked_add(1))
        } else {
            None
        };
        MissionPage { items, next_cursor }
    }

    #[export]
    pub fn get_missions(&self, cursor: Option<MissionId>, limit: u32) -> MissionPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for (&id, mission) in state.missions.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            items.push(mission.clone());
            if id == u64::MAX {
                break;
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|mission| mission.id.checked_add(1))
        } else {
            None
        };
        MissionPage { items, next_cursor }
    }

    #[export]
    pub fn get_mission(&self, mission_id: MissionId) -> Option<Mission> {
        self.state.borrow().missions.get(&mission_id).cloned()
    }

    #[export]
    pub fn get_claims(&self, cursor: Option<ClaimId>, limit: u32) -> ClaimPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for (&id, claim) in state.claims.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            items.push(claim.clone());
            if id == u64::MAX {
                break;
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|claim| claim.id.checked_add(1))
        } else {
            None
        };
        ClaimPage { items, next_cursor }
    }

    #[export]
    pub fn get_claims_by_agent(
        &self,
        agent: ActorId,
        cursor: Option<ClaimId>,
        limit: u32,
    ) -> ClaimPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for claim in state.claims.range(start_id..).map(|(_, claim)| claim) {
            if items.len() >= limit {
                break;
            }
            if claim.claimant == agent {
                items.push(claim.clone());
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|claim| claim.id.checked_add(1))
        } else {
            None
        };
        ClaimPage { items, next_cursor }
    }

    #[export]
    pub fn get_pending_proofs(&self, cursor: Option<ProofId>, limit: u32) -> ProofPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for proof in state.proofs.range(start_id..).map(|(_, proof)| proof) {
            if items.len() >= limit {
                break;
            }
            if proof.status == ProofStatus::Pending {
                items.push(proof.clone());
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|proof| proof.id.checked_add(1))
        } else {
            None
        };
        ProofPage { items, next_cursor }
    }

    #[export]
    pub fn get_proofs(&self, cursor: Option<ProofId>, limit: u32) -> ProofPage {
        let state = self.state.borrow();
        let start_id = cursor.unwrap_or(1);
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for (&id, proof) in state.proofs.range(start_id..) {
            if items.len() >= limit {
                break;
            }
            items.push(proof.clone());
            if id == u64::MAX {
                break;
            }
        }

        let next_cursor = if items.len() == limit {
            items.last().and_then(|proof| proof.id.checked_add(1))
        } else {
            None
        };
        ProofPage { items, next_cursor }
    }

    #[export]
    pub fn get_proof(&self, proof_id: ProofId) -> Option<Proof> {
        self.state.borrow().proofs.get(&proof_id).cloned()
    }

    #[export]
    pub fn get_agent_record(&self, agent: ActorId) -> AgentRecord {
        self.state
            .borrow()
            .agent_records
            .get(&agent)
            .cloned()
            .unwrap_or_else(|| Self::empty_agent_record(agent))
    }

    #[export]
    pub fn get_agent_records(&self, cursor: Option<u32>, limit: u32) -> AgentRecordPage {
        let state = self.state.borrow();
        let start_index = cursor.unwrap_or(0) as usize;
        let limit = limit.min(MAX_PAGE_LIMIT) as usize;
        let mut items = Vec::new();

        for record in state.agent_records.values().skip(start_index) {
            if items.len() >= limit {
                break;
            }
            items.push(record.clone());
        }

        let read_count = start_index.saturating_add(items.len());
        let next_cursor = if items.len() == limit && read_count < state.agent_records.len() {
            u32::try_from(read_count).ok()
        } else {
            None
        };

        AgentRecordPage { items, next_cursor }
    }

    #[export]
    pub fn get_stats(&self) -> MissionStats {
        let state = self.state.borrow();
        let mut open_missions = 0u64;
        let mut pending_proofs = 0u64;
        let mut approved_proofs = 0u64;
        let mut rejected_proofs = 0u64;
        let mut rewards_remaining = 0u128;

        for mission in state.missions.values() {
            if Self::is_open(mission) {
                open_missions += 1;
            }
            rewards_remaining = rewards_remaining.saturating_add(mission.remaining_pool);
        }

        for proof in state.proofs.values() {
            match proof.status {
                ProofStatus::Pending => pending_proofs += 1,
                ProofStatus::Approved => approved_proofs += 1,
                ProofStatus::Rejected => rejected_proofs += 1,
            }
        }

        MissionStats {
            total_missions: state.missions.len() as u64,
            open_missions,
            total_claims: state.claims.len() as u64,
            pending_proofs,
            approved_proofs,
            rejected_proofs,
            rewards_paid: state.rewards_paid,
            rewards_remaining,
        }
    }

    fn valid_mission_input(input: &MissionInput) -> bool {
        Self::valid_text(&input.title, MAX_TITLE_BYTES)
            && Self::valid_text(&input.instructions, MAX_INSTRUCTIONS_BYTES)
            && Self::valid_text(&input.required_action, MAX_ACTION_BYTES)
            && input.reward > 0
            && input.max_approvals > 0
            && input.max_approvals <= MAX_APPROVALS_PER_MISSION
            && input.deadline_block > exec::block_height()
    }

    fn valid_text(value: &str, max_bytes: usize) -> bool {
        !value.is_empty() && value.as_bytes().len() <= max_bytes
    }

    fn ensure_open(mission: &Mission) -> Result<(), Error> {
        if mission.closed {
            return Err(Error::MissionClosed);
        }
        if exec::block_height() > mission.deadline_block {
            return Err(Error::MissionExpired);
        }
        if mission.approvals_count >= mission.max_approvals {
            return Err(Error::MissionFull);
        }
        Ok(())
    }

    fn is_open(mission: &Mission) -> bool {
        !mission.closed
            && exec::block_height() <= mission.deadline_block
            && mission.approvals_count < mission.max_approvals
    }

    fn empty_agent_record(agent: ActorId) -> AgentRecord {
        AgentRecord {
            agent,
            completed_count: 0,
            total_rewards_earned: 0,
            rejected_proof_count: 0,
            last_completed_block: 0,
            distinct_targets: Vec::new(),
        }
    }

    fn record_approval(
        state: &mut AanMissionsState,
        agent: ActorId,
        target: Option<ActorId>,
        reward: u128,
    ) -> Result<(), Error> {
        let record = state
            .agent_records
            .entry(agent)
            .or_insert_with(|| Self::empty_agent_record(agent));
        record.completed_count = record
            .completed_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        record.total_rewards_earned = record
            .total_rewards_earned
            .checked_add(reward)
            .ok_or(Error::ArithmeticOverflow)?;
        record.last_completed_block = exec::block_height();
        if let Some(target) = target {
            if !record.distinct_targets.contains(&target) {
                record.distinct_targets.push(target);
            }
        }
        Ok(())
    }

    fn record_rejection(state: &mut AanMissionsState, agent: ActorId) -> Result<(), Error> {
        let record = state
            .agent_records
            .entry(agent)
            .or_insert_with(|| Self::empty_agent_record(agent));
        record.rejected_proof_count = record
            .rejected_proof_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Ok(())
    }
}

pub struct Program {
    state: Rc<RefCell<AanMissionsState>>,
}

#[sails_rs::program]
impl Program {
    pub fn create() -> Self {
        Self {
            state: Rc::new(RefCell::new(AanMissionsState::new(msg::source()))),
        }
    }

    pub fn aan_missions(&self) -> AanMissions {
        AanMissions {
            state: self.state.clone(),
        }
    }
}

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
    fn public_types_round_trip() {
        round_trip(Error::Unauthorized);
        round_trip(ClaimStatus::Claimed);
        round_trip(ProofStatus::Pending);
    }

    #[test]
    fn state_init_defaults() {
        let admin = ActorId::from([1u8; 32]);
        let state = AanMissionsState::new(admin);
        assert_eq!(state.admin, admin);
        assert_eq!(state.next_mission_id, 1);
        assert!(state.missions.is_empty());
    }
}
