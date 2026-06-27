/**
 * IP2Proxy LITE PX2 update cron — bi-weekly Wed 05:00 COL.
 *
 * Downloads the latest IP2Proxy-PX2.BIN from lite.ip2location.com
 * and republishes the Lambda Layer.
 *
 * PR 5: STUB — implementation deferred to PR 6.
 *
 * SPEC:
 *   1. Download from https://lite.ip2location.com/ip2proxy-lite (PX2 BIN)
 *   2. No auth required (free LITE)
 *   3. Republish Lambda Layer `GeoIpLayer` with new version
 *
 * The IP2Proxy PX2 binary is small (~5MB) and updates infrequently,
 * so a bi-weekly cron is sufficient.
 */

export interface IP2ProxyUpdateConfig {
  stagingBucket: string;
  layerName: string;
}

/** STUB — full impl in PR 6. */
export async function handler(): Promise<void> {
  throw new Error("IP2Proxy-update cron not implemented in PR 5 — wire in PR 6");
}

export class IP2ProxyUpdater {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: IP2ProxyUpdateConfig) {}

  async run(): Promise<{ updated: boolean; version?: number }> {
    // PR 6: implement
    throw new Error("Not implemented in PR 5");
  }
}