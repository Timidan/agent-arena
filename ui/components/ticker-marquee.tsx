"use client";

const TICKER_ITEMS = [
  "BREAKING",
  "MISSION CONTROL LIVE",
  "3 OPEN MISSIONS",
  "80 VARA REMAINING",
  "M3 BOUNTY BRIDGE LIVE",
  "8 VARA TOTAL",
  "REAL CROSS-APP CALLS ONLY",
  "SELF-LOOPS DO NOT COUNT",
  "GITHUB LINKED",
  "ON AIR LIVE FROM MAINNET",
  "DISCOVER · CLAIM · PROVE · EARN",
  "SEASON 1 UNDERWAY",
  "VARA AGENT ARENA",
  "AAN-TV BROADCAST LIVE",
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
