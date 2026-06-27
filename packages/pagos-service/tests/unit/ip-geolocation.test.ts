import { describe, it, expect, beforeEach, vi } from "vitest";
import { IpGeolocation, type IpGeoResult, type IpGeoFetcher, type GeoCacheStore } from "../../src/lib/ip-geolocation.js";
import { IP2ProxyLoader } from "../../src/lib/ip2proxy-loader.js";
import { TorList } from "../../src/lib/tor-list.js";

/**
 * Tests for the IP geolocation lookup chain.
 *
 * Order:
 *   1. DynamoDB cache (TTL 7d) → if hit, return immediately
 *   2. Parallel: IP-API.com (HTTP) + IP2Proxy (Lambda Layer) + Tor list
 *   3. Combine results into IpGeoResult
 *   4. Write to cache (TTL 7d)
 *
 * Privacy: full IP must NEVER be logged. Cache returns from in-memory mock here.
 */

function makeCacheStore(initial: Map<string, IpGeoResult> = new Map()): GeoCacheStore {
  return {
    get: vi.fn(async (ip: string) => initial.get(ip) ?? null),
    put: vi.fn(async (ip: string, result: IpGeoResult, ttlSeconds: number) => {
      initial.set(ip, result);
    }),
    delete: vi.fn(async (ip: string) => {
      initial.delete(ip);
    }),
  };
}

function makeFetcher(result: Partial<IpGeoResult>): IpGeoFetcher {
  return {
    fetch: vi.fn(async (ip: string) => ({
      country_iso: result.country_iso ?? "US",
      country_name: result.country_name ?? "United States",
      region: result.region ?? "California",
      city: result.city ?? "Mountain View",
      postal_code: result.postal_code,
      latitude: result.latitude ?? 37.386,
      longitude: result.longitude ?? -122.0838,
      asn: result.asn ?? 15169,
      asn_org: result.asn_org ?? "Google",
      isp: result.isp ?? "Google",
      confidence: result.confidence ?? 0.95,
      source: result.source ?? "IP_API",
    })),
  };
}

