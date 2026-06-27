# Spec: ip-geolocation

## Purpose
Provide IP-based geolocation, ASN lookup, and threat detection (Tor/VPN/proxy/datacenter) for the anti-fraud engine. Self-hosted, $0/month, with a 7-day TTL cache to stay within free-tier API limits.

## Requirements

### Requirement: Lookup Chain Order

The system MUST attempt lookups in this order, returning the first hit:

1. DynamoDB cache (`IpGeoCache` table, TTL 7d)
2. MaxMind GeoLite2 (self-hosted `.mmdb` in Lambda Layer)
3. IP2Proxy LITE PX2 (self-hosted `.bin` in Lambda Layer)
4. RIPEstat (existing `dark-recon` MCP / direct API)
5. AbuseIPDB (only if `flagged=true` from earlier signals)
6. Team Cymru DNS (last fallback, ASN only)

#### Scenario: Cache hit returns instantly
- GIVEN `IpGeoCache` has a row for IP `1.2.3.4` with TTL not expired
- WHEN `lookupIp("1.2.3.4")` is called
- THEN the system MUST return the cached result
- AND MUST NOT call MaxMind or any external service

#### Scenario: Cache miss falls through to MaxMind
- GIVEN `IpGeoCache` has no row for IP `5.6.7.8`
- WHEN `lookupIp("5.6.7.8")` is called
- THEN the system MUST query MaxMind GeoLite2
- AND MUST write the result to `IpGeoCache` with TTL 7 days

#### Scenario: All sources exhausted
- GIVEN no source returns a result for IP `9.9.9.9`
- WHEN `lookupIp("9.9.9.9")` is called
- THEN the system MUST return `{country: "unknown", asn: null, is_proxy: false, is_vpn: false, is_tor: false, confidence: 0}`

### Requirement: Tor Detection

The system MUST detect Tor exit relays by checking the official `torproject.org` bulk list.

#### Scenario: Known Tor exit flagged
- GIVEN IP `185.220.101.5` is in the current Tor exit list
- WHEN `lookupIp` is called
- THEN the response MUST include `is_tor: true`

#### Scenario: Tor list refreshed daily
- GIVEN the Tor exit list cache is older than 24 hours
- WHEN the daily cron runs
- THEN the cache MUST be refreshed from `https://check.torproject.org/torbulkexitlist`

### Requirement: VPN / Proxy / Datacenter Detection

The system MUST detect anonymous proxies and datacenter IPs via IP2Proxy LITE.

#### Scenario: Public proxy flagged
- GIVEN IP `66.79.143.229` is in IP2Proxy LITE PX2 with proxy_type="PUB"
- WHEN `lookupIp` is called
- THEN `is_proxy: true` MUST be returned

#### Scenario: AWS datacenter IP flagged
- GIVEN IP `52.94.0.1` (AWS range) is in IP2Proxy LITE PX2 with proxy_type="DCH"
- WHEN `lookupIp` is called
- THEN `is_datacenter: true` MUST be returned

### Requirement: Cost Cap (Free Tier)

The system MUST stay within AbuseIPDB's free-tier limit (1,000 checks/day).

#### Scenario: AbuseIPDB skipped under normal load
- GIVEN the daily AbuseIPDB counter is below 1000
- AND a request does NOT trigger any suspicious signal
- WHEN `lookupIp` is called
- THEN AbuseIPDB MUST NOT be queried

#### Scenario: AbuseIPDB queried only when flagged
- GIVEN a request triggers a `VPN_DETECTED` signal
- WHEN `lookupIp` is called
- THEN AbuseIPDB MUST be queried to enrich the result
- AND the daily counter MUST increment

### Requirement: Privacy Preservation

The system MUST NOT log full IP addresses to dark-mem or any persistent memory outside `IpGeoCache`.

#### Scenario: IP appears only in IpGeoCache
- GIVEN any IP lookup completes
- WHEN the system writes audit logs
- THEN the IP MUST be hashed (SHA-256, first 16 chars) before logging
- AND the full IP MUST only exist in `IpGeoCache` (TTL 7d)

## Files
- `packages/pagos-service/src/lib/ip-geolocation.ts`
- `packages/pagos-service/src/lib/maxmind-loader.ts`
- `packages/pagos-service/src/lib/ip2proxy-loader.ts`
- `sst.config.ts` (Lambda Layer: `GeoIpLayer`)
- `packages/pagos-service/tests/unit/ip-geolocation.test.ts`
- `packages/pagos-service/tests/integration/ip-cache-ttl.test.ts`