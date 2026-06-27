/**
 * NIT+DV verification API — task 2.1 of compliance-foundation PR 2.
 *
 * Wraps the Verifik client with a 24h DynamoDB cache so the average rights
 * request does not incur a network round-trip. The cache key is
 *   `nit#{nit}#dv#{dv}` (lowercase). Cache value carries the normalized
 *   Verifik response + provenance metadata (fetched_at, source).
 *
 * Returns the cached response when present and not expired; otherwise calls
 * Verifik and writes back to the cache.
 *
 * Cache table is provisioned by SST in PR 2 commit. In tests we use an
 * in-memory cache implementation (see tests/integration.test.ts).
 */

import { Resource as SSTResource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createVerifikClient,
  VerifikClientOptions,
  VerifikError,
  VerifikNitResponse,
} from "../lib/verifik-client.js";

export const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h

export interface NitDvLookupResult {
  verified: boolean;
  razonSocial?: string;
  source: "cache" | "verifik";
  fetchedAt: string;
  expiresAt: string;
  raw?: VerifikNitResponse;
}

/** Minimal interface so we can swap DynamoDB for an in-memory cache in tests. */
export interface NitCache {
  get(nit: string, dv: string): Promise<NitDvLookupResult | null>;
  put(nit: string, dv: string, value: NitDvLookupResult): Promise<void>;
}

export function makeDynamoCache(tableName: string): NitCache {
  const ddb = new DynamoDBClient({});
  const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const key = (nit: string, dv: string) => ({ nit_dv: `nit#${nit}#dv#${dv.toLowerCase()}` });

  return {
    async get(nit, dv) {
      const res = await doc.send(new GetCommand({ TableName: tableName, Key: key(nit, dv) }));
      const item = res.Item as { payload?: NitDvLookupResult; expires_at?: string } | undefined;
      if (!item?.payload) return null;
      if (item.expires_at && new Date(item.expires_at).getTime() < Date.now()) return null;
      return item.payload;
    },
    async put(nit, dv, value) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            ...key(nit, dv),
            payload: value,
            expires_at: value.expiresAt,
            // DynamoDB TTL attribute (epoch seconds).
            ttl_epoch: Math.floor(new Date(value.expiresAt).getTime() / 1000),
          },
        }),
      );
    },
  };
}

export interface NitDvHandlerOptions {
  verifik: VerifikClientOptions;
  cache: NitCache;
  ttlSeconds?: number;
}

/** Pure dependency-injectable verifier. The Hono handler composes this
 *  with the SST-provided cache + Verifik key. */
export function makeNitDvVerifier(opts: NitDvHandlerOptions) {
  const verifik = createVerifikClient(opts.verifik);
  const ttl = opts.ttlSeconds ?? CACHE_TTL_SECONDS;

  async function verify(nit: string, dv: string): Promise<NitDvLookupResult> {
    const cached = await opts.cache.get(nit, dv);
    if (cached) return { ...cached, source: "cache" };

    try {
      const resp = await verifik.lookupNit(nit, dv);
      const fetchedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      const value: NitDvLookupResult = {
        verified: resp.estado.toUpperCase() === "ACTIVA",
        razonSocial: resp.razonSocial,
        source: "verifik",
        fetchedAt,
        expiresAt,
        raw: resp,
      };
      await opts.cache.put(nit, dv, value);
      return value;
    } catch (e) {
      if (e instanceof VerifikError && e.code === "NOT_FOUND") {
        // Negative cache for 24h to absorb NIT-not-found storms (typos, bad scans).
        const fetchedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
        const value: NitDvLookupResult = {
          verified: false,
          source: "verifik",
          fetchedAt,
          expiresAt,
        };
        await opts.cache.put(nit, dv, value);
        return value;
      }
      throw e;
    }
  }

  return { verify };
}

/** Resolve the SST-managed NitDvCache table name (or fall back to env). */
export function resolveNitCacheTableName(): string {
  // SST exposes linked resources via the `Resource` virtual module.
  // For local tests where `sst dev` hasn't been started, the import
  // resolves to `undefined` at runtime — fall back to env so tests pass.
  try {
    const res = (SSTResource as unknown as { NitDvCache?: { name: string } }).NitDvCache;
    if (res?.name) return res.name;
  } catch {
    // ignore — SSTResource unavailable outside SST runtime
  }
  return process.env.NIT_DV_CACHE_TABLE ?? "";
}