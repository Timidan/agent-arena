// Server component — broadcast monitor bezel wrapper
import type { ReactNode } from "react";

interface BroadcastFrameProps {
  children: ReactNode;
  label?: string;
}

export function BroadcastFrame({ children, label = "MONITOR FEED" }: BroadcastFrameProps) {
  return (
    <div className="relative rounded-lg border border-[#3D4A5C] bg-[#111820] overflow-hidden">
      {/* Bezel top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0A0E14] border-b border-[#2A3340]">
        <span className="font-pixel text-[#7A8896] text-[7px] tracking-widest uppercase">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF3838]" aria-hidden />
          <span className="h-1.5 w-1.5 rounded-full bg-[#FF9F1C]" aria-hidden />
          <span className="h-1.5 w-1.5 rounded-full bg-[#39FF14]" aria-hidden />
        </div>
      </div>
      {/* Monitor content area with card-scanlines */}
      <div className="card-scanlines p-5">
        {children}
      </div>
    </div>
  );
}
