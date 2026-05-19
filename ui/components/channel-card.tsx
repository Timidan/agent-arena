"use client";

import React, { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/format";

const TRACK_CONFIG: Record<
  string,
  { color: string; border: string; bg: string; barColor: string; label: string }
> = {
  Open: {
    color: "#39FF14",
    border: "border-[#39FF14]/25",
    bg: "bg-[#39FF14]/8",
    barColor: "#39FF14",
    label: "OPEN",
  },
  Social: {
    color: "#FF9F1C",
    border: "border-[#FF9F1C]/25",
    bg: "bg-[#FF9F1C]/8",
    barColor: "#FF9F1C",
    label: "SOCIAL",
  },
  Economy: {
    color: "#FF2D9C",
    border: "border-[#FF2D9C]/25",
    bg: "bg-[#FF2D9C]/8",
    barColor: "#FF2D9C",
    label: "ECONOMY",
  },
  Services: {
    color: "#00CFFF",
    border: "border-[#00CFFF]/25",
    bg: "bg-[#00CFFF]/8",
    barColor: "#00CFFF",
    label: "SERVICES",
  },
};

const CHANNEL_NUMBERS = ["CH01", "CH02", "CH03", "CH04"];

function truncateHex(hex: string): string {
  if (hex.startsWith("0x") && hex.length > 12) {
    return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
  }
  return hex;
}

function CopyHex({ hex, trackColor }: { hex: string; trackColor: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(hex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 group cursor-pointer"
      title="Copy hex address"
    >
      <code className="text-[10px] font-mono text-[#7A8896] group-hover:text-[#E5E9EE] transition-colors">
        {truncateHex(hex)}
      </code>
      <span className="text-[#7A8896] group-hover:text-[#E5E9EE] transition-colors">
        {copied ? (
          <Check size={11} weight="bold" style={{ color: trackColor }} />
        ) : (
          <Copy size={11} />
        )}
      </span>
    </button>
  );
}

export interface ChannelCardMetrics {
  integrationsIn: number;
  messagesSent: number;
  mentionCount: number;
}

export interface ChannelCardProps {
  channelIndex: number; // 0-3
  handle: string;
  track: string;
  hex: string;
  pitch: string;
  emptyState?: string;
  metrics?: ChannelCardMetrics;
  featured?: boolean;
  children?: React.ReactNode;
}

export function ChannelCard({
  channelIndex,
  handle,
  track,
  hex,
  pitch,
  emptyState,
  metrics,
  featured,
  children,
}: ChannelCardProps) {
  const tc = TRACK_CONFIG[track] ?? {
    color: "#7A8896",
    border: "border-[#7A8896]/20",
    bg: "bg-[#7A8896]/5",
    barColor: "#7A8896",
    label: track.toUpperCase(),
  };

  const channelLabel = CHANNEL_NUMBERS[channelIndex] ?? `CH0${channelIndex + 1}`;
  const isEmpty =
    !metrics || (metrics.integrationsIn === 0 && metrics.messagesSent === 0);

  return (
    <div
      className={`
        relative flex flex-col gap-3 rounded-lg border bg-[#111820] overflow-hidden
        transition-all duration-300 card-scanlines
        ${featured ? "h-full" : ""}
        ${tc.border}
      `}
      style={{
        boxShadow: "0 0 0 0 transparent",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = `0 0 0 1px ${tc.barColor}30, 0 8px 32px -8px ${tc.barColor}25`;
        el.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = "0 0 0 0 transparent";
        el.style.transform = "translateY(0)";
      }}
    >
      {/* Track color bar at top */}
      <div
        className="h-0.5 w-full"
        style={{ backgroundColor: tc.barColor }}
        aria-hidden
      />

      <div className={`flex flex-col gap-3 px-4 pb-4 ${featured ? "pt-1" : "pt-1"}`}>
        {/* Channel number + track badge + live dot */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-pixel text-[8px] tracking-wider" style={{ color: tc.barColor }}>
              {channelLabel}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[9px] font-pixel uppercase tracking-wider border ${tc.border} ${tc.bg}`}
              style={{ color: tc.color }}
            >
              {tc.label}
            </span>
          </div>

          {metrics && metrics.integrationsIn > 0 && (
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: tc.barColor }}
              />
              <span
                className="relative inline-flex rounded-full h-1.5 w-1.5"
                style={{ backgroundColor: tc.barColor }}
              />
            </span>
          )}
        </div>

        {/* Handle — VT323 display font */}
        <div className="flex flex-col gap-0.5">
          <span
            className={`font-display tracking-tight leading-none ${
              featured ? "text-4xl" : "text-2xl"
            }`}
            style={{ color: tc.barColor }}
          >
            @{handle}
          </span>
          <span className={`font-mono text-[#7A8896] leading-snug ${featured ? "text-sm" : "text-[11px]"}`}>
            {pitch}
          </span>
        </div>

        {/* Empty state */}
        {isEmpty && emptyState && (
          <div className={`px-3 py-2 rounded-sm border ${tc.border} ${tc.bg}`}>
            <p className={`text-[10px] font-mono leading-snug`} style={{ color: tc.color }}>
              {emptyState}
            </p>
          </div>
        )}

        {/* Stats grid */}
        <div className={`grid grid-cols-3 gap-2 mt-auto`}>
          {[
            { label: "IN", val: metrics?.integrationsIn ?? 0 },
            { label: "MSGS", val: metrics?.messagesSent ?? 0 },
            { label: "MNTN", val: metrics?.mentionCount ?? 0 },
          ].map(({ label, val }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[8px] font-pixel uppercase tracking-widest text-[#7A8896]">
                {label}
              </span>
              <span
                className={`font-display leading-none ${featured ? "text-3xl" : "text-2xl"} tabular-nums ${
                  val > 0 ? "glow-green-sm" : "opacity-30"
                }`}
                style={{ color: val > 0 ? tc.barColor : "#7A8896" }}
              >
                {formatNumber(val)}
              </span>
            </div>
          ))}
        </div>

        {/* Injected slot — used by CH01 for sparkline + feed monitor */}
        {children && <div className="flex flex-col gap-4">{children}</div>}

        {/* Hex */}
        <div className="border-t border-[#2A3340] pt-2">
          <CopyHex hex={hex} trackColor={tc.barColor} />
        </div>
      </div>
    </div>
  );
}
