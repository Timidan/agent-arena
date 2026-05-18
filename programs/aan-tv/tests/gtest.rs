use aan_tv_client::{AanTvClient, AanTvClientCtors, Match, MatchState, MatchOutcome, CoverageRequest, CoverageKind, aan_tv::*};
use sails_rs::{client::*, gtest::*, prelude::ActorId};
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

// ── Resolve tests ─────────────────────────────────────────────────────────────
//
// SHA-256 move choices used across resolve tests:
//
//  "Player A wins" case:
//    move_a = 70, salt_a = [0xA1; 32] → reveal_a % 100 = 70
//    move_b = 30, salt_b = [0xB1; 32] → reveal_b % 100 = 30
//    70 > 30 → b (30) is NOT > a (70) → player_a wins.
//
//  "Tie goes to player_a" case:
//    move_a = 55, salt_a = [0xA2; 32] → reveal_a % 100 = 55
//    move_b = 55, salt_b = [0xB2; 32] → reveal_b % 100 = 55
//    55 == 55 → b is NOT > a → player_a wins (tie breaks to player_a).
//
//  "Player B wins" case:
//    move_a = 20, salt_a = [0xA3; 32] → reveal_a % 100 = 20
//    move_b = 80, salt_b = [0xB3; 32] → reveal_b % 100 = 80
//    80 > 20 → b > a → player_b wins.
//
// Payout math (protocol_bps = 1000 = 10%, pot = 2 VARA = 2_000_000_000_000):
//   winner_cut = (2_000_000_000_000 * 9000) / 10_000 = 1_800_000_000_000
//   protocol_cut = 2_000_000_000_000 - 1_800_000_000_000 = 200_000_000_000
//
// EXISTENTIAL_DEPOSIT = 1_000_000_000_000 (1 VARA).
// After deploy: program.balance() == 1 VARA (existential deposit).
// After both buy-ins: program.balance() == 3 VARA.
// After resolve: program.balance() == 1 VARA (ED) + 0.2 VARA (protocol) = 1.2 VARA.
// After sweep(0.2 VARA): program.balance() == 1 VARA (back to ED).

const WINNER_CUT: u128 = 1_800_000_000_000; // 1.8 VARA
const PROTOCOL_CUT: u128 = 200_000_000_000; // 0.2 VARA
const EXISTENTIAL_DEPOSIT: u128 = 1_000_000_000_000; // 1 VARA

