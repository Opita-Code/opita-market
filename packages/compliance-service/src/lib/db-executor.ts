/**
 * Postgres executor adapter — adapts `pg.Pool` (production) to the small
 * `DbExecutor` interface consumed by audit.ts and rights.ts. Centralising
 * the adapter lets us swap in pglite for tests without leaking pg types.
 */

import { Pool, type PoolClient } from "pg";
import type { DbExecutor } from "./audit.js";

export function makePgExecutor(connectionString: string): DbExecutor & { close: () => Promise<void> } {
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  return {
    async query<T>(sql: string, params?: ReadonlyArray<unknown>) {
      const res = await pool.query<T>(sql, params as unknown[] | undefined);
      return { rows: res.rows };
    },
    async close() {
      await pool.end();
    },
    _pool: pool,
  } as DbExecutor & { close: () => Promise<void>; _pool: Pool };
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}