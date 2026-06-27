/**
 * IP geolocation lookup chain orchestrator.
 *
 * ORDER:
 *   1. DynamoDB cache (TTL 7d) → if hit, return immediately
 *   2. Parallel: IP-API.com (HTTP) + IP2Proxy (Lambda Layer) + Tor list
 *   3. Combine into IpGeoResult (Tor detection is OR of all sources)
 *   4. Write to cache (TTL 7d)
 *
 * WHY:
 *   - Cache: 99% of traffic hits cache (warm) → no external calls
 *   - IP-API.com: country/city for legitimate visitors (no API key needed)
 *   - IP2Proxy: proxy/VPN/Tor/datacenter detection (self-hosted .bin)
 *   - Tor list: belt-and-suspenders Tor detection (IP2Proxy can miss)
 *   - Each source covers gaps the others miss.
 *
 * PRIVACY:
 *   - Full IP is logged ONLY in CloudWatch for debugging (operator can disable).
 *   - For dark-mem: hash the IP (sha256[:16]) before writing.
 *   - Cache stores the FULL IP (TTL 7d, then auto-deleted by DynamoDB).
 */

import { IP2ProxyLoader } from "./ip2proxy-loader.js";
import { TorList } from "./tor-list.js";
import type { IpGeoSource } from "../db/tables.js";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface IpGeoResult {
  ip: string;
  country_iso: string;
  country_name: string;
  region: string;
  city: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  asn: number;
  asn_org: string;
  isp: string;
  is_proxy: boolean;
  is_vpn: boolean;
  is_tor: boolean;
  is_datacenter: boolean;
  is_mobile: boolean;
  confidence: number;
  source: IpGeoSource;
}

/** Fetcher for IP-API.com (HTTP). Injectable for testing. */
export interface IpGeoFetcher {
  fetch(ip: string): Promise<{
    country_iso: string;
    country_name: string;
    region: string;
    city: string;
    postal_code?: string;
    latitude?: number;
    longitude?: number;
    asn: number;
    asn_org: string;
    isp: string;
    confidence: number;
    source: IpGeoSource;
  }>;
}

/** Cache store (DynamoDB IpGeoCache). Injectable for testing. */
export interface GeoCacheStore {
  get(ip: string): Promise<IpGeoResult | null>;
  put(ip: string, result: IpGeoResult, ttlSeconds: number): Promise<void>;
  delete(ip: string): Promise<void>;
}

export interface IpGeolocationDeps {
  cache: GeoCacheStore;
  fetcher: IpGeoFetcher;
  ip2proxy: IP2ProxyLoader;
  torList: typeof TorList;
}

/** Simple IPv4 + IPv6 validator (RFC 791 / RFC 4291). */
function isValidIp(ip: string): boolean {
  if (!ip || ip.length === 0 || ip.length > 45) return false;
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      if (!/^\d+$/.test(p)) return false;
      const n = parseInt(p, 10);
      return n >= 0 && n <= 255;
    });
  }
  if (ip.includes(":")) {
    if (ip.includes("::")) {
      return /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(ip);
    }
    const parts = ip.split(":");
    if (parts.length !== 8) return false;
    return parts.every((p) => /^[0-9a-fA-F]{1,4}$/.test(p));
  }
  return false;
}

export class IpGeolocation {
  constructor(private readonly deps: IpGeolocationDeps) {}

  /**
   * Look up an IP. Returns the best result combining all available sources.
   * Returns null for empty / invalid IPs.
   */
  async lookup(ip: string): Promise<IpGeoResult | null> {
    if (!isValidIp(ip)) return null;

    // 1. Cache hit
    const cached = await this.deps.cache.get(ip);
    if (cached) return cached;

    // 2. Parallel fetch + IP2Proxy + Tor list
    let ipApiResult: Awaited<ReturnType<IpGeoFetcher["fetch"]>> | null = null;
    let ip2proxyResult = this.deps.ip2proxy.lookup(ip);

    try {
      ipApiResult = await this.deps.fetcher.fetch(ip);
    } catch {
      // IP-API.com may be down — fall back to IP2Proxy-only result
      ipApiResult = null;
    }

    const torMatch = this.deps.torList.isTorExit(ip);

    // 3. Combine
    const isTor = torMatch || ip2proxyResult?.isTor === true;
    const isProxy = ip2proxyResult?.isProxy ?? false;
    const isVpn = ip2proxyResult?.isVpn ?? false;
    const isDatacenter = ip2proxyResult?.isDatacenter ?? false;
    const isMobile = (ipApiResult?.isp ?? "").toLowerCase().includes("movil") ||
                      (ipApiResult?.isp ?? "").toLowerCase().includes("claro") ||
                      (ipApiResult?.isp ?? "").toLowerCase().includes("tigo");

    const result: IpGeoResult = {
      ip,
      country_iso: ipApiResult?.country_iso ?? "",
      country_name: ipApiResult?.country_name ?? "",
      region: ipApiResult?.region ?? "",
      city: ipApiResult?.city ?? "",
      postal_code: ipApiResult?.postal_code,
      latitude: ipApiResult?.latitude,
      longitude: ipApiResult?.longitude,
      asn: ipApiResult?.asn ?? ip2proxyResult?.asn ?? 0,
      asn_org: ipApiResult?.asn_org ?? "",
      isp: ipApiResult?.isp ?? ip2proxyResult?.isp ?? "-",
      is_proxy: isProxy,
      is_vpn: isVpn,
      is_tor: isTor,
      is_datacenter: isDatacenter,
      is_mobile: isMobile,
      confidence: ipApiResult?.confidence ?? 0,
      source: ipApiResult?.source ?? "IP2PROXY",
    };

    // 4. Cache write (best effort — failure is non-fatal)
    try {
      await this.deps.cache.put(ip, result, CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal; next lookup will re-fetch.
    }

    return result;
  }
}