/// Helper: run a full Open → Accept → Commit(A) → Commit(B) → Reveal(A) → Reveal(B)
/// sequence and return the match_id and the pot size (2 VARA).
///
/// Uses the "Player A wins" move set (move_a=70, move_b=30) by default.
async fn setup_revealed_match_a_wins(
    service_client: &mut sails_rs::client::Service<AanTvImpl, GtestEnv>,
) -> u64 {
    // Open
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    // Accept
    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Commit A: move_a=70, salt_a=[0xA1;32]
    let salt_a: [u8; 32] = [0xA1; 32];
    let commitment_a = make_commitment(70, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    // Commit B: move_b=30, salt_b=[0xB1;32]
    let salt_b: [u8; 32] = [0xB1; 32];
    let commitment_b = make_commitment(30, &salt_b);
    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    // Reveal A: move_a=70 → 70%100=70
    service_client
        .reveal(match_id, 70, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A reveal should succeed");

    // Reveal B: move_b=30 → 30%100=30; 30 is NOT > 70, so player_a wins
    service_client
        .reveal(match_id, 30, salt_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B reveal should succeed");

    match_id
}

/// Helper: run a full match with move values chosen so player_b wins (move_b=80 > move_a=20).
async fn setup_revealed_match_b_wins(
    service_client: &mut sails_rs::client::Service<AanTvImpl, GtestEnv>,
) -> u64 {
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Commit A: move_a=20, salt_a=[0xA3;32]
    let salt_a: [u8; 32] = [0xA3; 32];
    let commitment_a = make_commitment(20, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    // Commit B: move_b=80, salt_b=[0xB3;32]
    let salt_b: [u8; 32] = [0xB3; 32];
    let commitment_b = make_commitment(80, &salt_b);
    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    // Reveal A: 20%100=20
    service_client
        .reveal(match_id, 20, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A reveal should succeed");

    // Reveal B: 80%100=80; 80 > 20, so player_b wins
    service_client
        .reveal(match_id, 80, salt_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B reveal should succeed");

    match_id
}

/// Happy path: player_a wins (reveal_a%100=70 > reveal_b%100=30).
/// PLAYER_C calls Resolve.
///
/// Assertions:
///   - Returns Ok(PLAYER_A_ID as ActorId).
///   - match.winner == PLAYER_A, match.state == Resolved.
///   - program balance decreased by exactly WINNER_CUT (1.8 VARA) — the payout left the program.
///   - program retains exactly PROTOCOL_CUT (0.2 VARA) above the post-resolve residual:
///     program.balance() == EXISTENTIAL_DEPOSIT + PROTOCOL_CUT == 1.2 VARA.
///
/// Funds conservation: PLAYER_A receives 1.8 VARA (in mailbox), program keeps 0.2 VARA.
/// Total out = 1.8 VARA; total retained = 0.2 VARA; total in = 2 VARA. Balanced.
#[tokio::test]
async fn test_resolve_pays_winner_90_pct_and_protocol_10_pct() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_after_deploy = program.balance();
    assert_eq!(prog_balance_after_deploy, EXISTENTIAL_DEPOSIT, "deploy baseline == ED");

    let match_id = setup_revealed_match_a_wins(&mut service_client).await;

    // After two buy-ins: ED + 2 VARA in program.
    let prog_balance_before_resolve = program.balance();
    assert_eq!(
        prog_balance_before_resolve,
        EXISTENTIAL_DEPOSIT + TWO_VARA,
        "program should hold ED + 2 VARA before resolve"
    );

    // PLAYER_C calls resolve — they pay gas, A/B balances only move by payout.
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Winner(ActorId::from(PLAYER_A_ID))),
        "resolve must return Ok(MatchOutcome::Winner(PLAYER_A))"
    );

    // Strengthen: verify PLAYER_A's wallet actually received the winner cut.
    // In gtest, msg::send_bytes_with_gas lands in the mailbox and balance_of
    // accounts for it after processing. Check the balance increased by WINNER_CUT.
    let player_a_balance = env.system().balance_of(PLAYER_A_ID);
    // PLAYER_A started with MINT_AMOUNT (100 VARA), paid ONE_VARA buy-in, received WINNER_CUT (1.8 VARA).
    // Net: MINT_AMOUNT - ONE_VARA + WINNER_CUT = 100.8 VARA (minus gas costs).
    // We verify the balance is greater than MINT_AMOUNT - ONE_VARA (i.e., the refund landed).
    assert!(
        player_a_balance > MINT_AMOUNT - ONE_VARA,
        "PLAYER_A balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after winning payout",
        player_a_balance,
        MINT_AMOUNT - ONE_VARA
    );

    // Program must have sent 1.8 VARA to winner — program balance drops by WINNER_CUT.
    let prog_balance_after_resolve = program.balance();
    assert_eq!(
        prog_balance_before_resolve - prog_balance_after_resolve,
        WINNER_CUT,
        "program should have paid out exactly WINNER_CUT (1.8 VARA) to winner"
    );

    // Program retains ED + 0.2 VARA (the protocol cut).
    assert_eq!(
        prog_balance_after_resolve,
        EXISTENTIAL_DEPOSIT + PROTOCOL_CUT,
        "program balance == ED + protocol_cut after resolve"
    );

    // Verify match state via get_match.
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::Resolved, "match must be Resolved");
    assert_eq!(
        m.winner,
        Some(ActorId::from(PLAYER_A_ID)),
        "match.winner must be PLAYER_A"
    );
}

/// Tie case: reveal_a%100 == reveal_b%100 → ties go to player_a per spec.
///
/// Move set: move_a=55 (55%100=55), move_b=55 (55%100=55). b NOT > a → player_a wins.
#[tokio::test]
async fn test_resolve_tie_goes_to_player_a() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Set up a match with tied reveals.
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Both commit 55 with distinct salts.
    let salt_a: [u8; 32] = [0xA2; 32];
    let commitment_a = make_commitment(55, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    let salt_b: [u8; 32] = [0xB2; 32];
    let commitment_b = make_commitment(55, &salt_b);
    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    service_client
        .reveal(match_id, 55, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A reveal should succeed");

    service_client
        .reveal(match_id, 55, salt_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B reveal should succeed");

    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Winner(ActorId::from(PLAYER_A_ID))),
        "tie must go to player_a per spec — Ok(MatchOutcome::Winner(PLAYER_A))"
    );

    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.winner, Some(ActorId::from(PLAYER_A_ID)), "match.winner == PLAYER_A on tie");
}

/// Player B wins when reveal_b%100 > reveal_a%100.
///
/// Move set: move_a=20 (20%100=20), move_b=80 (80%100=80). 80 > 20 → player_b wins.
///
/// Assertions:
///   - Returns Ok(PLAYER_B_ID).
///   - program balance decreased by WINNER_CUT.
///   - Funds conservation holds: ED + 2 VARA in → ED + 0.2 VARA retained + 1.8 VARA paid out.
#[tokio::test]
async fn test_resolve_player_b_wins_when_higher() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let match_id = setup_revealed_match_b_wins(&mut service_client).await;

    let prog_balance_before = program.balance();
    assert_eq!(prog_balance_before, EXISTENTIAL_DEPOSIT + TWO_VARA, "before resolve: ED + 2 VARA");

    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Winner(ActorId::from(PLAYER_B_ID))),
        "PLAYER_B (80 mod 100) beats PLAYER_A (20 mod 100)"
    );

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before - prog_balance_after,
        WINNER_CUT,
        "program paid out exactly WINNER_CUT to PLAYER_B"
    );
    assert_eq!(
        prog_balance_after,
        EXISTENTIAL_DEPOSIT + PROTOCOL_CUT,
        "protocol cut (0.2 VARA) retained in program"
    );

    // Strengthen: verify PLAYER_B's wallet actually received the winner cut.
    let player_b_balance = env.system().balance_of(PLAYER_B_ID);
    assert!(
        player_b_balance > MINT_AMOUNT - ONE_VARA,
        "PLAYER_B balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after winning payout",
        player_b_balance,
        MINT_AMOUNT - ONE_VARA
    );

    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::Resolved);
    assert_eq!(m.winner, Some(ActorId::from(PLAYER_B_ID)));
}

