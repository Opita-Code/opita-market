import { describe, it, expect, beforeEach, vi } from "vitest";
import { IP2ProxyLoader, type IP2ProxyResult } from "../../src/lib/ip2proxy-loader.js";
import type { IP2ProxyEngineInstance, IP2ProxyEngineResult } from "../../src/lib/ip2proxy-engine.js";

/**
 * Tests for IP2Proxy loader — proxy/VPN/Tor/datacenter detection from
 * IP2Proxy LITE PX2 binary file.
 *
 * The actual IP2Proxy native binding is replaced with a fake engine injected
 * via the factory function (dependency injection). No vi.mock() needed.
 */

function makeFakeEngine(getAllResult: IP2ProxyEngineResult | null): IP2ProxyEngineInstance {
  return {
    getAll: vi.fn().mockReturnValue(getAllResult),
  };
}

function makeFakeFactory(engine: IP2ProxyEngineInstance) {
  return vi.fn().mockResolvedValue(engine);
}

describe("ip2proxy-loader — proxy/VPN/Tor/datacenter detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("initializes with default path", () => {
      const loader = new IP2ProxyLoader();
      expect(loader.getPath()).toBe("/opt/data/IP2Proxy-PX2.BIN");
    });

    it("initializes with custom path", () => {
      const loader = new IP2ProxyLoader("/custom/path/file.BIN");
      expect(loader.getPath()).toBe("/custom/path/file.BIN");
    });

    it("is not loaded initially", () => {
      const loader = new IP2ProxyLoader();
      expect(loader.isLoaded()).toBe(false);
    });
  });

  describe("lookup before load", () => {
    it("returns null result (not loaded)", () => {
      const loader = new IP2ProxyLoader();
      const result = loader.lookup("8.8.8.8");
      expect(result).toBeNull();
    });
  });

  describe("lookup after load", () => {
    it("returns proxy result when IP is in PX2 database", async () => {
      const engine = makeFakeEngine({
        isProxy: 1,
        proxyType: "PUB",
        countryCode: "US",
        regionName: "California",
        cityName: "Mountain View",
        isp: "Google",
        domain: "google.com",
        usageType: "DCH",
        asn: 15169,
        asName: "GOOGLE",
        lastSeen: "2025-01-15",
        threat: "SPAM",
      });
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();

      const result = loader.lookup("8.8.8.8");
      expect(result).toMatchObject({
        ip: "8.8.8.8",
        isProxy: true,
        isVpn: false,
        isTor: false,
        isDatacenter: true,
        proxyType: "PUB",
        asn: 15169,
      });
      expect(loader.isLoaded()).toBe(true);
    });

    it("returns non-proxy result for residential IP", async () => {
      const engine = makeFakeEngine({
        isProxy: 0,
        proxyType: "-",
        countryCode: "CO",
        regionName: "Huila",
        cityName: "Neiva",
        isp: "Claro Colombia",
        domain: "claro.com.co",
        usageType: "ISP",
        asn: 10620,
        asName: "Telmex Colombia",
        lastSeen: "-",
        threat: "-",
      });
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      const result = loader.lookup("191.95.0.1");

      expect(result).toMatchObject({
        isProxy: false,
        isVpn: false,
        isTor: false,
        isDatacenter: false,
        proxyType: "-",
      });
    });

    it("classifies VPN proxy correctly (proxyType='VPN')", async () => {
      const engine = makeFakeEngine({
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
      });
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      const result = loader.lookup("3.5.140.1");
      expect(result?.isProxy).toBe(true);
      expect(result?.isVpn).toBe(true);
      expect(result?.proxyType).toBe("VPN");
      // Note: VPN is NOT automatically datacenter — could be residential VPN host.
      // isDatacenter is only true for proxyType ∈ {DCH, WEB, SES}.
      expect(result?.isDatacenter).toBe(false);
    });

    it("classifies Tor exit (proxyType='TOR')", async () => {
      const engine = makeFakeEngine({
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
      });
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      const result = loader.lookup("185.220.101.5");
      expect(result?.isTor).toBe(true);
      expect(result?.isProxy).toBe(true);
    });

    it("returns null for IP not in database (engine returns empty)", async () => {
      const engine = makeFakeEngine(null);
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      const result = loader.lookup("192.168.1.1");
      expect(result).toBeNull();
    });
  });

  describe("lookup caching", () => {
    it("reuses engine across lookups (load once, lookup many)", async () => {
      const engine = makeFakeEngine({
        isProxy: 0, proxyType: "-", countryCode: "CO",
        regionName: "-", cityName: "-", isp: "-", domain: "-",
        usageType: "ISP", asn: 0, asName: "-", lastSeen: "-", threat: "-",
      });
      const factory = makeFakeFactory(engine);
      const loader = new IP2ProxyLoader(undefined, factory);
      await loader.load();

      loader.lookup("1.1.1.1");
      loader.lookup("2.2.2.2");
      loader.lookup("3.3.3.3");

      expect(engine.getAll).toHaveBeenCalledTimes(3);
      // Factory called once
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("unload", () => {
    it("releases the engine reference", async () => {
      const engine = makeFakeEngine(null);
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      expect(loader.isLoaded()).toBe(true);
      loader.unload();
      expect(loader.isLoaded()).toBe(false);
    });

    it("subsequent lookup returns null", async () => {
      const engine = makeFakeEngine(null);
      const loader = new IP2ProxyLoader(undefined, makeFakeFactory(engine));
      await loader.load();
      loader.unload();
      expect(loader.lookup("1.1.1.1")).toBeNull();
    });
  });
});