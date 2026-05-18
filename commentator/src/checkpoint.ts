/**
 * Persistent checkpoint store backed by SQLite.
 *
 * Two bookmarks:
 *   lastSeenBlock      — highest Substrate block number processed by watcher
 *   lastSeenCoverageId — highest CoverageRequest id processed from GetCoverageQueue
 *
 * Both start at 0. The store is lazily initialized on first access.
 *
 * Dedup table:
 *   processed_interactions — per-interaction idempotency record. Written BEFORE
 *   advancing lastSeenBlock so that a crash between post and checkpoint-advance
 *   still records the post and prevents duplicate narration on restart.
 *
 *   status = 'ok'     — post succeeded; msgId + txHash populated
 *   status = 'failed' — post failed; error populated; interaction is skipped
 *                       on restart (we don't retry failures to avoid spam)
 */

import Database from 'better-sqlite3';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.CHECKPOINT_DB ?? './checkpoint.sqlite';
  db = new Database(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_interactions (
      id         TEXT PRIMARY KEY,
      status     TEXT NOT NULL CHECK(status IN ('ok', 'failed')),
      posted_msg_id  TEXT,
      posted_tx_hash TEXT,
      error      TEXT,
      processed_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  return db;
}

function getCheckpoint(key: string, defaultVal: string): string {
  const row = getDb().prepare('SELECT value FROM checkpoints WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : defaultVal;
}

function setCheckpoint(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO checkpoints (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getLastSeenBlock(): number {
  return parseInt(getCheckpoint('lastSeenBlock', '0'), 10);
}

export function setLastSeenBlock(block: number): void {
  setCheckpoint('lastSeenBlock', String(block));
}

export function getLastSeenCoverageId(): bigint {
  return BigInt(getCheckpoint('lastSeenCoverageId', '0'));
}

export function setLastSeenCoverageId(id: bigint): void {
  setCheckpoint('lastSeenCoverageId', String(id));
}

// ── per-interaction dedup helpers (Fix 2) ─────────────────────────────────

/**
 * Returns true if this interaction has already been processed (ok or failed).
 * Prevents duplicate narration after a crash mid-batch.
 */
export function alreadyProcessed(interactionId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM processed_interactions WHERE id = ?')
    .get(interactionId);
  return row !== undefined;
}

/**
 * Record a successfully narrated interaction. Call BEFORE advancing
 * lastSeenBlock so a crash between post and checkpoint-advance is safe.
 */
export function recordProcessed(
  interactionId: string,
  msgId: string,
  txHash: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO processed_interactions (id, status, posted_msg_id, posted_tx_hash)
       VALUES (?, 'ok', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(interactionId, msgId, txHash);
}

/**
 * Record a permanently-failed interaction. On restart the interaction is
 * skipped via alreadyProcessed() — we don't retry failures to avoid spam.
 */
export function recordFailed(interactionId: string, error: string): void {
  getDb()
    .prepare(
      `INSERT INTO processed_interactions (id, status, error)
       VALUES (?, 'failed', ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(interactionId, error);
}