/// Idempotent rejection: second call to Resolve on an already-Resolved match returns WrongPhase.
/// Balances must not change on the second call.
#[tokio::test]
async fn test_resolve_idempotent_second_call_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let match_id = setup_revealed_match_a_wins(&mut service_client).await;

    // First resolve: should succeed with a winner outcome.
    let first_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();
    assert!(
        matches!(first_result, Ok(MatchOutcome::Winner(_))),
        "first resolve should return Ok(MatchOutcome::Winner(...))"
    );

    let prog_balance_after_first = program.balance();

    // Second resolve: match is Resolved → WrongPhase.
    let second_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();
    assert_eq!(
        second_result,
        Err(aan_tv_client::Error::WrongPhase),
        "second resolve must return WrongPhase (match already Resolved)"
    );

    // Program balance must not change on second call.
    let prog_balance_after_second = program.balance();
    assert_eq!(
        prog_balance_after_first, prog_balance_after_second,
        "program balance must not change on second resolve attempt"
    );
}

/// Resolve during InCommit phase before the commit deadline → DeadlineNotReached.
///
/// Open + Accept → state is InCommit. We resolve immediately without advancing blocks,
/// so block_height is well below commit_deadline_block (set at block + 200).
#[tokio::test]
async fn test_resolve_during_commit_phase_before_deadline_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Open + Accept → state is InCommit.
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Resolve while in InCommit + before deadline → DeadlineNotReached.
    // (commit_deadline_block = accept_block + 200; we've only advanced ~2 blocks.)
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Err(aan_tv_client::Error::DeadlineNotReached),
        "resolve during InCommit before deadline must return DeadlineNotReached"
    );
}

/// Resolve before reveal_deadline_block when only one player has revealed: DeadlineNotReached.
///
/// Setup: Open → Accept → Commit(A) → Commit(B) → Reveal(A only).
/// Block height is well below reveal_deadline (set at AcceptMatch as block_height + 200).
/// The sails gtest auto-runs a few blocks per message but nowhere near 200.
#[tokio::test]
async fn test_resolve_before_reveal_deadline_with_only_one_reveal_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Both commit to advance to InReveal.
    let salt_a: [u8; 32] = [0xA1; 32];
    let commitment_a = make_commitment(70, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    let salt_b: [u8; 32] = [0xB1; 32];
    let commitment_b = make_commitment(30, &salt_b);
    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    // Only PLAYER_A reveals.
    service_client
        .reveal(match_id, 70, salt_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A reveal should succeed");

    // Resolve immediately (deadline not reached — each message advances block by ~1).
    // reveal_deadline_block was set at AcceptMatch time as block_height + 200.
    // We've only consumed ~5-10 blocks; deadline is at ~200+.
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Err(aan_tv_client::Error::DeadlineNotReached),
        "resolve before reveal deadline with one reveal must return DeadlineNotReached"
    );
}

