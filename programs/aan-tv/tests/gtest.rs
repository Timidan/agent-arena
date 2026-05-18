use aan_tv_client::{AanTvClient, AanTvClientCtors, Match, MatchState, aan_tv::*};
use sails_rs::{client::*, gtest::*};
use sha2::{Digest, Sha256};

/// Helper: compute SHA-256(move_value || salt) for use in tests.
fn make_commitment(move_value: u8, salt: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([move_value]);
    hasher.update(salt);
    let out = hasher.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

const ADMIN_ID: u64 = 1;
const PLAYER_A_ID: u64 = 42;
const PLAYER_B_ID: u64 = 43;
const PLAYER_C_ID: u64 = 44;

const ONE_VARA: u128 = 1_000_000_000_000;
const HALF_VARA: u128 = 500_000_000_000;
const ONE_HALF_VARA: u128 = 1_500_000_000_000;
const TWO_VARA: u128 = 2_000_000_000_000;
const MINT_AMOUNT: u128 = 100 * ONE_VARA;

/// Helper: deploy the program with ADMIN_ID as deployer.
/// Returns (env, program_actor).
///
/// Mints MINT_AMOUNT to all player accounts so tests can attach value freely.
async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_tv_client::AanTvClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(PLAYER_A_ID, MINT_AMOUNT);
    system.mint_to(PLAYER_B_ID, MINT_AMOUNT);
    system.mint_to(PLAYER_C_ID, MINT_AMOUNT);

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

// ── AcceptMatch tests ─────────────────────────────────────────────────────────
//
// All AcceptMatch tests assert on program.balance() delta rather than
// user account balances. The reason: in gtest, the user's account balance
// decrements by both the attached value AND gas costs, whose exact magnitude
// varies per execution. The program balance reflects ONLY retained VARA
// (buy_in minus any CommandReply::with_value refund), making it a stable,
// gas-independent assertion target.

/// Happy path: PLAYER_A opens with 1 VARA, PLAYER_B accepts with 1 VARA.
/// Program should hold exactly 2 VARA more than the post-deploy baseline.
#[tokio::test]
async fn test_accept_match_happy_path() {
    let (env, program) = deploy().await;

    let prog_balance_after_deploy = program.balance();

    let mut service_client = program.aan_tv();

    // PLAYER_A opens a match with exactly 1 VARA buy-in.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    let match_id = open_result.expect("open_match should succeed");

    // Program should now hold 1 VARA more than baseline.
    let prog_balance_after_open = program.balance();
    assert_eq!(
        prog_balance_after_open - prog_balance_after_deploy,
        ONE_VARA,
        "program should hold 1 VARA after open"
    );

    // PLAYER_B accepts with exactly 1 VARA buy-in.
    let accept_result = service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(accept_result, Ok(()), "accept_match should succeed");

    // Program should now hold 2 VARA total above deploy baseline (both buy-ins retained).
    let prog_balance_after_accept = program.balance();
    assert_eq!(
        prog_balance_after_accept - prog_balance_after_deploy,
        TWO_VARA,
        "program should hold 2 VARA total (both buy-ins) after accept"
    );
}

/// Underpayment on AcceptMatch: PLAYER_B attaches 0.5 VARA (< 1 VARA buy-in).
/// Expect Err(InsufficientPayment) and program retains only the PLAYER_A buy-in.
#[tokio::test]
async fn test_accept_match_underpayment_full_refund() {
    let (env, program) = deploy().await;

    let prog_balance_after_deploy = program.balance();
    let mut service_client = program.aan_tv();

    // PLAYER_A opens — 1 VARA retained in program.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    let match_id = open_result.expect("open_match should succeed");

    let prog_balance_after_open = program.balance();

    // PLAYER_B tries to accept with only 0.5 VARA — should fail.
    let accept_result = service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(HALF_VARA)
        .await
        .unwrap();

    assert_eq!(
        accept_result,
        Err(aan_tv_client::Error::InsufficientPayment),
        "expected InsufficientPayment on underpayment"
    );

    // Program balance must be unchanged from after-open snapshot:
    // the 0.5 VARA was fully refunded via CommandReply::with_value.
    let prog_balance_after_fail = program.balance();
    assert_eq!(
        prog_balance_after_open, prog_balance_after_fail,
        "program balance should not change after a refunded underpayment"
    );

    // Also verify program holds only 1 VARA above deploy baseline (not 2).
    assert_eq!(
        prog_balance_after_fail - prog_balance_after_deploy,
        ONE_VARA,
        "program should hold exactly 1 VARA (PLAYER_A's buy-in only)"
    );
}

/// Self-accept guard: PLAYER_A opens, then tries to accept their own match.
/// Expect Err(Unauthorized); full refund; program balance unchanged from after-open.
#[tokio::test]
async fn test_accept_match_self_rejected_with_full_refund() {
    let (env, program) = deploy().await;

    let prog_balance_after_deploy = program.balance();
    let mut service_client = program.aan_tv();

    // PLAYER_A opens — 1 VARA retained.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    let match_id = open_result.expect("open_match should succeed");
    let prog_balance_after_open = program.balance();

    // PLAYER_A tries to accept their own match with 1 VARA — anti-self-accept guard fires.
    let accept_result = service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(
        accept_result,
        Err(aan_tv_client::Error::Unauthorized),
        "player_a must not be able to accept their own match"
    );

    // 1 VARA must be fully refunded — program balance stays at after-open level.
    let prog_balance_after_fail = program.balance();
    assert_eq!(
        prog_balance_after_open, prog_balance_after_fail,
        "self-accept refund: program balance must not change"
    );
    assert_eq!(
        prog_balance_after_fail - prog_balance_after_deploy,
        ONE_VARA,
        "program should hold exactly 1 VARA (PLAYER_A's buy-in only)"
    );
}

/// MatchNotFound: no match exists; PLAYER_B calls AcceptMatch(999) with 1 VARA.
/// Expect Err(MatchNotFound); full refund; program balance unchanged from post-deploy baseline.
#[tokio::test]
async fn test_accept_match_unknown_match_rejected_with_full_refund() {
    let (env, program) = deploy().await;

    let prog_balance_after_deploy = program.balance();
    let mut service_client = program.aan_tv();

    // No open_match call — program has no matches yet.
    let accept_result = service_client
        .accept_match(999u64)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(
        accept_result,
        Err(aan_tv_client::Error::MatchNotFound),
        "expected MatchNotFound for unknown match_id"
    );

    // Program balance must equal the deploy baseline — the 1 VARA was fully refunded.
    let prog_balance_after_fail = program.balance();
    assert_eq!(
        prog_balance_after_deploy, prog_balance_after_fail,
        "program balance should be unchanged (MatchNotFound full refund)"
    );
}

/// WrongPhase: PLAYER_A opens, PLAYER_B accepts (Ok), then PLAYER_C tries the same match.
/// Expect Err(WrongPhase); PLAYER_C's 1 VARA fully refunded; program balance unchanged post-accept.
#[tokio::test]
async fn test_accept_match_already_accepted_rejected_with_full_refund() {
    let (env, program) = deploy().await;

    let prog_balance_after_deploy = program.balance();
    let mut service_client = program.aan_tv();

    // PLAYER_A opens.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    let match_id = open_result.expect("open_match should succeed");

    // PLAYER_B accepts — match transitions to InCommit.
    let accept_result = service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(accept_result, Ok(()), "PLAYER_B accept should succeed");

    // Program holds 2 VARA at this point.
    let prog_balance_after_accept = program.balance();
    assert_eq!(
        prog_balance_after_accept - prog_balance_after_deploy,
        TWO_VARA,
        "program should hold 2 VARA after both buy-ins"
    );

    // PLAYER_C tries to accept the same (already accepted) match — wrong phase.
    let second_accept_result = service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();

    assert_eq!(
        second_accept_result,
        Err(aan_tv_client::Error::WrongPhase),
        "expected WrongPhase when match already accepted"
    );

    // PLAYER_C's 1 VARA must be fully refunded — program balance stays at 2 VARA above baseline.
    let prog_balance_after_second_fail = program.balance();
    assert_eq!(
        prog_balance_after_accept, prog_balance_after_second_fail,
        "program balance must not change after WrongPhase refund"
    );
}

// ── Commit tests ──────────────────────────────────────────────────────────────
//
// Salt + move_value choices are documented per test so maintainers can audit.
// All commitments use make_commitment(move_value, &salt) = SHA-256(move_value || salt).

/// Happy path: both players commit successfully, state transitions to InReveal.
///
/// Chosen values:
///   PLAYER_A: move_value = 3, salt = [0xAA; 32]
///   PLAYER_B: move_value = 7, salt = [0xBB; 32]
#[tokio::test]
async fn test_commit_happy_both_players_transitions_to_in_reveal() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // PLAYER_A opens, PLAYER_B accepts.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // PLAYER_A commits.
    let salt_a: [u8; 32] = [0xAA; 32];
    let commitment_a = make_commitment(3, &salt_a);
    let commit_a_result = service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(commit_a_result, Ok(()), "PLAYER_A commit should succeed");

    // State should still be InCommit (only one player committed).
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::InCommit, "after one commit state should still be InCommit");

    // PLAYER_B commits.
    let salt_b: [u8; 32] = [0xBB; 32];
    let commitment_b = make_commitment(7, &salt_b);
    let commit_b_result = service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap();
    assert_eq!(commit_b_result, Ok(()), "PLAYER_B commit should succeed");

    // After both commits, state must have auto-advanced to InReveal.
    let m2 = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m2.state, MatchState::InReveal, "after both commits state should be InReveal");
    assert_eq!(m2.commit_a, Some(commitment_a), "commit_a stored correctly");
    assert_eq!(m2.commit_b, Some(commitment_b), "commit_b stored correctly");
}

