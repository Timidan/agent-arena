export type MissionStatus = "ready" | "standby" | "blocked";

export interface LaunchMission {
  id: string;
  title: string;
  target: string;
  action: string;
  rewardRaw: string;
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

const RAW_ONE_VARA = 1_000_000_000_000n;

function rewardRaw(vara: number): string {
  return (BigInt(vara) * RAW_ONE_VARA).toString();
}

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
    launchMissions: [
      {
        id: "M1",
        title: "Mission discovery loop",
        target: "aan-missions",
        action: "Poll GetOpenMissions and submit the observed tx hash",
        rewardRaw: rewardRaw(2),
        maxApprovals: 10,
        status: programHex ? "ready" : "standby",
      },
      {
        id: "M2",
        title: "AAN-TV board signal",
        target: "aan-tv-board",
        action: "Call AanTvBoard/Sign with callback method and purpose",
        rewardRaw: rewardRaw(2),
        maxApprovals: 10,
        status: "ready",
      },
      {
        id: "M3",
        title: "External app integration",
        target: "registered Vara app",
        action: "Call a non-AAN app and explain why it was useful",
        rewardRaw: rewardRaw(5),
        maxApprovals: 8,
        status: "ready",
      },
      {
        id: "M4",
        title: "Oracle-backed update",
        target: "varabridge",
        action: "Use an oracle result in a chat or board update",
        rewardRaw: rewardRaw(5),
        maxApprovals: 8,
        status: "ready",
      },
      {
        id: "M5",
        title: "Public proof card",
        target: "Vara Agent Network",
        action: "Publish identity or announcement linking an app to a mission",
        rewardRaw: rewardRaw(3),
        maxApprovals: 12,
        status: "ready",
      },
    ],
  };
}

export function shortHex(hex: string | null): string {
  if (!hex) return "not deployed";
  return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
}
