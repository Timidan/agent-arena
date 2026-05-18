/**
 * Voucher refresh pattern — per references/vouchers.md.
 *
 * GET first (read-only, no tranche consumed).
 * POST only when: no voucher, PID not covered, or balance low + eligible.
 * Operational rules from references/vouchers.md:
 *   - Reuse existing while balanceKnown=true and varaBalance >= 10 VARA
 *   - If balanceKnown=false, do NOT treat as drained — reuse existing voucher
 *   - Never spend wallet's own VARA for gas
 */

const LOW_BALANCE_PLANCK = 10_000_000_000_000n; // 10 VARA in planck

interface VoucherState {
  voucherId: string | null;
  varaBalance: string | null;
  balanceKnown: boolean;
  canTopUpNow: boolean;
  nextTopUpEligibleAt: string | null;
  programs: string[];
}

let cachedVoucherId: string | null = null;
let lastFetchedMs = 0;
const REFRESH_INTERVAL_MS = 55 * 60 * 1000; // 55 minutes (vouchers valid 24h, top-up hourly)

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/**
 * Refresh the voucher if stale or missing.
 * Returns the current VOUCHER_ID (cached or freshly fetched).
 * Also sets process.env.VOUCHER_ID for subsequent vara-wallet calls in this session.
 */
export async function refreshVoucher(): Promise<string> {
  const now = Date.now();

  // Return cached value if fresh
  if (cachedVoucherId && now - lastFetchedMs < REFRESH_INTERVAL_MS) {
    return cachedVoucherId;
  }

  const voucherUrl = requireEnv('VOUCHER_URL');
  const operatorHex = requireEnv('OPERATOR_HEX');
  const pid = requireEnv('PID');

  const stateUrl = `${voucherUrl}/${operatorHex}`;

  // GET first — read-only
  const state = (await fetchJson(stateUrl)) as VoucherState;

  const voucherId = state.voucherId;
  const balanceKnown = state.balanceKnown;
  const varaBalance = BigInt(state.varaBalance ?? '0');
  const canTopUpNow = state.canTopUpNow;
  const hasPid = state.programs?.includes(pid) ?? false;

  const needsTopUp = balanceKnown && varaBalance < LOW_BALANCE_PLANCK;

  const shouldPost =
    !voucherId || !hasPid || (needsTopUp && canTopUpNow);

  if (!shouldPost) {
    // Reuse existing
    if (!voucherId) throw new Error('Voucher backend returned no voucherId and POST not needed');
    cachedVoucherId = voucherId;
    lastFetchedMs = now;
    process.env.VOUCHER_ID = voucherId;
    return voucherId;
  }

  // POST to register / top-up
  const body = JSON.stringify({ account: operatorHex, programs: [pid] });
  let newVoucherId: string | null = null;

  try {
    const resp = await fetchJson(voucherUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }) as { voucherId?: string };
    newVoucherId = resp.voucherId ?? null;
  } catch (err) {
    // 429 = rate-limited; reuse existing if we have one
    if (voucherId) {
      console.warn('[voucher] POST rate-limited; reusing existing voucher:', voucherId);
      cachedVoucherId = voucherId;
      lastFetchedMs = now;
      process.env.VOUCHER_ID = voucherId;
      return voucherId;
    }
    throw err;
  }

  if (!newVoucherId) {
    // Fall back to existing if POST didn't return one
    if (voucherId) {
      cachedVoucherId = voucherId;
      lastFetchedMs = now;
      process.env.VOUCHER_ID = voucherId;
      return voucherId;
    }
    throw new Error('Voucher backend POST returned no voucherId');
  }

  if (balanceKnown && needsTopUp && !canTopUpNow) {
    throw new Error(
      `Voucher balance low (${varaBalance} planck) and next top-up not eligible until ${state.nextTopUpEligibleAt}`,
    );
  }

  cachedVoucherId = newVoucherId;
  lastFetchedMs = now;
  process.env.VOUCHER_ID = newVoucherId;
  return newVoucherId;
}
