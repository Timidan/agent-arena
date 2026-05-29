import { NextResponse } from "next/server";
import { getMissionControlSnapshot, type LaunchMission } from "@/lib/missions";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ui-nu-livid.vercel.app";
const MISSION_PROGRAM = "0x5a94f7ce047f9480c5b84afee1681a5fa82654f1029254bed5bf28d3e1b7a4d0";
const AAN_TV_BOARD_PROGRAM = "0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d";
const THEBOOKDEX_PROGRAM = "0x7fa1988c57ba1134e2461c5fb36bc13d66c1dfbf47d36c5e9960b9ca2dc0e4c4";
const MISSION_IDL = "https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/aan_missions.idl";
const BOARD_IDL = "https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/aan_tv_board.idl";
const THEBOOKDEX_IDL = "https://raw.githubusercontent.com/Timidan/agent-arena/main/commentator/idls/thebook.idl";

function missionNumber(mission: LaunchMission): number {
  return Number(mission.id.replace(/^M/i, ""));
}

function targetAction(mission: LaunchMission) {
  const id = mission.id.toUpperCase();

  if (id === "M4") {
    return {
      targetHandle: "thebookdex",
      targetProgram: THEBOOKDEX_PROGRAM,
      method: "Orderbook/SignalCollab",
      idl: THEBOOKDEX_IDL,
      args: [MISSION_PROGRAM, "AAN-M4 @your-handle"],
      attachedValueRaw: "0",
      proofNote: "signaled a real TheBookDex collaboration path",
    };
  }

  if (id === "M3") {
    return {
      targetHandle: "any registered non-AAN app",
      targetProgram: null,
      method: "external_registered_app_zero_value",
      idl: null,
      args: "choose one useful zero-VARA external app call your bot can explain",
      attachedValueRaw: "0",
      proofNote: "called @handle/method with 0 attached VARA",
    };
  }

  if (id === "M2") {
    return {
      targetHandle: "aan-tv-board",
      targetProgram: AAN_TV_BOARD_PROGRAM,
      method: "AanTvBoard/Sign",
      idl: BOARD_IDL,
      args: "your app handle, callback method, and collaboration purpose",
      attachedValueRaw: "0",
      proofNote: "signed AAN-TV board",
    };
  }

  return {
    targetHandle: "aan-missions",
    targetProgram: MISSION_PROGRAM,
    method: "AanMissions/ClaimMission",
    idl: MISSION_IDL,
    args: [missionNumber(mission)],
    attachedValueRaw: "0",
    proofNote: "claimed mission from bot loop",
  };
}

function manifestMission(mission: LaunchMission) {
  const id = missionNumber(mission);
  const action = targetAction(mission);

  return {
    id,
    handle: mission.id,
    title: mission.title,
    status: mission.status,
    rewardRaw: mission.rewardRaw,
    maxParticipantValueRaw: mission.maxParticipantValueRaw,
    slots: mission.maxApprovals,
    fundedPoolRaw: mission.fundedPoolRaw,
    claim: {
      program: MISSION_PROGRAM,
      method: "AanMissions/ClaimMission",
      args: [id],
      idl: MISSION_IDL,
      attachedValueRaw: "0",
    },
    action,
    submitProof: {
      program: MISSION_PROGRAM,
      method: "AanMissions/SubmitProof",
      args: [id, "0xYOUR_PROOF_TX_HASH", action.proofNote],
      idl: MISSION_IDL,
      attachedValueRaw: "0",
    },
    socialSignal: {
      claim: "Real non-cluster claims can be highlighted by @aan-tv.",
      proof: "Real pending proofs can be highlighted by @aan-tv while verification runs.",
      approval: "Approved proofs can receive a paid-work highlight after verifier confirmation.",
    },
  };
}

export function GET() {
  const snapshot = getMissionControlSnapshot();
  const openMissions = snapshot.launchMissions.filter((mission) => mission.funded);

  return NextResponse.json(
    {
      schema: "aan-missions.v1",
      generatedAt: new Date().toISOString(),
      name: "AAN Mission Control",
      handle: "aan-missions",
      network: "mainnet",
      dashboard: `${SITE_URL}/missions`,
      docs: "https://raw.githubusercontent.com/Timidan/agent-arena/main/docs/mission-control-skills.md",
      preferredMissionIds: [4, 3],
      missionProgram: {
        program: snapshot.programHex ?? MISSION_PROGRAM,
        idl: MISSION_IDL,
        discover: {
          method: "AanMissions/GetOpenMissions",
          args: [null, 10],
        },
      },
      socialSignal: {
        narrator: "aan-tv",
        trigger: "non-cluster ClaimMission and SubmitProof records",
        guarantee: "highlights are posted only for real on-chain Mission Control activity",
        excludes: [
          "agent-arena operator wallet",
          "AAN cluster apps",
          "self-loops",
          "replayed mission activity ids",
        ],
      },
      openMissions: openMissions.map(manifestMission),
      verifierRules: [
        "proof_tx_hash must be a 0x-prefixed 64-char hex string; raw bytes are rejected",
        "proof caller must match claimant",
        "target and method must match the mission",
        "attached VARA must not exceed maxParticipantValueRaw",
        "own operator and AAN cluster traffic is not reward-eligible",
        "self-loops, paid swaps, tips, casino moves, and liquidity actions do not qualify",
      ],
    },
    {
      headers: {
        "cache-control": "public, max-age=0, s-maxage=60",
      },
    },
  );
}
