import missionTemplates from "./mission-templates.json";

export type MissionStatus = "ready" | "standby" | "blocked";

export interface SeededMissionStats {
  totalMissions: number;
  openMissions: number;
  totalClaims: number;
  pendingProofs: number;
  approvedProofs: number;
  rejectedProofs: number;
  rewardsPaid: string;
  rewardsRemaining: string;
}

export interface LaunchMission {
  id: string;
  title: string;
  target: string;
  action: string;
  rewardRaw: string;
  maxParticipantValueRaw: string;
  fundedPoolRaw: string;
  maxApprovals: number;
  funded: boolean;
  status: MissionStatus;
}

export interface MissionControlSnapshot {
  programHex: string | null;
  deployed: boolean;
  verifierMode: "disabled" | "read-only" | "approvals";
  rewardBudgetVara: string;
  dailyRewardCapVara: string;
  maxRewardVara: string;
  seededStats: SeededMissionStats | null;
  launchMissions: LaunchMission[];
}

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const VERIFIER_MODES = new Set(["disabled", "read-only", "approvals"]);

function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

function multiplyRaw(raw: string, count: number): string {
  try {
    return (BigInt(raw) * BigInt(count)).toString();
  } catch {
    return "0";
  }
}

export function getMissionControlSnapshot(): MissionControlSnapshot {
  const configuredHex = process.env.NEXT_PUBLIC_MISSION_PROGRAM_HEX?.trim() ?? "";
  const programHex = HEX_32.test(configuredHex) ? configuredHex : null;
  const configuredVerifierMode = process.env.NEXT_PUBLIC_MISSION_VERIFIER_MODE ?? "disabled";
  const verifierMode = VERIFIER_MODES.has(configuredVerifierMode)
    ? (configuredVerifierMode as MissionControlSnapshot["verifierMode"])
    : "disabled";
  const fundedIds = csvSet(process.env.NEXT_PUBLIC_MISSION_FUNDED_IDS);
  const launchMissions: LaunchMission[] = missionTemplates.map((mission) => {
    const id = mission.id.toUpperCase();
    const funded = fundedIds.has(id);
    const fundedPoolRaw = multiplyRaw(mission.rewardRaw, mission.maxApprovals);

    const status: MissionStatus = programHex ? (funded ? "ready" : "standby") : "standby";

    return {
      id: mission.id,
      title: mission.title,
      target: mission.target,
      action: mission.action,
      rewardRaw: mission.rewardRaw,
      maxParticipantValueRaw: mission.maxParticipantValueRaw,
      fundedPoolRaw,
      maxApprovals: mission.maxApprovals,
      funded,
      status,
    };
  });
  const seededMissions = launchMissions.filter((mission) => mission.funded);
  const rewardsRemaining = seededMissions.reduce(
    (sum, mission) => sum + BigInt(mission.fundedPoolRaw),
    0n,
  );

  return {
    programHex,
    deployed: programHex !== null,
    verifierMode,
    rewardBudgetVara: process.env.NEXT_PUBLIC_MISSION_REWARD_BUDGET_VARA ?? "250",
    dailyRewardCapVara: process.env.NEXT_PUBLIC_MISSION_DAILY_REWARD_CAP_VARA ?? "25",
    maxRewardVara: process.env.NEXT_PUBLIC_MISSION_MAX_REWARD_VARA ?? "5",
    seededStats: seededMissions.length > 0
      ? {
        totalMissions: seededMissions.length,
        openMissions: seededMissions.length,
        totalClaims: 0,
        pendingProofs: 0,
        approvedProofs: 0,
        rejectedProofs: 0,
        rewardsPaid: "0",
        rewardsRemaining: rewardsRemaining.toString(),
      }
      : null,
    launchMissions,
  };
}

export function shortHex(hex: string | null): string {
  if (!hex) return "not deployed";
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
