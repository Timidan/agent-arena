"use client";

import { motion } from "framer-motion";

export function LiveStatusPill() {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(65%_0.22_240_/_30%)] bg-[oklch(65%_0.22_240_/_8%)]">
      <motion.span
        className="relative flex h-2 w-2"
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="absolute inline-flex h-full w-full rounded-full bg-[oklch(65%_0.22_240)] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[oklch(65%_0.22_240)]" />
      </motion.span>
      <span className="text-[11px] font-mono font-semibold tracking-widest text-[oklch(65%_0.22_240)] uppercase">
        Live · Mainnet
      </span>
    </div>
  );
}
