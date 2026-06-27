/**
 * Tor refresh cron — daily 04:00 COL.
 *
 * Fetches the official Tor exit list and reloads the in-memory TorList.
 *
 * Source: https://check.torproject.org/torbulkexitlist
 * Format: one IP per line, comments start with #
 */

import { TorList } from "../src/lib/tor-list.js";

export interface TorListFetcher {
  fetch(): Promise<string>;
}

export interface TorRefreshDeps {
  fetcher: TorListFetcher;
  torList: typeof TorList;
  now?: () => Date;
}

export interface TorRefreshResult {
  fetched: number;
  loadedAt: string;
  error?: string;
}

export class TorRefreshCron {
  private readonly fetcher: TorListFetcher;
  private readonly torList: typeof TorList;
  private readonly now: () => Date;

  constructor(deps: TorRefreshDeps) {
    this.fetcher = deps.fetcher;
    this.torList = deps.torList;
    this.now = deps.now ?? (() => new Date());
  }

  async run(): Promise<TorRefreshResult> {
    try {
      const text = await this.fetcher.fetch();
      const loadedAt = this.now();
      this.torList.loadFromText(text, () => loadedAt);
      return {
        fetched: this.torList.size(),
        loadedAt: loadedAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        fetched: 0,
        loadedAt: this.now().toISOString(),
        error: message,
      };
    }
  }
}

/**
 * AWS Lambda handler for EventBridge cron.
 * PR 6 wires this to `sst.aws.Cron` schedule `cron(0 4 * * ? *)` (4 AM COL).
 */
export async function handler(): Promise<void> {
  // PR 6: real fetch from https://check.torproject.org/torbulkexitlist
  throw new Error("Not implemented in PR 5 — wire in PR 6");
}