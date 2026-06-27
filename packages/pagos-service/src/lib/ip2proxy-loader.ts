/**
 * IP2Proxy LITE PX2 binary loader.
 *
 * The PX2 binary (~5 MB) is bundled into the Lambda Layer at
 * `/opt/data/IP2Proxy-PX2.BIN` (set up by scripts/download-geoip-databases.ts
 * in PR 3 and the Lambda Layer bundling in PR 6).
 *
 * Loaded ONCE at process start, kept in memory, queried via `lookup()` for
 * each IP. This avoids repeated disk I/O.
 *
 * PROVIDES:
 *   - `lookup(ip)` → { isProxy, isVpn, isTor, isDatacenter, proxyType, asn }
 *   - `isLoaded()` → boolean
 *   - `unload()` → release engine (e.g., for hot-reload during cron updates)
 *
 * SECURITY:
 *   - The PX2 binary contains IP-to-proxy mappings, which we treat as PUBLIC OSINT.
 *   - No PII in the binary; safe to log.
 */

import {
  createIP2ProxyEngine,
  type IP2ProxyEngineInstance,
} from "./ip2proxy-engine.js";

export interface IP2ProxyResult {
  ip: string;
  isProxy: boolean;
  isVpn: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  proxyType: string;
  asn: number;
  isp: string;
}

const DEFAULT_BIN_PATH = "/opt/data/IP2Proxy-PX2.BIN";

/**
 * Factory function type — accepts a path, returns an engine.
 * Injectable for testing (pass a vi.fn() that returns a fake engine).
 */
export type IP2ProxyEngineFactory = (path: string) => Promise<IP2ProxyEngineInstance>;

export class IP2ProxyLoader {
  private engine: IP2ProxyEngineInstance | null = null;
  private loadedAt: Date | null = null;
  private readonly binPath: string;
  private readonly factory: IP2ProxyEngineFactory;

  constructor(
    binPath: string = DEFAULT_BIN_PATH,
    factory: IP2ProxyEngineFactory = createIP2ProxyEngine,
  ) {
    this.binPath = binPath;
    this.factory = factory;
  }

  /** Lazily load the binary. Idempotent — reloading is a no-op. */
  async load(): Promise<void> {
    if (this.engine) return;
    this.engine = await this.factory(this.binPath);
    this.loadedAt = new Date();
  }

  /** Release the engine reference. */
  unload(): void {
    this.engine = null;
    this.loadedAt = null;
  }

  /** Whether the engine is loaded and ready. */
  isLoaded(): boolean {
    return this.engine !== null;
  }

  /** The configured path to the PX2 binary. */
  getPath(): string {
    return this.binPath;
  }

  /** When the binary was last loaded (or null if not yet loaded). */
  getLoadedAt(): Date | null {
    return this.loadedAt;
  }

  /**
   * Look up an IP in the PX2 database.
   * Returns null if engine not loaded OR IP not in database.
   */
  lookup(ip: string): IP2ProxyResult | null {
    if (!ip) return null;
    if (!this.engine) return null;
    const raw = this.engine.getAll(ip);
    if (!raw) return null;

    const proxyType = (raw.proxyType || "-").toUpperCase();
    const usageType = (raw.usageType || "-").toUpperCase();
    return {
      ip,
      isProxy: raw.isProxy === 1,
      isVpn: proxyType === "VPN",
      isTor: proxyType === "TOR",
      // Datacenter heuristic: usageType indicates hosting provider (BUT not when
      // proxyType is VPN — VPN can run on residential IPs too, so it's ambiguous).
      isDatacenter:
        proxyType !== "VPN" && (
          proxyType === "DCH" ||
          proxyType === "WEB" ||
          proxyType === "SES" ||
          usageType === "DCH" ||
          usageType === "WEB" ||
          usageType === "SES"
        ),
      proxyType,
      asn: raw.asn || 0,
      isp: raw.isp || "-",
    };
  }
}