import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;

export interface MissionLiveStats {
  totalMissions: number;
  openMissions: number;
  totalClaims: number;
  pendingProofs: number;
  approvedProofs: number;
  rejectedProofs: number;
  rewardsPaid: string;
  rewardsRemaining: string;
}

export interface MissionLiveMission {
  id: string;
  title: string;
  reward: string;
  maxApprovals: number;
  approvalsCount: number;
  closed: boolean;
  remainingPool: string;
}

export interface MissionLiveProof {
  id: string;
  missionId: string;
  claimant: string;
  status: string;
  note: string;
  proofTxHash: string;
  submittedAtBlock: number;
}

export interface MissionLiveAgentRecord {
  agent: string;
  completedCount: number;
  totalRewardsEarned: string;
  rejectedProofCount: number;
}

export interface MissionLiveSnapshot {
  available: boolean;
  source: "vara-wallet" | "standby" | "unavailable";
  error: string | null;
  stats: MissionLiveStats | null;
  missions: MissionLiveMission[];
  proofs: MissionLiveProof[];
  agentRecords: MissionLiveAgentRecord[];
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function field(row: Record<string, unknown>, snake: string, camel: string): unknown {
  return row[snake] ?? row[camel];
}

function stringField(row: Record<string, unknown>, snake: string, camel: string): string {
  return String(field(row, snake, camel) ?? "");
}

function numberField(row: Record<string, unknown>, snake: string, camel: string): number {
  return Number(field(row, snake, camel) ?? 0);
}

function boolField(row: Record<string, unknown>, snake: string, camel: string): boolean {
  return Boolean(field(row, snake, camel));
}

function normalizeStatus(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.kind === "string") return row.kind;
    return Object.keys(row)[0] ?? "";
  }
  return "";
}

function candidateIdlPaths(): string[] {
  return [
    process.env.MISSION_IDL_PATH ?? "",
    path.resolve(process.cwd(), "../programs/aan-missions/client/aan_missions_client.idl"),
    path.resolve(process.cwd(), "../commentator/idls/aan_missions_client.idl"),
    path.resolve(process.cwd(), "../programs/aan-missions/target/wasm32-gear/release/aan_missions.idl"),
  ].filter(Boolean);
}

function resolveIdlPath(): string | null {
  for (const candidate of candidateIdlPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function callMission<T>(
  programHex: string,
  method: string,
  args: unknown[],
  idlPath: string,
): Promise<T> {
  const timeout = envNumber("MISSION_READ_TIMEOUT_MS", 8_000);
  const { stdout } = await execFile(
    "vara-wallet",
    [
      "--network", process.env.VARA_NETWORK ?? "mainnet",
      "--json",
      "call",
      programHex,
      method,
      "--args", JSON.stringify(args),
      "--idl", idlPath,
    ],
    { timeout },
  );

  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  if (parsed.programMessage != null) {
    throw new Error(`${method} failed: ${JSON.stringify(parsed.programMessage)}`);
  }
  return parsed.result as T;
}

function parseStats(raw: unknown): MissionLiveStats | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    totalMissions: numberField(row, "total_missions", "totalMissions"),
    openMissions: numberField(row, "open_missions", "openMissions"),
    totalClaims: numberField(row, "total_claims", "totalClaims"),
    pendingProofs: numberField(row, "pending_proofs", "pendingProofs"),
    approvedProofs: numberField(row, "approved_proofs", "approvedProofs"),
    rejectedProofs: numberField(row, "rejected_proofs", "rejectedProofs"),
    rewardsPaid: stringField(row, "rewards_paid", "rewardsPaid"),
    rewardsRemaining: stringField(row, "rewards_remaining", "rewardsRemaining"),
  };
}

function pageItems(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  return Array.isArray(row.items) ? row.items : [];
}

function parseMission(raw: unknown): MissionLiveMission | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = stringField(row, "id", "id");
  if (!id) return null;
  return {
    id,
    title: stringField(row, "title", "title"),
    reward: stringField(row, "reward", "reward"),
    maxApprovals: numberField(row, "max_approvals", "maxApprovals"),
    approvalsCount: numberField(row, "approvals_count", "approvalsCount"),
    closed: boolField(row, "closed", "closed"),
    remainingPool: stringField(row, "remaining_pool", "remainingPool"),
  };
}

function parseProof(raw: unknown): MissionLiveProof | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = stringField(row, "id", "id");
  if (!id) return null;
  return {
    id,
    missionId: stringField(row, "mission_id", "missionId"),
    claimant: stringField(row, "claimant", "claimant"),
    status: normalizeStatus(field(row, "status", "status")),
    note: stringField(row, "note", "note"),
    proofTxHash: stringField(row, "proof_tx_hash", "proofTxHash"),
    submittedAtBlock: numberField(row, "submitted_at_block", "submittedAtBlock"),
  };
}

function parseAgentRecord(raw: unknown): MissionLiveAgentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const agent = stringField(row, "agent", "agent");
  if (!agent) return null;
  return {
    agent,
    completedCount: numberField(row, "completed_count", "completedCount"),
    totalRewardsEarned: stringField(row, "total_rewards_earned", "totalRewardsEarned"),
    rejectedProofCount: numberField(row, "rejected_proof_count", "rejectedProofCount"),
  };
}

export async function fetchMissionLiveSnapshot(
  programHex: string | null,
): Promise<MissionLiveSnapshot> {
  if (!programHex || !HEX_32.test(programHex)) {
    return {
      available: false,
      source: "standby",
      error: null,
      stats: null,
      missions: [],
      proofs: [],
      agentRecords: [],
    };
  }

  if (!envBool("MISSION_LIVE_READS", true)) {
    return {
      available: false,
      source: "unavailable",
      error: "MISSION_LIVE_READS=false",
      stats: null,
      missions: [],
      proofs: [],
      agentRecords: [],
    };
  }

  const idlPath = resolveIdlPath();
  if (!idlPath) {
    return {
      available: false,
      source: "unavailable",
      error: "Mission Control IDL not found on server",
      stats: null,
      missions: [],
      proofs: [],
      agentRecords: [],
    };
  }

  try {
    const [stats, missionsPage, proofsPage, agentRecordsPage] = await Promise.all([
      callMission<unknown>(programHex, "AanMissions/GetStats", [], idlPath),
      callMission<unknown>(programHex, "AanMissions/GetMissions", [null, 8], idlPath),
      callMission<unknown>(programHex, "AanMissions/GetProofs", [null, 8], idlPath),
      callMission<unknown>(programHex, "AanMissions/GetAgentRecords", [null, 5], idlPath),
    ]);

    return {
      available: true,
      source: "vara-wallet",
      error: null,
      stats: parseStats(stats),
      missions: pageItems(missionsPage).map(parseMission).filter((item): item is MissionLiveMission => item != null),
      proofs: pageItems(proofsPage).map(parseProof).filter((item): item is MissionLiveProof => item != null),
      agentRecords: pageItems(agentRecordsPage).map(parseAgentRecord).filter((item): item is MissionLiveAgentRecord => item != null),
    };
  } catch (err) {
    return {
      available: false,
      source: "unavailable",
      error: err instanceof Error ? err.message : String(err),
      stats: null,
      missions: [],
      proofs: [],
      agentRecords: [],
    };
  }
}
