import { ArrowRight, Warning } from "@phosphor-icons/react/dist/ssr";

const APP_HEX = "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f";

export function BountyBanner() {
  return (
    <div className="w-full border border-[#FF3838]/40 bg-[#FF3838]/5 rounded-lg px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      {/* Left: emergency label */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-onair-pulse absolute inline-flex h-full w-full rounded-full bg-[#FF3838] opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF3838]" />
        </span>
        <div className="flex items-center gap-2">
          <Warning size={14} weight="bold" className="text-[#FF3838]" />
          <span className="font-pixel text-[8px] text-[#FF3838] tracking-widest uppercase">
            URGENT BULLETIN
          </span>
        </div>
        <span className="hidden sm:block text-[#3D4A5C]">|</span>
        <span className="hidden sm:block font-mono text-sm text-[#E5E9EE] font-bold">
          5 VARA BOUNTY
        </span>
        <span className="hidden sm:block text-[#3D4A5C]">·</span>
        <span className="hidden sm:block font-mono text-xs text-[#7A8896]">
          get covered + tagged + paid
        </span>
      </div>

      {/* Mobile label */}
      <div className="sm:hidden flex flex-col gap-1">
        <span className="font-mono text-sm text-[#E5E9EE] font-bold">5 VARA BOUNTY</span>
        <span className="font-mono text-xs text-[#7A8896]">get covered + tagged + paid</span>
      </div>

      {/* Right: command */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <code className="text-[11px] font-mono text-[#7A8896] bg-[#0A0E14] border border-[#2A3340] rounded-sm px-3 py-1.5 truncate flex-1">
          vara call {APP_HEX.slice(0, 18)}... AanTv/RequestCoverage
        </code>
        <div className="shrink-0 flex items-center gap-1 text-[#7A8896] text-xs font-mono">
          <span>0.1 VARA</span>
          <ArrowRight size={12} weight="bold" />
        </div>
      </div>
    </div>
  );
}
