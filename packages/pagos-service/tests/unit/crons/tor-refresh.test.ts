import { describe, it, expect, beforeEach } from "vitest";
import { TorRefreshCron, type TorListFetcher } from "../../../crons/tor-refresh.js";
import { TorList } from "../../../src/lib/tor-list.js";

/**
 * Tests for tor-refresh cron (daily 04:00 COL).
 *
 * Fetches the Tor exit list from https://check.torproject.org/torbulkexitlist
 * and reloads the in-memory TorList.
 */

class FakeFetcher implements TorListFetcher {
  constructor(public response: string = "") {}
  async fetch(): Promise<string> {
    return this.response;
  }
}

describe("tor-refresh cron", () => {
  let fetcher: FakeFetcher;

  beforeEach(() => {
    TorList.reset();
    fetcher = new FakeFetcher();
  });

  it("loads IPs from fetcher into TorList", async () => {
    fetcher.response = "185.220.101.5\n66.79.143.229\n";
    const cron = new TorRefreshCron({ fetcher, torList: TorList });
    const result = await cron.run();
    expect(result.fetched).toBe(2);
    expect(TorList.isTorExit("185.220.101.5")).toBe(true);
    expect(TorList.isTorExit("66.79.143.229")).toBe(true);
  });

  it("ignores comments and blank lines", async () => {
    fetcher.response = "# Header comment\n\n185.220.101.5\n\n# Another comment\n66.79.143.229\n";
    const cron = new TorRefreshCron({ fetcher, torList: TorList });
    const result = await cron.run();
    expect(result.fetched).toBe(2);
  });

  it("replaces previous list (not appends)", async () => {
    TorList.loadFromText("1.1.1.1\n");
    expect(TorList.isTorExit("1.1.1.1")).toBe(true);

    fetcher.response = "2.2.2.2\n";
    const cron = new TorRefreshCron({ fetcher, torList: TorList });
    await cron.run();

    expect(TorList.isTorExit("1.1.1.1")).toBe(false);
    expect(TorList.isTorExit("2.2.2.2")).toBe(true);
    expect(TorList.size()).toBe(1);
  });

  it("handles empty response gracefully", async () => {
    fetcher.response = "";
    const cron = new TorRefreshCron({ fetcher, torList: TorList });
    const result = await cron.run();
    expect(result.fetched).toBe(0);
    expect(TorList.size()).toBe(0);
  });

  it("reports errors via the result (does NOT throw)", async () => {
    const failingFetcher: TorListFetcher = {
      fetch: async () => {
        throw new Error("Network error");
      },
    };
    const cron = new TorRefreshCron({ fetcher: failingFetcher, torList: TorList });
    const result = await cron.run();
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Network error");
    expect(result.fetched).toBe(0);
  });

  it("logs the load timestamp", async () => {
    fetcher.response = "1.1.1.1\n";
    const cron = new TorRefreshCron({ fetcher, torList: TorList, now: () => new Date("2026-06-26T04:00:00Z") });
    const result = await cron.run();
    expect(result.loadedAt).toBe("2026-06-26T04:00:00.000Z");
    expect(TorList.getLoadedAt()?.toISOString()).toBe("2026-06-26T04:00:00.000Z");
  });
});