/// Resolve with unknown match_id returns MatchNotFound.
#[tokio::test]
async fn test_resolve_unknown_match_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let resolve_result = service_client
        .resolve(999u64)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Err(aan_tv_client::Error::MatchNotFound),
        "resolve of unknown match_id must return MatchNotFound"
    );
}

// ── Sweep tests ───────────────────────────────────────────────────────────────

/// Non-admin calling Sweep returns Unauthorized. Program balance unchanged.
#[tokio::test]
async fn test_sweep_admin_only() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    // PLAYER_A tries to sweep — not the admin.
    let sweep_result = service_client
        .sweep(PROTOCOL_CUT)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert_eq!(
        sweep_result,
        Err(aan_tv_client::Error::Unauthorized),
        "non-admin sweep must return Unauthorized"
    );

    // Program balance must be unchanged.
    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must not change after unauthorized sweep attempt"
    );
}

/// Admin can pull the accumulated protocol cut after a match resolves.
///
/// Setup: run a full match (PLAYER_A wins) → resolve → program has ED + 0.2 VARA.
/// Admin sweeps 0.2 VARA → program back to ED (1 VARA).
///
/// Funds conservation:
///   Total in: 2 VARA (buy-ins).
///   Paid out to winner: 1.8 VARA.
///   Swept by admin: 0.2 VARA.
///   Net program delta (above ED): 0. Balanced.
#[tokio::test]
async fn test_sweep_admin_can_pull_protocol_cut() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Run a full match to completion.
    let match_id = setup_revealed_match_a_wins(&mut service_client).await;
    service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("resolve should succeed");

    // At this point: program balance == ED + PROTOCOL_CUT == 1.2 VARA.
    let prog_balance_before_sweep = program.balance();
    assert_eq!(
        prog_balance_before_sweep,
        EXISTENTIAL_DEPOSIT + PROTOCOL_CUT,
        "before sweep: program holds ED + protocol_cut"
    );

    // Admin sweeps the protocol cut.
    let sweep_result = service_client
        .sweep(PROTOCOL_CUT)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(sweep_result, Ok(()), "admin sweep should succeed");

    // Program balance must be back to ED (all fees swept).
    let prog_balance_after_sweep = program.balance();
    assert_eq!(
        prog_balance_before_sweep - prog_balance_after_sweep,
        PROTOCOL_CUT,
        "program balance should decrease by exactly PROTOCOL_CUT on sweep"
    );
    assert_eq!(
        prog_balance_after_sweep,
        EXISTENTIAL_DEPOSIT,
        "after sweep: program balance == ED"
    );
}

/// Sweeping more than protocol_balance fails with InsufficientFunds.
/// Program balance is unchanged.
///
/// A fresh deploy has protocol_balance=0. Sweeping 100 VARA is blocked before
/// the send even fires (InsufficientFunds returned immediately).
#[tokio::test]
async fn test_sweep_more_than_balance_fails_gracefully() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();
    assert_eq!(prog_balance_before, EXISTENTIAL_DEPOSIT, "fresh deploy: program holds only ED");

    // Admin tries to sweep 100 VARA when protocol_balance == 0.
    let sweep_result = service_client
        .sweep(100 * ONE_VARA)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(
        sweep_result,
        Err(aan_tv_client::Error::InsufficientFunds),
        "sweeping above protocol_balance should return InsufficientFunds"
    );

    // Program balance must be unchanged.
    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must not change after failed sweep"
    );
}

// ── Coverage constants ────────────────────────────────────────────────────────

const COVERAGE_FEE: u128 = 100_000_000_000; // 0.1 VARA
const HALF_COVERAGE_FEE: u128 = 50_000_000_000; // 0.05 VARA
const FIVE_COVERAGE_FEE: u128 = 500_000_000_000; // 0.5 VARA

// A separate actor to use as a target_program (different from requester).
const TARGET_PROGRAM_ID: u64 = 100;

// ── RequestCoverage tests ─────────────────────────────────────────────────────

/// Happy path: exact 0.1 VARA attached. Returns Ok(1), program balance increases by 0.1 VARA.
#[tokio::test]
async fn test_request_coverage_collects_fee() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    let result = service_client
        .request_coverage(
            CoverageKind::MarketResolved,
            Some(target),
            "ETH market #5 resolved YES".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "expected coverage_id == 1");

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_after - prog_balance_before,
        COVERAGE_FEE,
        "program balance should increase by exactly 0.1 VARA (coverage fee)"
    );
}

