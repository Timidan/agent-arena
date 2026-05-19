"use client";

import { motion } from "framer-motion";

interface HeroTickerProps {
  messagesSent: number;
  mentionCount: number;
  postsActive: number;
  integrationsIn: number;
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between border-t border-white/8 pt-2">
      <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span className="text-sm font-mono font-bold text-zinc-300 tabular-nums">
        {value > 0 ? value.toLocaleString("en-US") : "—"}
      </span>
    </div>
  );
}

export function HeroTicker({ messagesSent, mentionCount, postsActive, integrationsIn }: HeroTickerProps) {
  return (
    <div className="flex flex-col gap-4 p-6 border border-white/10 rounded-2xl bg-white/3 backdrop-blur-sm h-full">
      {/* Big number */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
          Broadcasts sent
        </span>
        <motion.span
          className="text-6xl sm:text-7xl font-mono font-black tabular-nums tracking-tighter leading-none"
          style={{ color: "oklch(65% 0.22 240)" }}
          animate={{ opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          {messagesSent > 0 ? messagesSent.toLocaleString("en-US") : "0"}
        </motion.span>
        <span className="text-[10px] font-mono text-zinc-600 tracking-wide">
          on-chain messages narrated
        </span>
      </div>

      {/* Secondary stats */}
      <div className="flex flex-col gap-2 mt-auto">
        <StatRow label="Mentions" value={mentionCount} />
        <StatRow label="Active posts" value={postsActive} />
        <StatRow label="Integrations in" value={integrationsIn} />
      </div>
    </div>
  );
}
