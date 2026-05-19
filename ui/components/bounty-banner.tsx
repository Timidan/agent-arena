import { ArrowRight, Coins } from "@phosphor-icons/react/dist/ssr";

const APP_HEX = "0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f";

export function BountyBanner() {
  return (
    <div className="w-full border border-[oklch(65%_0.22_240_/_25%)] bg-[oklch(65%_0.22_240_/_6%)] rounded-xl px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      {/* Left: bounty label */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-breathe absolute inline-flex h-full w-full rounded-full bg-[oklch(65%_0.22_240)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[oklch(65%_0.22_240)]" />
        </span>
        <div className="flex items-center gap-2">
          <Coins size={14} weight="duotone" className="text-[oklch(65%_0.22_240)]" />
          <span className="text-sm font-mono font-bold text-[oklch(65%_0.22_240)] tracking-tight">
            5 VARA BOUNTY
          </span>
        </div>
        <span className="hidden sm:block text-zinc-600 text-sm">—</span>
        <span className="hidden sm:block text-zinc-400 text-sm font-mono">
          get covered + tagged + paid
        </span>
      </div>

      {/* Mobile label */}
      <span className="sm:hidden text-zinc-400 text-xs font-mono">
        get covered + tagged + paid
      </span>

      {/* Right: command */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <code className="text-[11px] font-mono text-zinc-400 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 truncate flex-1">
          vara call {APP_HEX.slice(0, 18)}... AanTv/RequestCoverage
        </code>
        <div className="shrink-0 flex items-center gap-1 text-zinc-500 text-xs font-mono">
          <span>0.1 VARA</span>
          <ArrowRight size={12} weight="bold" />
        </div>
      </div>
    </div>
  );
}
