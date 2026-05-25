/**
 * Persistent checkpoint store backed by SQLite.
 *
 * Two bookmarks:
 *   lastSeenBlock      — highest Substrate block number processed by watcher
 *   lastSeenCoverageId — highest CoverageRequest id processed from GetCoverageQueue
 *   last_digest_ts     — unix ms timestamp of the last hourly digest post
 *   lastSeenMissionClaimId — highest Mission Control claim id processed
 *   lastSeenMissionProofId — highest Mission Control proof id processed
 *
 * All start at 0. The store is lazily initialized on first access.
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

export function _resetCheckpointForTesting(): void {
  db?.close();
  db = null;
}

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
    );

    CREATE TABLE IF NOT EXISTS integration_partner_state (
      partner_key          TEXT PRIMARY KEY,
      last_called_at_block INTEGER NOT NULL DEFAULT 0,
      last_called_at_ms    INTEGER NOT NULL DEFAULT 0,
      last_status          TEXT,
      last_error           TEXT,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS board_sign_callbacks (
      caller    TEXT NOT NULL,
      entry_id  INTEGER NOT NULL,
      posted_at TEXT NOT NULL,
      PRIMARY KEY(caller, entry_id)
    );

    CREATE TABLE IF NOT EXISTS mission_activity_posts (
      kind       TEXT NOT NULL CHECK(kind IN ('claim', 'proof')),
      id         TEXT NOT NULL,
      status     TEXT NOT NULL CHECK(status IN ('ok', 'failed', 'skipped')),
      posted_msg_id  TEXT,
      posted_tx_hash TEXT,
      error      TEXT,
      processed_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY(kind, id)
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

export function getLastSeenMissionClaimId(): bigint {
  return BigInt(getCheckpoint('lastSeenMissionClaimId', '0'));
}

export function setLastSeenMissionClaimId(id: bigint): void {
  setCheckpoint('lastSeenMissionClaimId', String(id));
}

export function getLastSeenMissionProofId(): bigint {
  return BigInt(getCheckpoint('lastSeenMissionProofId', '0'));
}

export function setLastSeenMissionProofId(id: bigint): void {
  setCheckpoint('lastSeenMissionProofId', String(id));
}

export type MissionActivityKind = 'claim' | 'proof';
export type MissionActivityStatus = 'ok' | 'failed' | 'skipped';

export function missionActivityAlreadyProcessed(
  kind: MissionActivityKind,
  id: string,
): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM mission_activity_posts WHERE kind = ? AND id = ?')
    .get(kind, id);
  return row !== undefined;
}

export function recordMissionActivity(
  kind: MissionActivityKind,
  id: string,
  status: MissionActivityStatus,
  details: { msgId?: string; txHash?: string; error?: string } = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO mission_activity_posts (
         kind,
         id,
         status,
         posted_msg_id,
         posted_tx_hash,
         error
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, id) DO NOTHING`,
    )
    .run(kind, id, status, details.msgId ?? null, details.txHash ?? null, details.error ?? null);
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

// ── hourly digest timestamp bookmark ──────────────────────────────────────

/**
 * Returns the unix timestamp (ms) of the last hourly digest post.
 * Returns 0 if never set (fresh DB).
 */
export function getLastDigestPostedAt(): number {
  return parseInt(getCheckpoint('last_digest_ts', '0'), 10);
}

/**
 * Persist the unix timestamp (ms) of the most recent hourly digest post.
 */
export function setLastDigestPostedAt(ms: number): void {
  setCheckpoint('last_digest_ts', String(ms));
}

// ── daily spend/call ledger ────────────────────────────────────────────────

export type DailySpendKind = 'chat_post' | 'mark_covered' | 'partner_call' | 'mission_verifier_call';

