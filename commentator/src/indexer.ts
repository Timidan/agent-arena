/**
 * GraphQL client for the Vara Agent Network indexer.
 *
 * Endpoint: INDEXER_GRAPHQL_URL (default: https://agents-api.vara.network/graphql)
 *
 * PostGraphile with connection-filter plugin: all* connection naming,
 * filter shape: { field: { equalTo: "..." } }, point queries: *ById.
 *
 * Entity-id key shapes:
 *   applicationById(id: "<program_hex>")
 *   appMetricById(id: "<program_hex>:<season_id>")
 *   participantById(id: "<actor_hex>")
 */

import { GraphQLClient, gql } from 'graphql-request';

const endpoint =
  process.env.INDEXER_GRAPHQL_URL ?? 'https://agents-api.vara.network/graphql';

let _client: GraphQLClient | null = null;
function client(): GraphQLClient {
  if (!_client) _client = new GraphQLClient(endpoint);
  return _client;
}

// ── types ──────────────────────────────────────────────────────────────────

export interface Interaction {
  id: string;
  blockNumber: number;
  fromActor: string;
  toApplicationId: string;
  methodName: string;
  /** Raw JSON string from the indexer — decoded defensively by callers */
  argsJson: string | null;
}

export interface HandleResult {
  handle: string;
  kind: 'Participant' | 'Application';
}

export interface AppMetric {
  programId: string;
  seasonId: number;
  messagesSent: number;
  mentionCount: number;
  integrationsIn: number;
  integrationsOut: number;
  postsActive: number;
}

// ── handle cache ──────────────────────────────────────────────────────────

const handleCache = new Map<string, { result: HandleResult | null; fetchedAt: number }>();

function cacheTtl(): number {
  return parseInt(process.env.HANDLE_CACHE_TTL_MS ?? '3600000', 10);
}

// ── fetchInteractionsSinceBlock ───────────────────────────────────────────

const INTERACTIONS_QUERY = gql`
  query InteractionsSince($sinceBlock: Int!, $limit: Int!) {
    allInteractions(
      first: $limit
      orderBy: SUBSTRATE_BLOCK_NUMBER_ASC
      filter: { substrateBlockNumber: { greaterThan: $sinceBlock } }
    ) {
      nodes {
        id
        substrateBlockNumber
        fromActor
        toApplicationId
        methodName
        argsJson
      }
    }
  }
`;

interface InteractionsQueryResult {
  allInteractions: {
    nodes: {
      id: string;
      substrateBlockNumber: number;
      fromActor: string;
      toApplicationId: string;
      methodName: string;
      argsJson: string | null;
    }[];
  };
}

export async function fetchInteractionsSinceBlock(
  sinceBlock: number,
  limit = 50,
): Promise<Interaction[]> {
  const data = await client().request<InteractionsQueryResult>(INTERACTIONS_QUERY, {
    sinceBlock,
    limit,
  });

  return data.allInteractions.nodes.map((n) => ({
    id: n.id,
    blockNumber: n.substrateBlockNumber,
    fromActor: n.fromActor,
    toApplicationId: n.toApplicationId,
    methodName: n.methodName,
    argsJson: n.argsJson ?? null,
  }));
}

// ── fetchChainTipBlock ────────────────────────────────────────────────────

const CHAIN_TIP_QUERY = gql`
  query ChainTip {
    allInteractions(first: 1, orderBy: SUBSTRATE_BLOCK_NUMBER_DESC) {
      nodes {
        substrateBlockNumber
      }
    }
  }
`;

interface ChainTipQueryResult {
  allInteractions: {
    nodes: { substrateBlockNumber: number }[];
  };
}

/**
 * Returns the highest block number currently in the indexer.
 * Used for cold-start seeding: watcher sets lastSeenBlock = tipBlock - 100
 * instead of 0, so the first tick processes only ~100 blocks of recent
 * history rather than the entire network history since genesis.
 */
export async function fetchChainTipBlock(): Promise<number> {
  const data = await client().request<ChainTipQueryResult>(CHAIN_TIP_QUERY);
  const tip = data.allInteractions.nodes[0]?.substrateBlockNumber ?? 0;
  return tip;
}

// ── fetchCoverageQueueSince ───────────────────────────────────────────────
// We rely on allInteractions filtered by our APP_HEX + RequestCoverage to
// discover paid coverage requests, then decode argsJson defensively.
// This avoids needing a typed Sails read client for GetCoverageQueue.

const COVERAGE_REQUESTS_QUERY = gql`
  query CoverageRequestsSince($appHex: String!, $sinceBlock: Int!, $limit: Int!) {
    allInteractions(
      first: $limit
      orderBy: SUBSTRATE_BLOCK_NUMBER_ASC
      filter: {
        toApplicationId: { equalTo: $appHex }
        methodName: { equalTo: "RequestCoverage" }
        substrateBlockNumber: { greaterThan: $sinceBlock }
      }
    ) {
      nodes {
        id
        substrateBlockNumber
        fromActor
        toApplicationId
        methodName
        argsJson
      }
    }
  }
`;

