use aan_missions_client::{
    AanMissionsClient, AanMissionsClientCtors, ClaimStatus, Error, MissionInput, ProofStatus,
    aan_missions::*,
};
use sails_rs::{client::*, gtest::*, prelude::ActorId};

const ADMIN_ID: u64 = 1;
const AGENT_A_ID: u64 = 42;
const AGENT_B_ID: u64 = 43;
const TARGET_ID: u64 = 99;
const MINT_AMOUNT: u128 = 100_000_000_000_000;
const ONE_VARA: u128 = 1_000_000_000_000;
const TWO_VARA: u128 = 2_000_000_000_000;

async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_missions_client::AanMissionsClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(AGENT_A_ID, MINT_AMOUNT);
    system.mint_to(AGENT_B_ID, MINT_AMOUNT);

    let program_code_id = system.submit_code(aan_missions::WASM_BINARY);
    let env = GtestEnv::new(system, ADMIN_ID.into());

    let program = env
        .deploy::<aan_missions_client::AanMissionsClientProgram>(program_code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

fn mission_input(reward: u128, max_approvals: u32) -> MissionInput {
    MissionInput {
        title: "Call AanTvBoard/Sign".to_string(),
        instructions: "Sign the AAN-TV board, then submit the tx hash.".to_string(),
        target_program: Some(ActorId::from(TARGET_ID)),
        required_action: "AanTvBoard/Sign".to_string(),
        reward,
        max_approvals,
        deadline_block: 10_000,
    }
}

async fn create_default_mission(
    program: &sails_rs::client::Actor<aan_missions_client::AanMissionsClientProgram, GtestEnv>,
) -> u64 {
    let mut service_client = program.aan_missions();
    service_client
        .create_mission(mission_input(ONE_VARA, 2))
        .with_actor_id(ADMIN_ID.into())
        .with_value(TWO_VARA)
        .await
        .unwrap()
        .expect("mission create must succeed")
}

#[tokio::test]
async fn create_mission_collects_reward_pool_and_lists_open_mission() {
    let (_env, program) = deploy().await;
    let balance_before = program.balance();
    let mut service_client = program.aan_missions();

    let mission_id = service_client
        .create_mission(mission_input(ONE_VARA, 2))
        .with_actor_id(ADMIN_ID.into())
        .with_value(TWO_VARA)
        .await
        .unwrap();

    assert_eq!(mission_id, Ok(1));
    assert_eq!(program.balance() - balance_before, TWO_VARA);

    let page = service_client.get_open_missions(None, 10).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, 1);
    assert_eq!(page.items[0].remaining_pool, TWO_VARA);
}

