"use client";

import { useEffect, useRef } from "react";
import type { HourlyCount } from "@/lib/indexer";

interface BroadcastSparklineProps {
  data: HourlyCount[];
}

const PHOSPHOR_GREEN = "#39FF14";
const W = 600;
const H = 100;
const PAD_X = 6;
const PAD_Y = 10;

function buildPath(data: HourlyCount[], maxCount: number): string {
  if (data.length === 0) return "";
  const usableW = W - PAD_X * 2;
  const usableH = H - PAD_Y * 2;

  const points = data.map((d, i) => {
    const x = PAD_X + (i / (data.length - 1)) * usableW;
    const y =
      maxCount === 0
        ? PAD_Y + usableH / 2
        : PAD_Y + usableH - (d.count / maxCount) * usableH;
    return `${x},${y}`;
  });

  return `M ${points.join(" L ")}`;
}

export function BroadcastSparkline({ data }: BroadcastSparklineProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);

  const allZero = data.every((d) => d.count === 0);
  const maxCount = allZero ? 0 : Math.max(...data.map((d) => d.count));
  const totalCount = data.reduce((s, d) => s + d.count, 0);
  const avgPerHour = Math.round(totalCount / 24);
  const peakIdx = allZero
    ? -1
    : data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);

  const usableW = W - PAD_X * 2;
  const usableH = H - PAD_Y * 2;

  const peakX =
    peakIdx >= 0
      ? PAD_X + (peakIdx / (data.length - 1)) * usableW
      : 0;
  const peakY =
    peakIdx >= 0 && maxCount > 0
      ? PAD_Y + usableH - (data[peakIdx].count / maxCount) * usableH
      : PAD_Y + usableH / 2;

  const linePath = allZero
    ? `M ${PAD_X},${PAD_Y + usableH / 2} L ${W - PAD_X},${PAD_Y + usableH / 2}`
    : buildPath(data, maxCount);

  useEffect(() => {
    const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = pathRef.current;
    const glowEl = glowRef.current;
    if (!el || !glowEl || !motionOk) return;

    const len = el.getTotalLength();
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    glowEl.style.strokeDasharray = String(len);
    glowEl.style.strokeDashoffset = String(len);

    let start: number | null = null;
    const DURATION = 1200;

    function step(ts: number) {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / DURATION, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const offset = String(len * (1 - eased));
      if (el) el.style.strokeDashoffset = offset;
      if (glowEl) glowEl.style.strokeDashoffset = offset;
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }, [data]);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-zinc-800/60 bg-zinc-950/80 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase">
          Broadcast Rate · Last 24H
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">
            {totalCount} total · {avgPerHour}/h avg
          </span>
          <span className="flex items-center gap-1">
            <span
              className="relative flex h-1.5 w-1.5"
              aria-hidden
            >
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: PHOSPHOR_GREEN }}
              />
              <span
                className="relative inline-flex rounded-full h-1.5 w-1.5"
                style={{ backgroundColor: PHOSPHOR_GREEN }}
              />
            </span>
            <span
              className="font-mono text-[10px] tracking-widest uppercase"
              style={{ color: PHOSPHOR_GREEN }}
            >
              LIVE
            </span>
          </span>
        </div>
      </div>

      {/* SVG oscilloscope */}
      <div className="px-1 pb-1">
        <svg
          viewBox={`0 0 ${W} ${H + 20}`}
          className="w-full"
          style={{ height: "120px" }}
          aria-label="Broadcast rate last 24 hours"
          role="img"
        >
          <defs>
            <filter id="phosphor-glow" x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal grid lines at quartiles */}
          {[0.25, 0.5, 0.75, 1.0].map((q) => {
            const y = PAD_Y + (1 - q) * usableH;
            return (
              <line
                key={q}
                x1={PAD_X}
                y1={y}
                x2={W - PAD_X}
                y2={y}
                stroke="rgba(57,255,20,0.08)"
                strokeDasharray="2 4"
                strokeWidth="1"
              />
            );
          })}

          {/* Empty state dashed line label */}
          {allZero && (
            <text
              x={W / 2}
              y={PAD_Y + usableH / 2 - 6}
              textAnchor="middle"
              className="font-mono"
              fill="rgba(57,255,20,0.4)"
              fontSize="9"
              letterSpacing="2"
            >
              NO BROADCASTS YET
            </text>
          )}

          {/* Glow copy of the line (blurred, behind) */}
          <path
            ref={glowRef}
            d={linePath}
            fill="none"
            stroke={PHOSPHOR_GREEN}
            strokeWidth="4"
            strokeOpacity="0.25"
            filter="url(#phosphor-glow)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={allZero ? "4 6" : undefined}
          />

          {/* Main line */}
          <path
            ref={pathRef}
            d={linePath}
            fill="none"
            stroke={PHOSPHOR_GREEN}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={allZero ? "4 6" : undefined}
          />

          {/* Peak marker (only when data exists) */}
          {!allZero && peakIdx >= 0 && (
            <>
              <circle
                cx={peakX}
                cy={peakY}
                r={3}
                fill={PHOSPHOR_GREEN}
                filter="url(#phosphor-glow)"
              />
              <text
                x={peakX}
                y={peakY - 6}
                textAnchor="middle"
                fill={PHOSPHOR_GREEN}
                fontSize="11"
                fontFamily="var(--font-display), monospace"
              >
                {data[peakIdx].count}
              </text>
            </>
          )}

          {/* X-axis labels */}
          <text
            x={PAD_X}
            y={H + 16}
            fill="#52525b"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            24H AGO
          </text>
          <text
            x={W - PAD_X}
            y={H + 16}
            textAnchor="end"
            fill="#52525b"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            NOW
          </text>
        </svg>
      </div>
    </div>
  );
}