export async function fetchCoverageQueueSince(
  sinceBlock: number,
  limit = 50,
): Promise<Interaction[]> {
  const appHex = process.env.APP_HEX ?? '';
  const data = await client().request<InteractionsQueryResult>(COVERAGE_REQUESTS_QUERY, {
    appHex,
    sinceBlock,
    limit,
  });

  return data.allInteractions.nodes.map((n) => ({
    id: n.id,
    blockNumber: n.substrateBlockNumber,
    fromActor: n.fromActor,
    toApplicationId: n.toApplicationId,
    methodName: n.methodName,
    argsJson: n.argsJson ?? null,
  }));
}

// ── resolveHandle ─────────────────────────────────────────────────────────

const PARTICIPANT_QUERY = gql`
  query ParticipantById($id: String!) {
    participantById(id: $id) {
      handle
    }
  }
`;

const APPLICATION_QUERY = gql`
  query ApplicationById($id: String!) {
    applicationById(id: $id) {
      handle
    }
  }
`;

interface ParticipantQueryResult {
  participantById: { handle: string } | null;
}

interface ApplicationQueryResult {
  applicationById: { handle: string } | null;
}

export async function resolveHandle(hex: string): Promise<string | null> {
  const now = Date.now();
  const cached = handleCache.get(hex);
  if (cached && now - cached.fetchedAt < cacheTtl()) {
    return cached.result?.handle ?? null;
  }

  // Try participant first, then application
  let result: HandleResult | null = null;

  try {
    const pData = await client().request<ParticipantQueryResult>(PARTICIPANT_QUERY, { id: hex });
    if (pData.participantById?.handle) {
      result = { handle: pData.participantById.handle, kind: 'Participant' };
    }
  } catch {
    // ignore individual lookup errors
  }

  if (!result) {
    try {
      const aData = await client().request<ApplicationQueryResult>(APPLICATION_QUERY, { id: hex });
      if (aData.applicationById?.handle) {
        result = { handle: aData.applicationById.handle, kind: 'Application' };
      }
    } catch {
      // ignore
    }
  }

  handleCache.set(hex, { result, fetchedAt: now });
  return result?.handle ?? null;
}

// ── fetchAppMetric ────────────────────────────────────────────────────────

const APP_METRIC_QUERY = gql`
  query AppMetricById($id: String!) {
    appMetricById(id: $id) {
      programId
      seasonId
      messagesSent
      mentionCount
      integrationsIn
      integrationsOut
      postsActive
    }
  }
`;

interface AppMetricQueryResult {
  appMetricById: {
    programId: string;
    seasonId: number;
    messagesSent: number;
    mentionCount: number;
    integrationsIn: number;
    integrationsOut: number;
    postsActive: number;
  } | null;
}

export async function fetchAppMetric(appHex: string, seasonId = 1): Promise<AppMetric | null> {
  const id = `${appHex}:${seasonId}`;
  try {
    const data = await client().request<AppMetricQueryResult>(APP_METRIC_QUERY, { id });
    if (!data.appMetricById) return null;
    return {
      programId: data.appMetricById.programId,
      seasonId: data.appMetricById.seasonId,
      messagesSent: data.appMetricById.messagesSent,
      mentionCount: data.appMetricById.mentionCount,
      integrationsIn: data.appMetricById.integrationsIn,
      integrationsOut: data.appMetricById.integrationsOut,
      postsActive: data.appMetricById.postsActive,
    };
  } catch {
    return null;
  }
}

// ── argsJson decoder (defensive) ──────────────────────────────────────────

/**
 * Attempt to parse argsJson from an indexer interaction.
 *
 * The indexer stores args as a JSON array matching the IDL positional params.
 * For RequestCoverage(event_kind, target_program, hint):
 *   argsJson = ["MarketResolved", "0x...", "some hint"]
 *           or [{"Custom": null}, null, "some hint"]
 *
 * We defensively handle both tagged-enum objects and plain strings.
 * Unknown formats return null for the field rather than throwing.
 */
export function decodeRequestCoverageArgs(argsJson: string | null): {
  eventKind: string | null;
  targetProgram: string | null;
  hint: string;
} {
  const fallback = { eventKind: null, targetProgram: null, hint: '' };
  if (!argsJson) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return fallback;
  }

  if (!Array.isArray(parsed)) return fallback;

  // event_kind: may be plain string or { "MarketResolved": null } / { "Custom": null }
  let eventKind: string | null = null;
  const rawKind = parsed[0];
  if (typeof rawKind === 'string') {
    eventKind = rawKind;
  } else if (rawKind !== null && typeof rawKind === 'object') {
    const keys = Object.keys(rawKind as Record<string, unknown>);
    if (keys.length > 0) eventKind = keys[0];
  }

  // target_program: may be hex string or null
  const rawTarget = parsed[1];
  const targetProgram = typeof rawTarget === 'string' ? rawTarget : null;

  // hint: must be a string; cap at 240 chars defensively
  const rawHint = parsed[2];
  const hint = typeof rawHint === 'string' ? rawHint.slice(0, 240) : '';

  return { eventKind, targetProgram, hint };
}