#[tokio::test]
async fn create_mission_rejects_non_admin_and_refunds_value() {
    let (_env, program) = deploy().await;
    let balance_before = program.balance();
    let mut service_client = program.aan_missions();

    let result = service_client
        .create_mission(mission_input(ONE_VARA, 1))
        .with_actor_id(AGENT_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(result, Err(Error::Unauthorized));
    assert_eq!(program.balance(), balance_before);
}

#[tokio::test]
async fn claim_submit_and_approve_pays_once() {
    let (_env, program) = deploy().await;
    let mission_id = create_default_mission(&program).await;
    let balance_after_create = program.balance();
    let mut service_client = program.aan_missions();

    let claim_id = service_client
        .claim_mission(mission_id)
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap();
    assert_eq!(claim_id, Ok(1));

    let proof_id = service_client
        .submit_proof(
            mission_id,
            "0xabc123".to_string(),
            "signed board".to_string(),
        )
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap();
    assert_eq!(proof_id, Ok(1));

    let paid = service_client
        .approve_proof(1)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(paid.as_ref().map(|p| p.amount), Ok(ONE_VARA));
    assert_eq!(balance_after_create - program.balance(), ONE_VARA);

    let second = service_client
        .approve_proof(1)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(second, Err(Error::WrongStatus));

    let proof = service_client.get_proof(1).await.unwrap().unwrap();
    assert_eq!(proof.status, ProofStatus::Approved);

    let record = service_client
        .get_agent_record(ActorId::from(AGENT_A_ID))
        .await
        .unwrap();
    assert_eq!(record.completed_count, 1);
    assert_eq!(record.total_rewards_earned, ONE_VARA);
    assert_eq!(record.distinct_targets, vec![ActorId::from(TARGET_ID)]);
}

#[tokio::test]
async fn duplicate_proof_tx_is_rejected() {
    let (_env, program) = deploy().await;
    let mission_id = create_default_mission(&program).await;
    let mut service_client = program.aan_missions();

    service_client
        .claim_mission(mission_id)
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .claim_mission(mission_id)
        .with_actor_id(AGENT_B_ID.into())
        .await
        .unwrap()
        .unwrap();

    let first = service_client
        .submit_proof(mission_id, "0xdup".to_string(), "first".to_string())
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap();
    assert_eq!(first, Ok(1));

    let duplicate = service_client
        .submit_proof(mission_id, "0xdup".to_string(), "second".to_string())
        .with_actor_id(AGENT_B_ID.into())
        .await
        .unwrap();
    assert_eq!(duplicate, Err(Error::DuplicateProof));
}

#[tokio::test]
async fn reject_proof_allows_retry_for_same_claim() {
    let (_env, program) = deploy().await;
    let mission_id = create_default_mission(&program).await;
    let mut service_client = program.aan_missions();

    service_client
        .claim_mission(mission_id)
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .submit_proof(mission_id, "0xbad".to_string(), "bad proof".to_string())
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();

    let reject = service_client
        .reject_proof(1, "tx not found".to_string())
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(reject, Ok(()));

    let retry = service_client
        .submit_proof(mission_id, "0xgood".to_string(), "retry".to_string())
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap();
    assert_eq!(retry, Ok(2));

    let claims = service_client
        .get_claims_by_agent(ActorId::from(AGENT_A_ID), None, 10)
        .await
        .unwrap();
    assert_eq!(claims.items[0].status, ClaimStatus::ProofPending);
    assert_eq!(claims.items[0].latest_proof_id, Some(2));
}

#[tokio::test]
async fn close_mission_refunds_remaining_pool() {
    let (_env, program) = deploy().await;
    let mission_id = create_default_mission(&program).await;
    let balance_after_create = program.balance();
    let mut service_client = program.aan_missions();

    let refund = service_client
        .close_mission(mission_id)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(refund.as_ref().map(|r| r.amount), Ok(TWO_VARA));
    assert_eq!(program.balance(), balance_after_create - TWO_VARA);

    let page = service_client.get_open_missions(None, 10).await.unwrap();
    assert!(page.items.is_empty());
}

#[tokio::test]
async fn pending_proofs_and_stats_are_readable() {
    let (_env, program) = deploy().await;
    let mission_id = create_default_mission(&program).await;
    let mut service_client = program.aan_missions();

    service_client
        .claim_mission(mission_id)
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .submit_proof(mission_id, "0xpending".to_string(), "proof".to_string())
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();

    let proofs = service_client.get_pending_proofs(None, 10).await.unwrap();
    assert_eq!(proofs.items.len(), 1);
    assert_eq!(proofs.items[0].status, ProofStatus::Pending);

    let stats = service_client.get_stats().await.unwrap();
    assert_eq!(stats.total_missions, 1);
    assert_eq!(stats.total_claims, 1);
    assert_eq!(stats.pending_proofs, 1);
    assert_eq!(stats.rewards_remaining, TWO_VARA);
}

#[tokio::test]
async fn dashboard_history_pages_are_readable() {
    let (_env, program) = deploy().await;
    let mission_a = create_default_mission(&program).await;
    let mission_b = create_default_mission(&program).await;
    let mut service_client = program.aan_missions();

    service_client
        .claim_mission(mission_a)
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .submit_proof(mission_a, "0xapproved".to_string(), "good".to_string())
        .with_actor_id(AGENT_A_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .approve_proof(1)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap()
        .unwrap();

    service_client
        .claim_mission(mission_b)
        .with_actor_id(AGENT_B_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .submit_proof(mission_b, "0xrejected".to_string(), "bad".to_string())
        .with_actor_id(AGENT_B_ID.into())
        .await
        .unwrap()
        .unwrap();
    service_client
        .reject_proof(2, "bad proof".to_string())
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap()
        .unwrap();

    let missions_a = service_client.get_missions(None, 1).await.unwrap();
    assert_eq!(missions_a.items.len(), 1);
    assert_eq!(missions_a.items[0].id, 1);
    assert_eq!(missions_a.next_cursor, Some(2));

    let missions_b = service_client
        .get_missions(missions_a.next_cursor, 10)
        .await
        .unwrap();
    assert_eq!(missions_b.items.len(), 1);
    assert_eq!(missions_b.items[0].id, 2);

    let claims = service_client.get_claims(None, 10).await.unwrap();
    assert_eq!(claims.items.len(), 2);
    assert_eq!(claims.items[0].claimant, ActorId::from(AGENT_A_ID));
    assert_eq!(claims.items[1].claimant, ActorId::from(AGENT_B_ID));

    let proofs = service_client.get_proofs(None, 10).await.unwrap();
    assert_eq!(proofs.items.len(), 2);
    assert_eq!(proofs.items[0].status, ProofStatus::Approved);
    assert_eq!(proofs.items[1].status, ProofStatus::Rejected);

    let records_a = service_client.get_agent_records(None, 1).await.unwrap();
    assert_eq!(records_a.items.len(), 1);
    assert_eq!(records_a.items[0].agent, ActorId::from(AGENT_A_ID));
    assert_eq!(records_a.items[0].completed_count, 1);
    assert_eq!(records_a.next_cursor, Some(1));

    let records_b = service_client
        .get_agent_records(records_a.next_cursor, 10)
        .await
        .unwrap();
    assert_eq!(records_b.items.len(), 1);
    assert_eq!(records_b.items[0].agent, ActorId::from(AGENT_B_ID));
    assert_eq!(records_b.items[0].rejected_proof_count, 1);
    assert_eq!(records_b.next_cursor, None);
}
