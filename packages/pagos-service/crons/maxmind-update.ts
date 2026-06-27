/**
 * MaxMind GeoLite2 update cron — weekly Mon 05:00 COL.
 *
 * Downloads the latest GeoLite2-City.mmdb from MaxMind and republishes
 * the Lambda Layer with the new version.
 *
 * PR 5: STUB — implementation deferred to PR 6 (Lambda Layer bundling).
 *
 * SPEC:
 *   1. Download from https://download.maxmind.com/app/geoip_download
 *      with license key + edition=GeoLite2-City
 *   2. Extract .mmdb from tarball
 *   3. Republish Lambda Layer `GeoIpLayer` with new version
 *   4. Verify by re-loading and checking a known IP
 *
 * Failure modes:
 *   - MaxMind 401 (license invalid): DPO alert, no Layer update
 *   - Download timeout (5 min): retry once with exponential backoff
 *   - Verification fails: rollback to previous version
 */

export interface MaxMindUpdateConfig {
  /** MaxMind license key (env: MAXMIND_LICENSE_KEY). */
  licenseKey: string;
  /** S3 bucket for staging the new .mmdb before layer republish. */
  stagingBucket: string;
  /** Lambda Layer name to update. */
  layerName: string;
}

/** STUB — full impl in PR 6. */
export async function handler(): Promise<void> {
  throw new Error("MaxMind-update cron not implemented in PR 5 — wire in PR 6");
}

export class MaxMindUpdater {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: MaxMindUpdateConfig) {}

  async run(): Promise<{ updated: boolean; version?: number }> {
    // PR 6: implement
    throw new Error("Not implemented in PR 5");
  }
}