/// Committing during the Open phase (before AcceptMatch) is rejected.
///
/// Chosen values: PLAYER_A: move_value = 1, salt = [0x01; 32]
#[tokio::test]
async fn test_commit_during_open_phase_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // PLAYER_A opens — match is still Open, not InCommit.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    let salt_a: [u8; 32] = [0x01; 32];
    let commitment_a = make_commitment(1, &salt_a);

    let commit_result = service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert_eq!(
        commit_result,
        Err(aan_tv_client::Error::WrongPhase),
        "commit during Open phase should be rejected with WrongPhase"
    );
}

/// A stranger (not player_a or player_b) attempting to commit is rejected.
///
/// Chosen values: PLAYER_C: move_value = 5, salt = [0xCC; 32]
#[tokio::test]
async fn test_commit_stranger_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Open + Accept to get into InCommit phase.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    let salt_c: [u8; 32] = [0xCC; 32];
    let commitment_c = make_commitment(5, &salt_c);

    let commit_result = service_client
        .commit(match_id, commitment_c)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        commit_result,
        Err(aan_tv_client::Error::Unauthorized),
        "commit from a stranger should be rejected with Unauthorized"
    );
}

/// Committing twice for the same match returns DuplicateCommit.
///
/// Chosen values: PLAYER_A: move_value = 2, salt = [0x02; 32]
#[tokio::test]
async fn test_commit_double_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Open + Accept to get into InCommit phase.
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    let salt_a: [u8; 32] = [0x02; 32];
    let commitment_a = make_commitment(2, &salt_a);

    // First commit — should succeed.
    let first_commit = service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(first_commit, Ok(()), "first commit should succeed");

    // Second commit from same player — should fail.
    let second_commit = service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(
        second_commit,
        Err(aan_tv_client::Error::DuplicateCommit),
        "second commit from same player should return DuplicateCommit"
    );
}