describe("ip-geolocation — lookup chain", () => {
  beforeEach(() => {
    TorList.reset();
  });

  describe("cache hit", () => {
    it("returns cached result without calling external fetchers", async () => {
      const cached: IpGeoResult = {
        ip: "8.8.8.8",
        country_iso: "US",
        country_name: "United States",
        region: "California",
        city: "Mountain View",
        asn: 15169,
        asn_org: "Google",
        isp: "Google",
        is_proxy: false,
        is_vpn: false,
        is_tor: false,
        is_datacenter: true,
        is_mobile: false,
        confidence: 0.95,
        source: "IP_API",
      };
      const cache = makeCacheStore(new Map([["8.8.8.8", cached]]));
      const fetcher = makeFetcher({});
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue(null),
      }));

      const geo = new IpGeolocation({
        cache,
        fetcher,
        ip2proxy,
        torList: TorList,
      });
      const result = await geo.lookup("8.8.8.8");

      expect(result).toEqual(cached);
      expect(fetcher.fetch).not.toHaveBeenCalled();
    });

    it("cache hit respects cached `is_tor` flag (does NOT re-consult TorList)", async () => {
      // Even if TorList is populated, cached is_tor should win.
      TorList.loadFromText("8.8.8.8\n");
      const cached: IpGeoResult = {
        ip: "8.8.8.8",
        country_iso: "US",
        country_name: "United States",
        region: "California",
        city: "Mountain View",
        asn: 15169,
        asn_org: "Google",
        isp: "Google",
        is_proxy: false,
        is_vpn: false,
        is_tor: false, // cached says NOT tor
        is_datacenter: true,
        is_mobile: false,
        confidence: 0.95,
        source: "IP_API",
      };
      const cache = makeCacheStore(new Map([["8.8.8.8", cached]]));
      const fetcher = makeFetcher({});
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue(null),
      }));

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      const result = await geo.lookup("8.8.8.8");

      expect(result?.is_tor).toBe(false); // cached value, not TorList
    });
  });

  describe("cache miss → fetcher + IP2Proxy + Tor combined", () => {
    it("combines IP-API + IP2Proxy + Tor into single result", async () => {
      TorList.loadFromText("185.220.101.5\n");
      const cache = makeCacheStore();
      const fetcher = makeFetcher({ country_iso: "DE", region: "-", city: "-" });
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue({
          isProxy: 1,
          proxyType: "TOR",
          countryCode: "DE",
          regionName: "-",
          cityName: "-",
          isp: "-",
          domain: "-",
          usageType: "TOR",
          asn: 0,
          asName: "-",
          lastSeen: "-",
          threat: "-",
        }),
      }));
      await ip2proxy.load();

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      const result = await geo.lookup("185.220.101.5");

      expect(result).toMatchObject({
        ip: "185.220.101.5",
        country_iso: "DE",
        is_proxy: true,
        is_vpn: false,
        is_tor: true, // ← from BOTH IP2Proxy AND TorList
        is_datacenter: false,
      });
    });

    it("IP2Proxy VPN is detected", async () => {
      const cache = makeCacheStore();
      const fetcher = makeFetcher({ country_iso: "US" });
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue({
          isProxy: 1,
          proxyType: "VPN",
          countryCode: "US",
          regionName: "Virginia",
          cityName: "Ashburn",
          isp: "AWS",
          domain: "aws.amazon.com",
          usageType: "DCH",
          asn: 16509,
          asName: "AMAZON-02",
          lastSeen: "-",
          threat: "-",
        }),
      }));
      await ip2proxy.load();

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      const result = await geo.lookup("3.5.140.1");

      expect(result?.is_vpn).toBe(true);
      expect(result?.is_proxy).toBe(true);
    });

    it("residential Colombian IP returns is_proxy=false", async () => {
      const cache = makeCacheStore();
      const fetcher = makeFetcher({
        country_iso: "CO",
        region: "Huila",
        city: "Neiva",
        isp: "Claro Colombia",
      });
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue({
          isProxy: 0,
          proxyType: "-",
          countryCode: "CO",
          regionName: "Huila",
          cityName: "Neiva",
          isp: "Claro Colombia",
          domain: "claro.com.co",
          usageType: "ISP",
          asn: 10620,
          asName: "Telmex",
          lastSeen: "-",
          threat: "-",
        }),
      }));
      await ip2proxy.load();

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      const result = await geo.lookup("191.95.0.1");

      expect(result).toMatchObject({
        ip: "191.95.0.1",
        country_iso: "CO",
        region: "Huila",
        city: "Neiva",
        is_proxy: false,
        is_vpn: false,
        is_tor: false,
        is_datacenter: false,
        is_mobile: true, // Claro Colombia is mobile ISP
      });
    });
  });

  describe("cache write after lookup", () => {
    it("writes result to cache after fetch", async () => {
      const cache = makeCacheStore();
      const fetcher = makeFetcher({ country_iso: "US" });
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue(null),
      }));
      await ip2proxy.load();

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      await geo.lookup("8.8.8.8");

      expect(cache.put).toHaveBeenCalledTimes(1);
      const [ip, result, ttl] = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(ip).toBe("8.8.8.8");
      expect(result.ip).toBe("8.8.8.8");
      // TTL should be 7 days = 604800 seconds
      expect(ttl).toBe(7 * 24 * 60 * 60);
    });
  });

  describe("fallback when IP-API fails", () => {
    it("returns IP2Proxy-only result when fetcher throws", async () => {
      const cache = makeCacheStore();
      const fetcher: IpGeoFetcher = {
        fetch: vi.fn(async () => {
          throw new Error("IP-API.com unavailable");
        }),
      };
      const ip2proxy = new IP2ProxyLoader("/dev/null", async () => ({
        getAll: vi.fn().mockReturnValue({
          isProxy: 1,
          proxyType: "PUB",
          countryCode: "US",
          regionName: "-",
          cityName: "-",
          isp: "-",
          domain: "-",
          usageType: "DCH",
          asn: 15169,
          asName: "GOOGLE",
          lastSeen: "-",
          threat: "-",
        }),
      }));
      await ip2proxy.load();

      const geo = new IpGeolocation({ cache, fetcher, ip2proxy, torList: TorList });
      const result = await geo.lookup("8.8.8.8");

      // We should still get is_proxy/is_tor/etc. from IP2Proxy, just no country
      expect(result?.is_proxy).toBe(true);
      expect(result?.country_iso).toBe(""); // empty when fetcher fails
    });
  });

  describe("empty / invalid IP", () => {
    it("returns null for empty IP", async () => {
      const geo = new IpGeolocation({
        cache: makeCacheStore(),
        fetcher: makeFetcher({}),
        ip2proxy: new IP2ProxyLoader("/dev/null", async () => ({
          getAll: vi.fn().mockReturnValue(null),
        })),
        torList: TorList,
      });
      const result = await geo.lookup("");
      expect(result).toBeNull();
    });

    it("returns null for malformed IP", async () => {
      const geo = new IpGeolocation({
        cache: makeCacheStore(),
        fetcher: makeFetcher({}),
        ip2proxy: new IP2ProxyLoader("/dev/null", async () => ({
          getAll: vi.fn().mockReturnValue(null),
        })),
        torList: TorList,
      });
      const result = await geo.lookup("not-an-ip");
      expect(result).toBeNull();
    });
  });
});