export interface DailySpendSnapshot {
  day: string;
  chatPosts: number;
  markCoveredCalls: number;
  partnerCalls: number;
  missionVerifierCalls: number;
  estimatedSpendRaw: bigint;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCheckpointInt(key: string): number {
  const value = Number(getCheckpoint(key, '0'));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function resetDailySpend(day: string): void {
  const tx = getDb().transaction(() => {
    setCheckpoint('daily_spend_day', day);
    setCheckpoint('daily_spend_chat_posts', '0');
    setCheckpoint('daily_spend_mark_covered_calls', '0');
    setCheckpoint('daily_spend_partner_calls', '0');
    setCheckpoint('daily_spend_mission_verifier_calls', '0');
    setCheckpoint('daily_spend_estimated_raw', '0');
  });
  tx();
}

export function getDailySpendSnapshot(): DailySpendSnapshot {
  const day = todayUtc();
  if (getCheckpoint('daily_spend_day', '') !== day) {
    resetDailySpend(day);
  }

  return {
    day,
    chatPosts: parseCheckpointInt('daily_spend_chat_posts'),
    markCoveredCalls: parseCheckpointInt('daily_spend_mark_covered_calls'),
    partnerCalls: parseCheckpointInt('daily_spend_partner_calls'),
    missionVerifierCalls: parseCheckpointInt('daily_spend_mission_verifier_calls'),
    estimatedSpendRaw: BigInt(getCheckpoint('daily_spend_estimated_raw', '0')),
  };
}

export function reserveDailySpend(kind: DailySpendKind, estimatedSpendRaw: bigint): DailySpendSnapshot {
  if (estimatedSpendRaw < 0n) {
    throw new Error('estimatedSpendRaw must be non-negative');
  }

  const current = getDailySpendSnapshot();
  const next: DailySpendSnapshot = {
    ...current,
    estimatedSpendRaw: current.estimatedSpendRaw + estimatedSpendRaw,
  };

  if (kind === 'chat_post') next.chatPosts += 1;
  if (kind === 'mark_covered') next.markCoveredCalls += 1;
  if (kind === 'partner_call') next.partnerCalls += 1;
  if (kind === 'mission_verifier_call') next.missionVerifierCalls += 1;

  const tx = getDb().transaction(() => {
    setCheckpoint('daily_spend_day', next.day);
    setCheckpoint('daily_spend_chat_posts', String(next.chatPosts));
    setCheckpoint('daily_spend_mark_covered_calls', String(next.markCoveredCalls));
    setCheckpoint('daily_spend_partner_calls', String(next.partnerCalls));
    setCheckpoint('daily_spend_mission_verifier_calls', String(next.missionVerifierCalls));
    setCheckpoint('daily_spend_estimated_raw', String(next.estimatedSpendRaw));
  });
  tx();

  return next;
}

// ── integration runner state ───────────────────────────────────────────────

export interface IntegrationPartnerState {
  partnerKey: string;
  lastCalledAtBlock: number;
  lastCalledAtMs: number;
  lastStatus: string | null;
  lastError: string | null;
}

export function getIntegrationPartnerState(partnerKey: string): IntegrationPartnerState {
  const row = getDb()
    .prepare(
      `SELECT partner_key, last_called_at_block, last_called_at_ms, last_status, last_error
       FROM integration_partner_state
       WHERE partner_key = ?`,
    )
    .get(partnerKey) as
    | {
        partner_key: string;
        last_called_at_block: number;
        last_called_at_ms: number;
        last_status: string | null;
        last_error: string | null;
      }
    | undefined;

  if (!row) {
    return {
      partnerKey,
      lastCalledAtBlock: 0,
      lastCalledAtMs: 0,
      lastStatus: null,
      lastError: null,
    };
  }

  return {
    partnerKey: row.partner_key,
    lastCalledAtBlock: Number(row.last_called_at_block),
    lastCalledAtMs: Number(row.last_called_at_ms),
    lastStatus: row.last_status,
    lastError: row.last_error,
  };
}

export function recordIntegrationPartnerAttempt(
  partnerKey: string,
  blockNumber: number,
  status: 'ok' | 'failed' | 'dry_run' | 'skipped',
  error?: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO integration_partner_state (
         partner_key,
         last_called_at_block,
         last_called_at_ms,
         last_status,
         last_error,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(partner_key) DO UPDATE SET
         last_called_at_block = excluded.last_called_at_block,
         last_called_at_ms = excluded.last_called_at_ms,
         last_status = excluded.last_status,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
    )
    .run(partnerKey, blockNumber, Date.now(), status, error ?? null);
}

// ── board-sign callback idempotency ────────────────────────────────────────

export function alreadyHandledBoardSignCallback(caller: string, entryId: number): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM board_sign_callbacks WHERE caller = ? AND entry_id = ?')
    .get(caller.toLowerCase(), entryId);
  return row !== undefined;
}

export function recordBoardSignCallback(caller: string, entryId: number, postedAt: string): void {
  getDb()
    .prepare(
      `INSERT INTO board_sign_callbacks (caller, entry_id, posted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(caller, entry_id) DO NOTHING`,
    )
    .run(caller.toLowerCase(), entryId, postedAt);
}

/// Most recent callback timestamp (Unix ms) for a caller, or null if never
/// posted. Used to throttle bulk-sign floods to one callback per caller per
/// window — caller may sign 200x but we only chat-back once.
export function lastBoardCallbackMsForCaller(caller: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT posted_at FROM board_sign_callbacks
       WHERE caller = ?
       ORDER BY posted_at DESC
       LIMIT 1`,
    )
    .get(caller.toLowerCase()) as { posted_at: string } | undefined;
  if (!row) return null;
  const ms = Date.parse(row.posted_at);
  return Number.isFinite(ms) ? ms : null;
}
