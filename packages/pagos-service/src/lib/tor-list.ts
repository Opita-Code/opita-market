/**
 * In-memory Tor exit relay list.
 *
 * Source: https://check.torproject.org/torbulkexitlist (one IP per line).
 * Refreshed daily by cron (see PR 5).
 *
 * This is a STATIC lookup table — no external network calls during runtime.
 * The list is loaded at app boot from a local file or DynamoDB cache, then
 * kept in memory for fast O(1) checks.
 *
 * Storage:
 *   - Local dev: loaded from local file `data/tor-exit-list.txt`
 *   - Lambda: loaded from DynamoDB cache (refreshed by cron)
 *
 * USAGE:
 *   await TorList.load();              // at app boot
 *   TorList.isTorExit("185.220.101.5"); // O(1) lookup
 */

/** Simple IPv4 + IPv6 validator (RFC 791 / RFC 4291) — strict enough for our purposes. */
function isValidIp(ip: string): boolean {
  if (!ip || ip.length === 0 || ip.length > 45) return false;

  // IPv4
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      if (!/^\d+$/.test(p)) return false;
      const n = parseInt(p, 10);
      return n >= 0 && n <= 255;
    });
  }

  // IPv6 (basic check — at least 2 colons, hex digits + colons only, max 8 groups)
  if (ip.includes(":")) {
    if (ip.includes("::")) {
      // compressed form — basic structural check
      return /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(ip);
    }
    const parts = ip.split(":");
    if (parts.length !== 8) return false;
    return parts.every((p) => /^[0-9a-fA-F]{1,4}$/.test(p));
  }

  return false;
}

class TorListClass {
  private ips: Set<string> = new Set();
  private loadedAt: Date | null = null;

  /** Replace the in-memory list with IPs parsed from text (one per line). */
  loadFromText(text: string): void {
    const newSet = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith("#")) continue; // comment
      if (!isValidIp(trimmed)) continue;
      newSet.add(trimmed.toLowerCase());
    }
    this.ips = newSet;
    this.loadedAt = new Date();
  }

  /** Reset to empty (for tests + cron re-runs). */
  reset(): void {
    this.ips = new Set();
    this.loadedAt = null;
  }

  /** Returns true if `ip` is a known Tor exit relay. */
  isTorExit(ip: string): boolean {
    if (!ip) return false;
    return this.ips.has(ip.toLowerCase());
  }

  /** Number of IPs in the list. */
  size(): number {
    return this.ips.size;
  }

  /** When the list was last loaded (or null). */
  getLoadedAt(): Date | null {
    return this.loadedAt;
  }
}

/** Singleton — one TorList per process. */
export const TorList = new TorListClass();