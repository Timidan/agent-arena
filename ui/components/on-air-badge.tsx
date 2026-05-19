"use client";

export function OnAirBadge() {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 border border-[#FF3838]/60 bg-[#FF3838]/10 rounded-sm">
      <span
        className="h-2 w-2 rounded-full bg-[#FF3838] animate-onair-pulse"
        aria-hidden
      />
      <span className="font-pixel text-[#FF3838] text-[8px] tracking-widest uppercase leading-none">
        ON AIR
      </span>
    </div>
  );
}
