/**
 * Mock-friendly IP2Proxy engine wrapper.
 *
 * In production, this dynamically imports the real `ip2proxy-nodejs` package
 * and wraps it. In tests, this module is mocked via vi.mock().
 *
 * The interface mirrors `ip2proxy-nodejs`'s IP2Proxy class but is decoupled
 * so we can mock it cleanly.
 */

export interface IP2ProxyEngineResult {
  isProxy: number;          // 0 or 1
  proxyType: string;        // "PUB" | "VPN" | "TOR" | "DCH" | "-" | ...
  countryCode: string;
  regionName: string;
  cityName: string;
  isp: string;
  domain: string;
  usageType: string;
  asn: number;
  asName: string;
  lastSeen: string;
  threat: string;
}

export interface IP2ProxyEngineInstance {
  getAll(ip: string): IP2ProxyEngineResult | null;
}

/** Dynamic import wrapper — keeps native binding out of test-time loads. */
export async function createIP2ProxyEngine(binPath: string): Promise<IP2ProxyEngineInstance> {
  const mod = await import("ip2proxy-nodejs");
  // The upstream package default-exports a class IP2Proxy (camelCase).
  // We instantiate it and adapt getAll() to our interface.
  const IP2ProxyCtor = (mod as unknown as { IP2Proxy: new (path: string) => { getAll: (ip: string) => IP2ProxyEngineResult | null } }).IP2Proxy;
  const instance = new IP2ProxyCtor(binPath);
  return {
    getAll: (ip: string) => instance.getAll(ip),
  };
}