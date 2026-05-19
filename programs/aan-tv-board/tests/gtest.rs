use aan_tv_board_client::{AanTvBoardClient, AanTvBoardClientCtors, Error, aan_tv_board::*};
use sails_rs::{client::*, gtest::*, prelude::ActorId};

const ADMIN_ID: u64 = 1;
const AUTHOR_A_ID: u64 = 42;
const AUTHOR_B_ID: u64 = 43;
const MINT_AMOUNT: u128 = 100_000_000_000_000;

async fn deploy() -> (
    GtestEnv,
    sails_rs::client::Actor<aan_tv_board_client::AanTvBoardClientProgram, GtestEnv>,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(ADMIN_ID, MINT_AMOUNT);
    system.mint_to(AUTHOR_A_ID, MINT_AMOUNT);
    system.mint_to(AUTHOR_B_ID, MINT_AMOUNT);

    let program_code_id = system.submit_code(aan_tv_board::WASM_BINARY);

    let env = GtestEnv::new(system, ADMIN_ID.into());

    let program = env
        .deploy::<aan_tv_board_client::AanTvBoardClientProgram>(program_code_id, b"salt".to_vec())
        .create()
        .await
        .unwrap();

    (env, program)
}

#[tokio::test]
async fn sign_happy_path() {
    let (env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    let result = service_client
        .sign("Hello Vara network!".to_string())
        .with_actor_id(AUTHOR_A_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "first sign should return entry_id = 1");
}

#[tokio::test]
async fn sign_thought_too_long_rejected() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    // 101 ASCII bytes — over limit
    let long_thought = "a".repeat(101);
    let result = service_client
        .sign(long_thought)
        .with_actor_id(AUTHOR_A_ID.into())
        .await
        .unwrap();

    assert_eq!(
        result,
        Err(Error::InvalidArg),
        "thought >100 bytes should be rejected with InvalidArg"
    );
}

#[tokio::test]
async fn sign_exactly_100_bytes_accepted() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    // Exactly 100 ASCII bytes — should succeed
    let exact_thought = "a".repeat(100);
    let result = service_client
        .sign(exact_thought)
        .with_actor_id(AUTHOR_A_ID.into())
        .await
        .unwrap();

    assert_eq!(result, Ok(1u64), "exactly 100-byte thought should succeed");
}

#[tokio::test]
async fn sign_records_block_and_author() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    let _ = service_client
        .sign("from author A".to_string())
        .with_actor_id(AUTHOR_A_ID.into())
        .await
        .unwrap();

    let entries = service_client
        .read_state()
        .await
        .unwrap();

    assert_eq!(entries.len(), 1, "should have 1 entry");
    let entry = &entries[0];
    assert_eq!(
        entry.author,
        ActorId::from(AUTHOR_A_ID),
        "author should match caller"
    );
    assert_eq!(entry.thought, "from author A");
    assert_eq!(entry.block > 0, true, "block should be non-zero");
}

#[tokio::test]
async fn get_entries_paginates() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    // Sign 5 entries
    for i in 0..5u32 {
        let _ = service_client
            .sign(alloc::format!("thought {i}"))
            .with_actor_id(AUTHOR_A_ID.into())
            .await
            .unwrap();
    }

    // Page 1: limit 3
    let page1 = service_client
        .get_entries(None, 3)
        .await
        .unwrap();

    assert_eq!(page1.items.len(), 3, "page1 should have 3 items");
    assert!(page1.next_cursor.is_some(), "next_cursor should be Some");

    // Page 2: from cursor
    let page2 = service_client
        .get_entries(page1.next_cursor, 3)
        .await
        .unwrap();

    assert_eq!(page2.items.len(), 2, "page2 should have remaining 2 items");
    assert!(page2.next_cursor.is_none(), "next_cursor should be None on last page");
}

#[tokio::test]
async fn get_by_author_filters() {
    let (_env, program) = deploy().await;

    let mut service_client = program.aan_tv_board();

    // Author A signs twice
    for _ in 0..2 {
        let _ = service_client
            .sign("author A thought".to_string())
            .with_actor_id(AUTHOR_A_ID.into())
            .await
            .unwrap();
    }

    // Author B signs once
    let _ = service_client
        .sign("author B thought".to_string())
        .with_actor_id(AUTHOR_B_ID.into())
        .await
        .unwrap();

    let author_a_entries = service_client
        .get_by_author(ActorId::from(AUTHOR_A_ID), 10)
        .await
        .unwrap();

    assert_eq!(author_a_entries.len(), 2, "author A should have 2 entries");
    assert!(
        author_a_entries.iter().all(|e| e.author == ActorId::from(AUTHOR_A_ID)),
        "all entries should belong to author A"
    );

    let author_b_entries = service_client
        .get_by_author(ActorId::from(AUTHOR_B_ID), 10)
        .await
        .unwrap();

    assert_eq!(author_b_entries.len(), 1, "author B should have 1 entry");
}

extern crate alloc;