/// Overpayment: 0.5 VARA attached. Returns Ok(1), program retains only 0.1 VARA (0.4 refunded).
#[tokio::test]
async fn test_request_coverage_overpayment_refunds_excess() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    let result = service_client
        .request_coverage(
            CoverageKind::LaunchedApp,
            Some(target),
            "new app launched".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(FIVE_COVERAGE_FEE) // 0.5 VARA
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "expected coverage_id == 1");

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_after - prog_balance_before,
        COVERAGE_FEE,
        "program should retain only 0.1 VARA; excess 0.4 VARA refunded via reply"
    );
}

/// Underpayment: 0.05 VARA attached. Returns Err(InsufficientPayment), program balance unchanged.
#[tokio::test]
async fn test_request_coverage_underpayment_full_refund_and_err() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    let result = service_client
        .request_coverage(
            CoverageKind::Custom,
            Some(target),
            "custom event".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(HALF_COVERAGE_FEE) // 0.05 VARA — underpayment
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(aan_tv_client::Error::InsufficientPayment),
        "expected InsufficientPayment on underpayment"
    );

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must be unchanged after underpayment (full refund via CommandReply)"
    );
}

/// Self-cover guard: requester sets target_program = themselves. Err(SelfCover), full refund.
#[tokio::test]
async fn test_request_coverage_self_target_rejected_with_full_refund() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    // PLAYER_A sets target_program = PLAYER_A (self-promotion)
    let player_a_actor: ActorId = ActorId::from(PLAYER_A_ID);
    let result = service_client
        .request_coverage(
            CoverageKind::MarketResolved,
            Some(player_a_actor),
            "my own app did something cool".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(aan_tv_client::Error::SelfCover),
        "expected SelfCover when requester == target_program"
    );

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must be unchanged after SelfCover rejection (full refund)"
    );
}

/// Long hint rejected: 241-char hint → Err(InvalidArg), full refund.
#[tokio::test]
async fn test_request_coverage_long_hint_rejected_with_full_refund() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    // Build a 241-char (241-byte for ASCII) hint — one over the limit.
    let long_hint: String = "x".repeat(241);
    assert_eq!(long_hint.len(), 241, "hint must be 241 chars for this test");

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    let result = service_client
        .request_coverage(
            CoverageKind::BountyCompleted,
            Some(target),
            long_hint,
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(aan_tv_client::Error::InvalidArg),
        "expected InvalidArg when hint exceeds 240 bytes"
    );

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must be unchanged after InvalidArg rejection (full refund)"
    );
}

// ── GetCoverageQueue tests ────────────────────────────────────────────────────

/// Fresh deploy: GetCoverageQueue returns empty items and no next_cursor.
#[tokio::test]
async fn test_coverage_queue_empty() {
    let (env, program) = deploy().await;
    let service_client = program.aan_tv();

    let page = service_client
        .get_coverage_queue(None, 10)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert!(page.items.is_empty(), "queue should be empty after fresh deploy");
    assert_eq!(page.next_cursor, None, "next_cursor should be None for empty queue");
}

/// Pagination: 5 requests posted, paginate 2 then 3.
#[tokio::test]
async fn test_coverage_queue_paginates() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);

    // Post 5 coverage requests from multiple players.
    for i in 0..2u64 {
        let caller = if i % 2 == 0 { PLAYER_A_ID } else { PLAYER_B_ID };
        service_client
            .request_coverage(
                CoverageKind::MarketResolved,
                Some(target),
                format!("event {}", i),
            )
            .with_actor_id(caller.into())
            .with_value(COVERAGE_FEE)
            .await
            .unwrap()
            .expect("request_coverage should succeed");
    }
    // PLAYER_C for variety.
    service_client
        .request_coverage(
            CoverageKind::MatchSettled,
            Some(target),
            "event 2".into(),
        )
        .with_actor_id(PLAYER_C_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    service_client
        .request_coverage(
            CoverageKind::LaunchedApp,
            Some(target),
            "event 3".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    service_client
        .request_coverage(
            CoverageKind::Custom,
            Some(target),
            "event 4".into(),
        )
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    // First page: cursor=None, limit=2 → returns IDs 1,2; next_cursor=Some(3).
    let page1 = service_client
        .get_coverage_queue(None, 2)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert_eq!(page1.items.len(), 2, "first page should have 2 items");
    assert_eq!(page1.items[0].id, 1, "first item id should be 1");
    assert_eq!(page1.items[1].id, 2, "second item id should be 2");
    assert_eq!(page1.next_cursor, Some(3), "next_cursor should be 3");

    // Second page: cursor=Some(3), limit=10 → returns IDs 3,4,5; next_cursor=None.
    let page2 = service_client
        .get_coverage_queue(Some(3), 10)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();

    assert_eq!(page2.items.len(), 3, "second page should have 3 items");
    assert_eq!(page2.items[0].id, 3, "first item on second page id should be 3");
    assert_eq!(page2.items[1].id, 4, "second item on second page id should be 4");
    assert_eq!(page2.items[2].id, 5, "third item on second page id should be 5");
    assert_eq!(page2.next_cursor, None, "next_cursor should be None on last page");
}

// ── MarkCovered tests ─────────────────────────────────────────────────────────

/// Non-admin calling MarkCovered returns Unauthorized; entry still has chat_msg_id == None.
#[tokio::test]
async fn test_mark_covered_admin_only() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Post one coverage request from PLAYER_A.
    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    service_client
        .request_coverage(
            CoverageKind::MarketResolved,
            Some(target),
            "event to cover".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    // PLAYER_B tries to MarkCovered — not admin.
    let mark_result = service_client
        .mark_covered(1u64, 999u64)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap();

    assert_eq!(
        mark_result,
        Err(aan_tv_client::Error::Unauthorized),
        "non-admin must not be able to mark a coverage entry"
    );

    // Verify entry still has chat_msg_id == None.
    let page = service_client
        .get_coverage_queue(None, 10)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1, "queue should still have the entry");
    assert_eq!(
        page.items[0].chat_msg_id, None,
        "chat_msg_id must remain None after failed MarkCovered"
    );
}