/// Committing against a non-existent match returns MatchNotFound.
///
/// Chosen values: move_value = 9, salt = [0x09; 32]
#[tokio::test]
async fn test_commit_unknown_match_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let salt_a: [u8; 32] = [0x09; 32];
    let commitment_a = make_commitment(9, &salt_a);

    let commit_result = service_client
        .commit(999u64, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert_eq!(
        commit_result,
        Err(aan_tv_client::Error::MatchNotFound),
        "commit against unknown match_id should return MatchNotFound"
    );
}

// ── Reveal tests ──────────────────────────────────────────────────────────────

/// Helper: open + accept + have both players commit, returning match_id and salt choices.
///
/// Chosen values:
///   PLAYER_A: move_value = 4, salt = [0xA4; 32]
///   PLAYER_B: move_value = 8, salt = [0xB8; 32]
async fn setup_committed_match(
    service_client: &mut sails_rs::client::Service<AanTvImpl, GtestEnv>,
) -> (u64, u8, [u8; 32], u8, [u8; 32]) {
    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    let move_a: u8 = 4;
    let salt_a: [u8; 32] = [0xA4; 32];
    let commitment_a = make_commitment(move_a, &salt_a);

    let move_b: u8 = 8;
    let salt_b: [u8; 32] = [0xB8; 32];
    let commitment_b = make_commitment(move_b, &salt_b);

    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    (match_id, move_a, salt_a, move_b, salt_b)
}

