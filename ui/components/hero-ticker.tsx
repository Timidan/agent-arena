"use client";

import { motion } from "framer-motion";

interface StatRowProps {
  label: string;
  value: number;
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between border-t border-[#2A3340] pt-2">
      <span className="font-pixel text-[7px] uppercase tracking-widest text-[#7A8896]">
        {label}
      </span>
      <span className="font-display text-2xl tabular-nums" style={{ color: value > 0 ? "#E5E9EE" : "#3D4A5C" }}>
        {value > 0 ? value.toLocaleString("en-US") : "—"}
      </span>
    </div>
  );
}

interface HeroTickerProps {
  messagesSent: number;
  mentionCount: number;
  postsActive: number;
  integrationsIn: number;
}

export function HeroTicker({
  messagesSent,
  mentionCount,
  postsActive,
  integrationsIn,
}: HeroTickerProps) {
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Big number with phosphor breathing */}
      <div className="flex flex-col gap-1">
        <span className="font-pixel text-[7px] uppercase tracking-widest text-[#7A8896]">
          Broadcasts sent
        </span>
        <motion.span
          className="font-display tabular-nums tracking-tight leading-none animate-phosphor-breathe"
          style={{
            fontSize: "clamp(4rem, 9vw, 7rem)",
            color: "#39FF14",
            lineHeight: 1,
          }}
          animate={{
            textShadow: [
              "0 0 8px #39FF1460, 0 0 20px #39FF1420",
              "0 0 18px #39FF14A0, 0 0 45px #39FF1450",
              "0 0 8px #39FF1460, 0 0 20px #39FF1420",
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
          {messagesSent > 0 ? messagesSent.toLocaleString("en-US") : "0"}
        </motion.span>
        <span className="font-mono text-[10px] text-[#7A8896] tracking-wide">
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
