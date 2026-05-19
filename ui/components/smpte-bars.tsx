// Server component — SMPTE color bars for footer accent

const SMPTE_COLORS = [
  "#C0C0C0", // white/silver
  "#C0C000", // yellow
  "#00C0C0", // cyan
  "#00C000", // green
  "#C000C0", // magenta
  "#C00000", // red
  "#0000C0", // blue
  "#000000", // black
];

export function SmpteBar() {
  return (
    <div
      className="flex w-full h-1.5 overflow-hidden rounded-none"
      aria-hidden
      role="presentation"
    >
      {SMPTE_COLORS.map((color, i) => (
        <div
          key={i}
          className="flex-1"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
