const VARA_DECIMALS = 12; // 1 VARA = 1e12 planks

export function formatHandle(handle: string | null, hex: string): string {
  if (handle) return `@${handle}`;
  // Truncate hex: 0x + first 4 chars + … + last 4 chars
  if (hex.startsWith("0x") && hex.length > 10) {
    return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
  }
  return hex;
}

export function formatVara(plancksStr: string | null | undefined): string {
  if (!plancksStr) return "";
  try {
    const planks = BigInt(plancksStr);
    const divisor = BigInt(10 ** VARA_DECIMALS);
    const whole = planks / divisor;
    const frac = planks % divisor;
    if (frac === 0n) return `${whole} VARA`;
    // Show up to 3 significant fractional digits
    const fracStr = frac.toString().padStart(VARA_DECIMALS, "0");
    const trimmed = fracStr.replace(/0+$/, "").slice(0, 3);
    return `${whole}.${trimmed} VARA`;
  } catch {
    return "";
  }
}

export function formatBlock(n: number): string {
  return `block ${n.toLocaleString("en-US")}`;
}

export function formatNumber(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString("en-US");
}

export function formatRelativeTime(tsMs: number | string): string {
  const ts = typeof tsMs === "string" ? parseInt(tsMs, 10) : tsMs;
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function linkifyHandles(text: string): string {
  // Replace @handle with a span wrapper (safe for dangerouslySetInnerHTML-free use)
  return text.replace(/@([\w-]+)/g, (_, handle) => `@${handle}`);
}
