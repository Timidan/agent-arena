use aan_tv_data_client::{AanTvDataClient, AanTvDataClientCtors, Error, StatBatchEntry, StatKind, aan_tv_data::*};
use sails_rs::{client::*, gtest::*, prelude::ActorId};

const ADMIN_ID: u64 = 1;
const SUBMITTER_ID: u64 = 42;
const APP_ID: u64 = 100;
const MINT_AMOUNT: u128 = 100_000_000_000_000;
const SUBMIT_FEE: u128 = 10_000_000_000; // 0.01 VARA
const ONE_VARA: u128 = 1_000_000_000_000;

async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_tv_data_client::AanTvDataClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(SUBMITTER_ID, MINT_AMOUNT);

    let program_code_id = system.submit_code(aan_tv_data::WASM_BINARY);

    let env = GtestEnv::new(system, ADMIN_ID.into());

    let program = env
        .deploy::<aan_tv_data_client::AanTvDataClientProgram>(program_code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn submit_stat_happy_path() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_data();

    let result = service_client
        .submit_stat(
            ActorId::from(APP_ID),
            StatKind::Calls,
            42,
            "hourly count".to_string(),
        )
        .with_actor_id(SUBMITTER_ID.into())
        .with_value(SUBMIT_FEE)
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "first stat should return stat_id = 1");

    // Verify protocol balance
    let balance = service_client
        .get_protocol_balance()
        .await
        .unwrap();

    assert_eq!(balance, SUBMIT_FEE, "protocol should hold 0.01 VARA");
}

#[tokio::test]
async fn submit_stat_underpayment_refund() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_data();

    // Attach less than submit_fee
    let result = service_client
        .submit_stat(
            ActorId::from(APP_ID),
            StatKind::Calls,
            1,
            "underpaid".to_string(),
        )
        .with_actor_id(SUBMITTER_ID.into())
        .with_value(SUBMIT_FEE - 1) // 1 planck short
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(Error::InsufficientPayment),
        "underpayment should be rejected"
    );

    // Protocol balance should still be 0
    let balance = service_client
        .get_protocol_balance()
        .await
        .unwrap();
    assert_eq!(balance, 0, "protocol balance should remain 0 on rejected call");
}

#[tokio::test]
async fn submit_batch_admin_only() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_data();

    let batch = vec![
        StatBatchEntry {
            app: ActorId::from(APP_ID),
            kind: StatKind::Calls,
            value: 100,
            note: "batch note".to_string(),
        },
    ];

    // Non-admin call should fail
    let result = service_client
        .submit_batch(batch.clone())
        .with_actor_id(SUBMITTER_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Err(Error::Unauthorized), "non-admin batch should be rejected");

    // Admin call should succeed
    let result = service_client
        .submit_batch(batch)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Ok(1u32), "admin batch of 1 entry should insert 1");
}

#[tokio::test]
async fn sweep_admin_only() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_data();

    // Generate some protocol balance first
    let _ = service_client
        .submit_stat(
            ActorId::from(APP_ID),
            StatKind::Calls,
            1,
            "funding".to_string(),
        )
        .with_actor_id(SUBMITTER_ID.into())
        .with_value(SUBMIT_FEE)
        .await
        .unwrap();

    // Non-admin sweep should fail
    let result = service_client
        .sweep(SUBMIT_FEE)
        .with_actor_id(SUBMITTER_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Err(Error::Unauthorized), "non-admin sweep should fail");

    // Admin sweep of exact balance should succeed
    let result = service_client
        .sweep(SUBMIT_FEE)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Ok(()), "admin sweep should succeed");
}
