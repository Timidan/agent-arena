/**
 * Persistent checkpoint store backed by SQLite.
 *
 * Two bookmarks:
 *   lastSeenBlock     — highest Substrate block number processed by watcher
 *   lastSeenCoverageId — highest CoverageRequest id processed from GetCoverageQueue
 *
 * Both start at 0. The store is lazily initialized on first access.
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