/// Happy path: both players reveal successfully. State stays InReveal (Resolve is Task 11).
///
/// Chosen values: PLAYER_A: move_value = 4, salt = [0xA4; 32]
///                PLAYER_B: move_value = 8, salt = [0xB8; 32]
#[tokio::test]
async fn test_reveal_happy_both_players() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let (match_id, move_a, salt_a, move_b, salt_b) =
        setup_committed_match(&mut service_client).await;

    // PLAYER_A reveals.
    let reveal_a = service_client
        .reveal(match_id, move_a, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(reveal_a, Ok(()), "PLAYER_A reveal should succeed");

    // PLAYER_B reveals.
    let reveal_b = service_client
        .reveal(match_id, move_b, salt_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap();
    assert_eq!(reveal_b, Ok(()), "PLAYER_B reveal should succeed");

    // Verify state via get_match: both reveals stored, state still InReveal.
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("match should exist");

    assert_eq!(m.reveal_a, Some(move_a), "reveal_a should be stored");
    assert_eq!(m.reveal_b, Some(move_b), "reveal_b should be stored");
    assert_eq!(
        m.state,
        MatchState::InReveal,
        "state should stay InReveal until Resolve is called (Task 11)"
    );
}

/// Revealing with wrong salt returns RevealMismatch. Caller can then retry with correct salt.
///
/// Chosen values: PLAYER_A: move_value = 6, salt = [0xA4; 32] (correct)
///                Wrong reveal attempt: move_value = 6, salt = [0xFF; 32]
#[tokio::test]
async fn test_reveal_wrong_salt_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let (match_id, move_a, salt_a, _move_b, _salt_b) =
        setup_committed_match(&mut service_client).await;

    // Wrong salt attempt.
    let wrong_salt: [u8; 32] = [0xFF; 32];
    let bad_reveal = service_client
        .reveal(match_id, move_a, wrong_salt)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(
        bad_reveal,
        Err(aan_tv_client::Error::RevealMismatch),
        "wrong salt should return RevealMismatch"
    );

    // Correct salt retry — must succeed (caller may re-call before deadline).
    let good_reveal = service_client
        .reveal(match_id, move_a, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(good_reveal, Ok(()), "correct salt retry should succeed");
}

/// Revealing while still in the InCommit phase (only one commit done) returns WrongPhase.
///
/// Setup: Open + Accept + PLAYER_A commits only (PLAYER_B doesn't commit).
/// PLAYER_B tries to Reveal immediately — state is InCommit, not InReveal.
///
/// Chosen values: PLAYER_A: move_value = 4, salt = [0xA4; 32]
///                PLAYER_B: move_value = 8, salt = [0xB8; 32] (used only for reveal attempt)
#[tokio::test]
async fn test_reveal_during_commit_phase_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let open_result = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap();
    let match_id = open_result.expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Only PLAYER_A commits — state stays InCommit.
    let salt_a: [u8; 32] = [0xA4; 32];
    let commitment_a = make_commitment(4, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    // PLAYER_B tries to reveal before both players committed.
    let salt_b: [u8; 32] = [0xB8; 32];
    let reveal_result = service_client
        .reveal(match_id, 8, salt_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap();

    assert_eq!(
        reveal_result,
        Err(aan_tv_client::Error::WrongPhase),
        "reveal during InCommit phase should return WrongPhase"
    );
}

/// A stranger (not player_a or player_b) attempting to reveal is rejected.
///
/// Chosen values: PLAYER_C: move_value = 5, salt = [0xCC; 32]
#[tokio::test]
async fn test_reveal_stranger_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let (match_id, _move_a, _salt_a, _move_b, _salt_b) =
        setup_committed_match(&mut service_client).await;

    // PLAYER_C tries to reveal — not a participant.
    let salt_c: [u8; 32] = [0xCC; 32];
    let reveal_result = service_client
        .reveal(match_id, 5, salt_c)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        reveal_result,
        Err(aan_tv_client::Error::Unauthorized),
        "reveal from a stranger should return Unauthorized"
    );
}
