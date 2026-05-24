import {
  getDailySpendSnapshot,
  reserveDailySpend,
  type DailySpendKind,
  type DailySpendSnapshot,
} from './checkpoint.js';

interface DailyLimitConfig {
  kind: DailySpendKind;
  label: string;
  countField: 'chatPosts' | 'markCoveredCalls' | 'partnerCalls' | 'missionVerifierCalls';
  maxCountEnv: string;
  defaultMaxCount: number;
  estimatedSpendEnv: string;
  defaultEstimatedSpendRaw: bigint;
}

function parseCountLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < -1) {
    throw new Error(`${name} must be -1 or a non-negative number`);
  }
  return Math.floor(parsed);
}

function parseRawAmount(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = BigInt(raw);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a non-negative integer planck amount`);
  }
}

function ensureLimit(config: DailyLimitConfig): DailySpendSnapshot {
  const snapshot = getDailySpendSnapshot();
  const maxCount = parseCountLimit(config.maxCountEnv, config.defaultMaxCount);
  const estimatedSpendRaw = parseRawAmount(
    config.estimatedSpendEnv,
    config.defaultEstimatedSpendRaw,
  );
  const maxDailySpendRaw = parseRawAmount('MAX_DAILY_SPEND_RAW', 0n);

  const nextCount = snapshot[config.countField] + 1;
  if (maxCount >= 0 && nextCount > maxCount) {
    throw new Error(
      `${config.label} daily cap reached: ${nextCount}/${maxCount} ` +
        `(override ${config.maxCountEnv} intentionally)`,
    );
  }

  const nextEstimatedSpendRaw = snapshot.estimatedSpendRaw + estimatedSpendRaw;
  if (maxDailySpendRaw > 0n && nextEstimatedSpendRaw > maxDailySpendRaw) {
    throw new Error(
      `MAX_DAILY_SPEND_RAW cap reached: ${nextEstimatedSpendRaw}/${maxDailySpendRaw}`,
    );
  }

  return reserveDailySpend(config.kind, estimatedSpendRaw);
}

export function reserveChatPostBudget(): DailySpendSnapshot {
  return ensureLimit({
    kind: 'chat_post',
    label: 'Chat/Post',
    countField: 'chatPosts',
    maxCountEnv: 'MAX_DAILY_CHAT_POSTS',
    defaultMaxCount: 48,
    estimatedSpendEnv: 'CHAT_POST_ESTIMATED_SPEND_RAW',
    defaultEstimatedSpendRaw: 0n,
  });
}

export function reserveMarkCoveredBudget(): DailySpendSnapshot {
  return ensureLimit({
    kind: 'mark_covered',
    label: 'AanTv/MarkCovered',
    countField: 'markCoveredCalls',
    maxCountEnv: 'MAX_DAILY_MARK_COVERED_CALLS',
    defaultMaxCount: 48,
    estimatedSpendEnv: 'MARK_COVERED_ESTIMATED_SPEND_RAW',
    defaultEstimatedSpendRaw: 0n,
  });
}

export function reservePartnerCallBudget(): DailySpendSnapshot {
  return ensureLimit({
    kind: 'partner_call',
    label: 'partner call',
    countField: 'partnerCalls',
    maxCountEnv: 'MAX_DAILY_PARTNER_CALLS',
    defaultMaxCount: 0,
    estimatedSpendEnv: 'PARTNER_CALL_ESTIMATED_SPEND_RAW',
    defaultEstimatedSpendRaw: 0n,
  });
}

export function reserveMissionVerifierCallBudget(): DailySpendSnapshot {
  return ensureLimit({
    kind: 'mission_verifier_call',
    label: 'mission verifier call',
    countField: 'missionVerifierCalls',
    maxCountEnv: 'MAX_DAILY_MISSION_VERIFIER_CALLS',
    defaultMaxCount: 0,
    estimatedSpendEnv: 'MISSION_VERIFIER_ESTIMATED_SPEND_RAW',
    defaultEstimatedSpendRaw: 0n,
  });
}
