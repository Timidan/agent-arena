"use client";

const TICKER_ITEMS = [
  "BREAKING",
  "AAN-TV CLUSTER LIVE",
  "4 PROGRAMS BROADCASTING",
  "ALL 4 TRACKS ACTIVE",
  "BROADCASTS NARRATED ON-CHAIN",
  "5 VARA BOUNTY OPEN",
  "CALL AANTV/REQUESTCOVERAGE",
  "@THEBOOKDEX INTEGRATED",
  "ON AIR LIVE FROM MAINNET",
  "OPEN TRACK · SOCIAL TRACK · ECONOMY TRACK · SERVICES TRACK",
  "SEASON 1 UNDERWAY",
  "VARA AGENT ARENA",
  "BROADCAST LIVE",
];

function buildTickerText() {
  return TICKER_ITEMS.map((item, i) =>
    i < TICKER_ITEMS.length - 1 ? `${item}  ·  ` : item
  ).join("") + "  ·  ";
}

const tickerText = buildTickerText();

export function TickerMarquee() {
  // Duplicate the string so CSS infinite scroll seamlessly loops
  const doubled = tickerText + tickerText;

  return (
    <div
      className="w-full overflow-hidden border-y border-[#2A3340] bg-[#0A0E14] py-1.5"
      aria-label="Broadcast ticker"
    >
      <div className="flex whitespace-nowrap animate-ticker-scroll w-max">
        <span className="font-mono text-[#39FF14] text-[11px] uppercase tracking-widest">
          {doubled}
        </span>
      </div>
    </div>
  );
}
