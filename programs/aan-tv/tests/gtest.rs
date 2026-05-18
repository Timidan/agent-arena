use aan_tv_client::{AanTvClient, AanTvClientCtors, aan_tv::*};
use sails_rs::{client::*, gtest::*};

const ADMIN_ID: u64 = 1;
const PLAYER_A_ID: u64 = 42;

const ONE_VARA: u128 = 1_000_000_000_000;
const HALF_VARA: u128 = 500_000_000_000;
const ONE_HALF_VARA: u128 = 1_500_000_000_000;
const MINT_AMOUNT: u128 = 100 * ONE_VARA;

/// Helper: deploy the program with ADMIN_ID as deployer.
/// Returns (env, program_actor).
async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_tv_client::AanTvClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(PLAYER_A_ID, MINT_AMOUNT);

    let program_code_id = system.submit_code(aan_tv::WASM_BINARY);

    // Deploy as ADMIN_ID so msg::source() in Program::create → admin = ADMIN_ID.
    let env = GtestEnv::new(system, ADMIN_ID.into());

    let program = env
        .deploy::<aan_tv_client::AanTvClientProgram>(program_code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

/// Test: exact buy-in payment → match_id == 1, program balance increased by exactly 1 VARA.
///
/// We check the PROGRAM's balance delta rather than the user's, because in gtest the user
/// balance also decrements by gas costs whose exact value varies. The program balance delta
/// reflects only the retained value (buy_in minus any refund), making it a precise assertion.
#[tokio::test]
async fn test_open_match_collects_buyin_into_pot() {
    let (env, program) = deploy().await;

    // Capture program balance right after deploy (includes existential deposit).
    let prog_balance_before = program.balance();

    let mut service_client = program.aan_tv();

    let result = service_client
        .open_match()
        // Call as PLAYER_A with exactly 1 VARA attached.
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "expected match_id == 1");

    // Program should hold exactly ONE_VARA more than before (the buy-in pot).
    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_after - prog_balance_before,
        ONE_VARA,
        "program balance should increase by exactly 1 VARA (the buy-in)"
    );
}

/// Test: overpayment (1.5 VARA) → success, program retains exactly 1 VARA (0.5 refunded).
#[tokio::test]
async fn test_open_match_overpayment_refunds_excess() {
    let (env, program) = deploy().await;

    let prog_balance_before = program.balance();

    let mut service_client = program.aan_tv();

    let result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_HALF_VARA) // attach 1.5 VARA
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "expected match_id == 1");

    // Program should retain only the buy_in (1 VARA); the excess 0.5 VARA is refunded
    // via CommandReply::with_value and returned to the caller.
    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_after - prog_balance_before,
        ONE_VARA,
        "program should retain only 1 VARA (excess 0.5 VARA refunded)"
    );
}

/// Test: underpayment (0.5 VARA) → Err(InsufficientPayment), program retains nothing.
#[tokio::test]
async fn test_open_match_underpayment_full_refund_and_err() {
    let (env, program) = deploy().await;

    let prog_balance_before = program.balance();

    let mut service_client = program.aan_tv();

    let result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(HALF_VARA) // attach 0.5 VARA (underpayment)
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(aan_tv_client::Error::InsufficientPayment),
        "expected InsufficientPayment error"
    );

    // Program balance must be unchanged — the 0.5 VARA was fully refunded via
    // CommandReply::with_value (NOT msg::send, which silently fails on Err paths
    // in sails-rs 0.10.x).
    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance should be unchanged after underpayment (full refund via CommandReply)"
    );
}
