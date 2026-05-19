use aan_tv_tip_client::{AanTvTipClient, AanTvTipClientCtors, Error, aan_tv_tip::*};
use sails_rs::{client::*, gtest::*, prelude::ActorId};

const ADMIN_ID: u64 = 1;
const SENDER_ID: u64 = 42;
const RECIPIENT_ID: u64 = 43;
const MINT_AMOUNT: u128 = 100_000_000_000_000;
const ONE_VARA: u128 = 1_000_000_000_000;

async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_tv_tip_client::AanTvTipClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(SENDER_ID, MINT_AMOUNT);
    system.mint_to(RECIPIENT_ID, MINT_AMOUNT);

    let program_code_id = system.submit_code(aan_tv_tip::WASM_BINARY);

    let env = GtestEnv::new(system, ADMIN_ID.into());

    let program = env
        .deploy::<aan_tv_tip_client::AanTvTipClientProgram>(program_code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn tip_happy_path_99_1_split() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // Check protocol balance before
    let balance_before = service_client
        .get_protocol_balance()
        .await
        .unwrap();
    assert_eq!(balance_before, 0);

    let result = service_client
        .tip(ActorId::from(RECIPIENT_ID), "great work!".to_string())
        .with_actor_id(SENDER_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "first tip should return tip_id = 1");

    // Verify protocol balance: 1% of 1 VARA = 10_000_000_000 plancks
    let balance_after = service_client
        .get_protocol_balance()
        .await
        .unwrap();
    assert_eq!(
        balance_after,
        10_000_000_000u128,
        "protocol should hold 1% (10B plancks)"
    );

    // Verify tip record
    let tip = service_client
        .get_tip(1)
        .await
        .unwrap()
        .expect("tip 1 should exist");

    assert_eq!(tip.amount, ONE_VARA);
    assert_eq!(tip.protocol_cut, 10_000_000_000u128);
    assert_eq!(tip.recipient_received, 990_000_000_000u128);
    assert_eq!(tip.sender, ActorId::from(SENDER_ID));
    assert_eq!(tip.recipient, ActorId::from(RECIPIENT_ID));
}

#[tokio::test]
async fn tip_anti_self_rejected() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // Sender == recipient should be rejected
    let result = service_client
        .tip(ActorId::from(SENDER_ID), "tipping myself".to_string())
        .with_actor_id(SENDER_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(result, Err(Error::InvalidArg), "self-tip should be rejected");
}

#[tokio::test]
async fn tip_zero_value_rejected() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // Zero value should be rejected
    let result = service_client
        .tip(ActorId::from(RECIPIENT_ID), "empty tip".to_string())
        .with_actor_id(SENDER_ID.into())
        .with_value(0)
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(Error::InsufficientPayment),
        "zero value should return InsufficientPayment"
    );
}

#[tokio::test]
async fn tip_note_too_long_rejected() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // 201 bytes — over limit
    let long_note = "a".repeat(201);
    let result = service_client
        .tip(ActorId::from(RECIPIENT_ID), long_note)
        .with_actor_id(SENDER_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(result, Err(Error::InvalidArg), "note >200 bytes should be rejected");
}

#[tokio::test]
async fn sweep_admin_only() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // First tip to generate protocol balance
    let _ = service_client
        .tip(ActorId::from(RECIPIENT_ID), "funding protocol".to_string())
        .with_actor_id(SENDER_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    // Non-admin sweep attempt should fail
    let result = service_client
        .sweep(10_000_000_000u128)
        .with_actor_id(SENDER_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Err(Error::Unauthorized), "non-admin sweep should be rejected");
}

#[tokio::test]
async fn sweep_only_protocol_balance() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_tip();

    // Tip to generate 10_000_000_000 protocol balance (1% of 1 VARA)
    let _ = service_client
        .tip(ActorId::from(RECIPIENT_ID), "funding protocol".to_string())
        .with_actor_id(SENDER_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    // Sweep more than protocol_balance should fail
    let result = service_client
        .sweep(ONE_VARA) // try to sweep the full VARA — only 1% is ours
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(Error::InsufficientFunds),
        "sweep > protocol_balance should fail"
    );

    // Sweep exactly protocol_balance should succeed
    let result = service_client
        .sweep(10_000_000_000u128)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Ok(()), "sweeping exactly protocol_balance should succeed");
}