/// Happy path: admin marks coverage entry → Ok(()), chat_msg_id updated.
#[tokio::test]
async fn test_mark_covered_happy() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    service_client
        .request_coverage(
            CoverageKind::BountyCompleted,
            Some(target),
            "bounty completed".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    // Admin marks it with chat_msg_id = 12345.
    let mark_result = service_client
        .mark_covered(1u64, 12345u64)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(mark_result, Ok(()), "admin MarkCovered should succeed");

    // Verify chat_msg_id updated in the queue.
    let page = service_client
        .get_coverage_queue(None, 10)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1, "queue should still have the entry (append-only)");
    assert_eq!(
        page.items[0].chat_msg_id,
        Some(12345u64),
        "chat_msg_id should be updated to 12345"
    );
}

/// Unknown coverage_id → Err(CoverageNotFound).
#[tokio::test]
async fn test_mark_covered_unknown_id_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let mark_result = service_client
        .mark_covered(999u64, 1u64)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(
        mark_result,
        Err(aan_tv_client::Error::CoverageNotFound),
        "unknown coverage_id must return CoverageNotFound"
    );
}

/// Marking twice: second call returns Err(AlreadyCovered).
#[tokio::test]
async fn test_mark_covered_double_rejected() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let target: ActorId = ActorId::from(TARGET_PROGRAM_ID);
    service_client
        .request_coverage(
            CoverageKind::MatchSettled,
            Some(target),
            "match settled".into(),
        )
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(COVERAGE_FEE)
        .await
        .unwrap()
        .expect("request_coverage should succeed");

    // First mark — should succeed.
    service_client
        .mark_covered(1u64, 100u64)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap()
        .expect("first mark_covered should succeed");

    // Second mark — should fail with AlreadyCovered.
    let second_mark = service_client
        .mark_covered(1u64, 200u64)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(
        second_mark,
        Err(aan_tv_client::Error::AlreadyCovered),
        "second mark_covered must return AlreadyCovered"
    );
}

// ── New tests for Fixes 1 + 2 ─────────────────────────────────────────────────

/// Fix 1: Admin tries sweep(1 VARA) on fresh deploy where protocol_balance == 0.
/// Must return Err(InsufficientFunds). Program balance unchanged.
#[tokio::test]
async fn test_sweep_rejects_above_protocol_balance() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_before = program.balance();

    // protocol_balance == 0 after fresh deploy.
    let sweep_result = service_client
        .sweep(ONE_VARA)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();

    assert_eq!(
        sweep_result,
        Err(aan_tv_client::Error::InsufficientFunds),
        "sweep(1 VARA) when protocol_balance==0 must return InsufficientFunds"
    );

    let prog_balance_after = program.balance();
    assert_eq!(
        prog_balance_before, prog_balance_after,
        "program balance must be unchanged after failed sweep"
    );
}

