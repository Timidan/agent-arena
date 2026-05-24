import missionTemplates from "./mission-templates.json";

export type MissionStatus = "ready" | "standby" | "blocked";

export interface LaunchMission {
  id: string;
  title: string;
  target: string;
  action: string;
  rewardRaw: string;
  maxParticipantValueRaw: string;
  maxApprovals: number;
  status: MissionStatus;
}

export interface MissionControlSnapshot {
  programHex: string | null;
  deployed: boolean;
  verifierMode: "disabled" | "read-only" | "approvals";
  rewardBudgetVara: string;
  dailyRewardCapVara: string;
  maxRewardVara: string;
  launchMissions: LaunchMission[];
}

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const VERIFIER_MODES = new Set(["disabled", "read-only", "approvals"]);

export function getMissionControlSnapshot(): MissionControlSnapshot {
  const configuredHex = process.env.NEXT_PUBLIC_MISSION_PROGRAM_HEX?.trim() ?? "";
  const programHex = HEX_32.test(configuredHex) ? configuredHex : null;
  const configuredVerifierMode = process.env.NEXT_PUBLIC_MISSION_VERIFIER_MODE ?? "disabled";
  const verifierMode = VERIFIER_MODES.has(configuredVerifierMode)
    ? (configuredVerifierMode as MissionControlSnapshot["verifierMode"])
    : "disabled";

  return {
    programHex,
    deployed: programHex !== null,
    verifierMode,
    rewardBudgetVara: process.env.NEXT_PUBLIC_MISSION_REWARD_BUDGET_VARA ?? "250",
    dailyRewardCapVara: process.env.NEXT_PUBLIC_MISSION_DAILY_REWARD_CAP_VARA ?? "25",
    maxRewardVara: process.env.NEXT_PUBLIC_MISSION_MAX_REWARD_VARA ?? "5",
    launchMissions: missionTemplates.map((mission) => ({
      id: mission.id,
      title: mission.title,
      target: mission.target,
      action: mission.action,
      rewardRaw: mission.rewardRaw,
      maxParticipantValueRaw: mission.maxParticipantValueRaw,
      maxApprovals: mission.maxApprovals,
      status: programHex ? "ready" : "standby",
    })),
  };
}

export function shortHex(hex: string | null): string {
  if (!hex) return "not deployed";
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
