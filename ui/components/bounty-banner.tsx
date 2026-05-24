import { ArrowRight, Warning } from "@phosphor-icons/react/dist/ssr";

const MISSION_HEX = "0x5a94f7ce047f9480c5b84afee1681a5fa82654f1029254bed5bf28d3e1b7a4d0";

export function BountyBanner() {
  return (
    <div className="w-full border border-[#00CFFF]/40 bg-[#00CFFF]/5 rounded-lg px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-onair-pulse absolute inline-flex h-full w-full rounded-full bg-[#00CFFF] opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00CFFF]" />
        </span>
        <div className="flex items-center gap-2">
          <Warning size={14} weight="bold" className="text-[#00CFFF]" />
          <span className="font-pixel text-[8px] text-[#00CFFF] tracking-widest uppercase">
            M3 BOUNTY BRIDGE
          </span>
        </div>
        <span className="hidden sm:block text-[#3D4A5C]">|</span>
        <span className="hidden sm:block font-mono text-sm text-[#E5E9EE] font-bold">
          8 VARA TOTAL
        </span>
        <span className="hidden sm:block text-[#3D4A5C]">·</span>
        <span className="hidden sm:block font-mono text-xs text-[#7A8896]">
          useful zero-value cross-app call
        </span>
      </div>

      <div className="sm:hidden flex flex-col gap-1">
        <span className="font-mono text-sm text-[#E5E9EE] font-bold">8 VARA TOTAL</span>
        <span className="font-mono text-xs text-[#7A8896]">useful zero-value cross-app call</span>
      </div>

      <div className="flex-1 flex items-center gap-3 min-w-0">
        <code className="text-[11px] font-mono text-[#7A8896] bg-[#0A0E14] border border-[#2A3340] rounded-sm px-3 py-1.5 truncate flex-1">
          {`${MISSION_HEX.slice(0, 18)}... ClaimMission [3] -> SubmitProof -> bounty #9`}
        </code>
        <div className="shrink-0 flex items-center gap-1 text-[#7A8896] text-xs font-mono">
          <span>gas only</span>
          <ArrowRight size={12} weight="bold" />
        </div>
      </div>
    </div>
  );
}
