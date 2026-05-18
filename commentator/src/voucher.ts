/**
 * Voucher refresh pattern — per references/vouchers.md.
 *
 * GET first (read-only, no tranche consumed).
 * POST only when: no voucher, PID not covered, or balance low + eligible.
 * Operational rules from references/vouchers.md:
 *   - Reuse existing while balanceKnown=true and varaBalance >= 10 VARA
 *   - If balanceKnown=false, do NOT treat as drained — reuse existing voucher
 *   - Never spend wallet's own VARA for gas
 *
 * Fix 4: ensureFresh() is the new primary entry point. It ALWAYS GETs current
 * state (the GET is free / read-only) and only POSTs if balance is low or
 * the voucher is missing/unconfigured. The watcher calls ensureFresh() at the
 * start of EVERY tick — not on a 55-minute timer — so block-height-based
 * expiry is caught promptly. If ensureFresh() throws, the caller (watcher)
 * must skip the tick and not advance the checkpoint.
 *
 * refreshVoucher() is kept as an alias for backward compat but is no longer
 * called from the main loop.
 */

// 10 VARA in planck (voucher balance threshold triggering a top-up POST)
const LOW_BALANCE_PLANCK = 10_000_000_000_000n;

interface VoucherState {
  voucherId: string | null;
  varaBalance: string | null;
  balanceKnown: boolean;
  canTopUpNow: boolean;
  nextTopUpEligibleAt: string | null;
  programs: string[];
}

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
 * Ensure the voucher is valid and the balance is above LOW_BALANCE_PLANCK.
 * ALWAYS performs a GET to read the current state — the GET is free.
 * Only POSTs (top-up) if the balance is below threshold or the voucher is
 * missing/unconfigured. Sets process.env.VOUCHER_ID on success.
 *
 * Throws on network error or if no valid voucher can be obtained.
 * The watcher must skip the tick if this throws.
 */
export async function ensureFresh(): Promise<string> {
  const voucherUrl = requireEnv('VOUCHER_URL');
  const operatorHex = requireEnv('OPERATOR_HEX');
  const pid = requireEnv('PID');

  const stateUrl = `${voucherUrl}/${operatorHex}`;

  // Always GET — read-only, free
  const state = (await fetchJson(stateUrl)) as VoucherState;

  const voucherId = state.voucherId;
  const balanceKnown = state.balanceKnown;
  const varaBalance = BigInt(state.varaBalance ?? '0');
  const canTopUpNow = state.canTopUpNow;
  const hasPid = state.programs?.includes(pid) ?? false;

  const needsTopUp = balanceKnown && varaBalance < LOW_BALANCE_PLANCK;

  const shouldPost = !voucherId || !hasPid || (needsTopUp && canTopUpNow);

  if (!shouldPost) {
    // Existing voucher is healthy — just set env and return
    if (!voucherId) throw new Error('Voucher backend returned no voucherId and POST not needed');
    process.env.VOUCHER_ID = voucherId;
    return voucherId;
  }

  // POST to register / top-up
  const body = JSON.stringify({ account: operatorHex, programs: [pid] });
  let newVoucherId: string | null = null;

  try {
    const resp = (await fetchJson(voucherUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })) as { voucherId?: string };
    newVoucherId = resp.voucherId ?? null;
  } catch (err) {
    // 429 = rate-limited; reuse existing if we have one
    if (voucherId) {
      console.warn('[voucher] POST rate-limited; reusing existing voucher:', voucherId);
      process.env.VOUCHER_ID = voucherId;
      return voucherId;
    }
    throw err;
  }

  if (!newVoucherId) {
    // Fall back to existing if POST didn't return a new one
    if (voucherId) {
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

  process.env.VOUCHER_ID = newVoucherId;
  return newVoucherId;
}

/**
 * @deprecated Use ensureFresh() instead.
 * Kept for backward compatibility — delegates to ensureFresh().
 */
export async function refreshVoucher(): Promise<string> {
  return ensureFresh();
}