/// Fix 1: After a resolved match, protocol_balance == 0.2 VARA.
/// Admin sweeps 0.2 VARA → Ok. Admin tries another 0.01 VARA → InsufficientFunds.
#[tokio::test]
async fn test_sweep_after_resolve_succeeds_up_to_protocol_cut() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    // Run a full match to completion (player_a wins).
    let match_id = setup_revealed_match_a_wins(&mut service_client).await;
    service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("resolve should succeed");

    // protocol_balance is now PROTOCOL_CUT (0.2 VARA).
    // Admin sweeps exactly that amount → should succeed.
    let sweep_result = service_client
        .sweep(PROTOCOL_CUT)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(sweep_result, Ok(()), "admin sweep of protocol_balance should succeed");

    // protocol_balance is now 0. Another tiny sweep should fail.
    let tiny = ONE_VARA / 100; // 0.01 VARA
    let second_sweep = service_client
        .sweep(tiny)
        .with_actor_id(ADMIN_ID.into())
        .await
        .unwrap();
    assert_eq!(
        second_sweep,
        Err(aan_tv_client::Error::InsufficientFunds),
        "sweep after protocol_balance exhausted must return InsufficientFunds"
    );
}

/// Fix 2 (InCommit abandonment, one committer): PLAYER_A commits, PLAYER_B never commits.
/// After advancing past commit_deadline (200 blocks), resolve pays PLAYER_A 90%.
/// Protocol retains 10%.
#[tokio::test]
async fn test_resolve_one_committer_after_commit_deadline_pays_committer() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_after_deploy = program.balance();

    // Open + Accept → InCommit.
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // PLAYER_A commits; PLAYER_B does NOT commit.
    let salt_a: [u8; 32] = [0xA1; 32];
    let commitment_a = make_commitment(70, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    // Advance blocks past commit_deadline (200 blocks from accept).
    // Current height after ~3 messages is ~3; commit_deadline is ~203.
    let current_height = env.system().block_height();
    env.system().run_to_block(current_height + 210);

    // Resolve — PLAYER_A should win by default.
    let prog_balance_before_resolve = program.balance();
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Winner(ActorId::from(PLAYER_A_ID))),
        "PLAYER_A (only committer) should win by default — Ok(MatchOutcome::Winner(PLAYER_A))"
    );

    // Program paid out WINNER_CUT (1.8 VARA) to PLAYER_A; retained PROTOCOL_CUT (0.2 VARA).
    let prog_balance_after_resolve = program.balance();
    assert_eq!(
        prog_balance_before_resolve - prog_balance_after_resolve,
        WINNER_CUT,
        "program should have paid out exactly WINNER_CUT (1.8 VARA) to PLAYER_A"
    );
    assert_eq!(
        prog_balance_after_resolve,
        prog_balance_after_deploy + PROTOCOL_CUT,
        "program should retain ED + PROTOCOL_CUT after one-committer resolve"
    );

    // Match state.
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::Resolved, "match must be Resolved");
    assert_eq!(m.winner, Some(ActorId::from(PLAYER_A_ID)), "winner must be PLAYER_A");
}

/// Fix 2 (InCommit abandonment, neither commits): Both players fail to commit before
/// commit_deadline. Resolve refunds both 1 VARA each and returns Ok(MatchOutcome::Abandoned).
/// (Refund sends must fire on Ok — returning Err would leave the queued sends unfired
/// and the pot stuck in the program forever.)
#[tokio::test]
async fn test_resolve_neither_committed_after_deadline_refunds_both() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_after_deploy = program.balance();

    // Open + Accept → InCommit (neither player commits).
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    // Neither player commits. Advance past commit_deadline.
    let current_height = env.system().block_height();
    env.system().run_to_block(current_height + 210);

    // Program holds ED + 2 VARA before resolve.
    let prog_balance_before_resolve = program.balance();
    assert_eq!(
        prog_balance_before_resolve,
        prog_balance_after_deploy + TWO_VARA,
        "program should hold ED + 2 VARA before resolve"
    );

    // Resolve — should refund both and return Ok(MatchOutcome::Abandoned).
    // CRITICAL: must be Ok (not Err) so that the queued msg::send_bytes_with_gas
    // refund calls actually fire on mainnet.
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Abandoned),
        "resolve with neither committed after deadline must return Ok(MatchOutcome::Abandoned)"
    );

    // Program balance should be back to deploy level (both buy-ins refunded, no protocol cut).
    let prog_balance_after_resolve = program.balance();
    assert_eq!(
        prog_balance_after_resolve, prog_balance_after_deploy,
        "program balance should return to deploy level after bilateral refund (no protocol cut taken)"
    );

    // Strengthen: verify PLAYER_A actually received their refund (1 VARA).
    let player_a_balance_after = env.system().balance_of(PLAYER_A_ID);
    assert!(
        player_a_balance_after > MINT_AMOUNT - ONE_VARA,
        "PLAYER_A balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after refund",
        player_a_balance_after,
        MINT_AMOUNT - ONE_VARA
    );

    // Strengthen: verify PLAYER_B actually received their refund (1 VARA).
    let player_b_balance_after = env.system().balance_of(PLAYER_B_ID);
    assert!(
        player_b_balance_after > MINT_AMOUNT - ONE_VARA,
        "PLAYER_B balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after refund",
        player_b_balance_after,
        MINT_AMOUNT - ONE_VARA
    );

    // Match is Resolved with no winner.
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::Resolved, "match must be Resolved");
    assert_eq!(m.winner, None, "winner must be None on abandoned match");
}

