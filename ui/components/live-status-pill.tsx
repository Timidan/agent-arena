"use client";

import { motion } from "framer-motion";

export function LiveStatusPill() {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm border border-[#39FF14]/40 bg-[#39FF14]/10">
      <motion.span
        className="relative flex h-2 w-2"
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#39FF14] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#39FF14]" />
      </motion.span>
      <span className="font-pixel text-[7px] font-semibold tracking-widest text-[#39FF14] uppercase">
        Live · Mainnet
      </span>
    </div>
  );
}