/// Fix 2 (InReveal abandonment, neither reveals): Both players commit but neither reveals
/// before reveal_deadline. Resolve refunds both and returns Ok(MatchOutcome::Abandoned).
#[tokio::test]
async fn test_resolve_neither_revealed_after_deadline_refunds_both() {
    let (env, program) = deploy().await;
    let mut service_client = program.aan_tv();

    let prog_balance_after_deploy = program.balance();

    // Open + Accept + Commit both → InReveal.
    let match_id = service_client
        .open_match()
        .with_actor_id(PLAYER_A_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("open_match should succeed");

    service_client
        .accept_match(match_id)
        .with_actor_id(PLAYER_B_ID.into())
        .with_value(ONE_VARA)
        .await
        .unwrap()
        .expect("accept_match should succeed");

    let salt_a: [u8; 32] = [0xA1; 32];
    let commitment_a = make_commitment(70, &salt_a);
    service_client
        .commit(match_id, commitment_a)
        .with_actor_id(PLAYER_A_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_A commit should succeed");

    let salt_b: [u8; 32] = [0xB1; 32];
    let commitment_b = make_commitment(30, &salt_b);
    service_client
        .commit(match_id, commitment_b)
        .with_actor_id(PLAYER_B_ID.into())
        .await
        .unwrap()
        .expect("PLAYER_B commit should succeed");

    // Both committed → state is now InReveal. Neither reveals.
    // Advance past reveal_deadline (commit_deadline + 200; commit_deadline was accept_block + 200).
    // Total: ~400 + current from accept. Safe to add 420.
    let current_height = env.system().block_height();
    env.system().run_to_block(current_height + 420);

    // Program holds ED + 2 VARA before resolve.
    let prog_balance_before_resolve = program.balance();
    assert_eq!(
        prog_balance_before_resolve,
        prog_balance_after_deploy + TWO_VARA,
        "program should hold ED + 2 VARA before resolve"
    );

    // Resolve — should refund both and return Ok(MatchOutcome::Abandoned).
    // CRITICAL: must be Ok (not Err) so that the queued msg::send_bytes_with_gas
    // refund calls actually fire on mainnet.
    let resolve_result = service_client
        .resolve(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap();

    assert_eq!(
        resolve_result,
        Ok(MatchOutcome::Abandoned),
        "resolve with neither revealed after deadline must return Ok(MatchOutcome::Abandoned)"
    );

    // Program balance should be back to deploy level (both buy-ins refunded, no protocol cut).
    let prog_balance_after_resolve = program.balance();
    assert_eq!(
        prog_balance_after_resolve, prog_balance_after_deploy,
        "program balance should return to deploy level after bilateral refund (no protocol cut taken)"
    );

    // Strengthen: verify PLAYER_A actually received their refund (1 VARA).
    let player_a_balance_after = env.system().balance_of(PLAYER_A_ID);
    assert!(
        player_a_balance_after > MINT_AMOUNT - ONE_VARA,
        "PLAYER_A balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after refund",
        player_a_balance_after,
        MINT_AMOUNT - ONE_VARA
    );

    // Strengthen: verify PLAYER_B actually received their refund (1 VARA).
    let player_b_balance_after = env.system().balance_of(PLAYER_B_ID);
    assert!(
        player_b_balance_after > MINT_AMOUNT - ONE_VARA,
        "PLAYER_B balance ({}) must exceed MINT_AMOUNT - ONE_VARA ({}) after refund",
        player_b_balance_after,
        MINT_AMOUNT - ONE_VARA
    );

    // Match is Resolved with no winner.
    let m = service_client
        .get_match(match_id)
        .with_actor_id(PLAYER_C_ID.into())
        .await
        .unwrap()
        .expect("match should exist");
    assert_eq!(m.state, MatchState::Resolved, "match must be Resolved");
    assert_eq!(m.winner, None, "winner must be None on abandoned match");
}
