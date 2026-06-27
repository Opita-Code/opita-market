/**
 * SSRF guard — validates URLs against SSRF (Server-Side Request Forgery) attacks.
 *
 * Closes OPL-LIB-004, OPL-CARD-009.
 *
 * This is a STATIC check — it does NOT perform DNS resolution. For full
 * SSRF protection against DNS rebinding, the caller MUST also resolve the
 * hostname and re-check the resolved IP before fetching.
 *
 * Blocked:
 *   - Schemes other than http/https (file://, javascript:, data:, ftp://, vbscript:, etc.)
 *   - IPv4 private ranges (10/8, 172.16/12, 192.168/16, 169.254/16, etc.)
 *   - IPv4 loopback (127/8, localhost, broadcasthost, 0.0.0.0)
 *   - IPv4 CGNAT (100.64/10)
 *   - IPv4 documentation/reserved (192.0.0/24, 192.0.2/24, 198.51.100/24,
 *     203.0.113/24, 198.18/15, 240/4)
 *   - IPv6 loopback (::1), link-local (fe80::/10), private (fc00::/7)
 *   - IPv4-mapped IPv6 (::ffff:10.0.0.1)
 *
 * Allowed:
 *   - http:// and https:// schemes only
 *   - Public IPv4 addresses (1.0.0.0/8 - 223.255.255.255 minus blocked ranges)
 *   - Public IPv6 addresses (2000::/3)
 *   - Public hostnames (DNS not resolved here — caller responsibility)
 */

import { URL } from "node:url";

export interface SsrfCheckResult {
  safe: boolean;
  reason?: string;
}

/** Schemes allowed in URLs (defense in depth). */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Check if a URL is safe from SSRF attacks (static check).
 *
 * Returns { safe: true } if the URL passes all checks.
 * Returns { safe: false, reason: "..." } otherwise.
 */
export function isSafeUrl(input: string): SsrfCheckResult {
  // Empty check
  if (!input || input.length === 0) {
    return { safe: false, reason: "empty URL" };
  }

  // Parse URL
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { safe: false, reason: "unable to parse URL" };
  }

  // Scheme check FIRST (file://, javascript:, etc. — before host check)
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { safe: false, reason: `disallowed scheme: ${url.protocol}` };
  }

  // Host must be present
  if (!url.hostname || url.hostname.length === 0) {
    return { safe: false, reason: "missing host" };
  }

  // Hostname-based blocklist (case-insensitive)
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "broadcasthost" ||
    hostname === "ip6-localhost" ||
    hostname === "ip6-loopback"
  ) {
    return { safe: false, reason: `blocked hostname: ${hostname}` };
  }

  // Strip IPv6 brackets if present (Node URL strips them, but be safe)
  const cleanHost = hostname.replace(/^\[|\]$/g, "");

  // Check if it's an IP literal
  if (isIpv4(cleanHost)) {
    return checkIpv4(cleanHost);
  }
  if (isIpv6(cleanHost)) {
    return checkIpv6(cleanHost);
  }

  // It's a domain name — assume safe (caller MUST do DNS resolution + re-check)
  return { safe: true };
}

// ─── IPv4 helpers ────────────────────────────────────────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(s: string): boolean {
  return IPV4_RE.test(s);
}

function ipv4ToInt(s: string): number {
  const m = s.match(IPV4_RE);
  if (!m) return -1;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return -1;
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  const c = octets[2] ?? 0;
  const d = octets[3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

interface Ipv4Range {
  start: number;
  end: number;
  name: string;
}

function ipv4InRange(ip: number, ranges: Ipv4Range[]): string | null {
  for (const r of ranges) {
    if (ip >= r.start && ip <= r.end) return r.name;
  }
  return null;
}

function cidrToRange(cidr: string): Ipv4Range {
  const [base, prefixStr] = cidr.split("/");
  if (!base || !prefixStr) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    start: (ipInt & mask) >>> 0,
    end: (ipInt | (~mask >>> 0)) >>> 0,
    name: cidr,
  };
}

const IPV4_BLOCKED_RANGES: Ipv4Range[] = [
  cidrToRange("0.0.0.0/8"),        // current network
  cidrToRange("10.0.0.0/8"),       // private (Class A)
  cidrToRange("100.64.0.0/10"),    // CGNAT
  cidrToRange("127.0.0.0/8"),      // loopback
  cidrToRange("169.254.0.0/16"),   // link-local (AWS IMDS)
  cidrToRange("172.16.0.0/12"),    // private (Class B)
  cidrToRange("192.0.0.0/24"),     // IETF protocol
  cidrToRange("192.0.2.0/24"),     // TEST-NET-1
  cidrToRange("192.168.0.0/16"),   // private (Class C)
  cidrToRange("198.18.0.0/15"),    // benchmark testing
  cidrToRange("198.51.100.0/24"),  // TEST-NET-2
  cidrToRange("203.0.113.0/24"),   // TEST-NET-3
  cidrToRange("240.0.0.0/4"),      // reserved
  cidrToRange("255.255.255.255/32"), // broadcast
];

function checkIpv4(ip: string): SsrfCheckResult {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === -1) return { safe: false, reason: "invalid IPv4" };
  const blocked = ipv4InRange(ipInt, IPV4_BLOCKED_RANGES);
  if (blocked) return { safe: false, reason: `blocked IPv4 range: ${blocked}` };
  return { safe: true };
}

// ─── IPv6 helpers ────────────────────────────────────────────────────────────

function isIpv6(s: string): boolean {
  // IPv6 with optional zone (e.g., fe80::1%eth0) — simplified: zone not allowed in URLs
  return s.includes(":");
}

function checkIpv6(ip: string): SsrfCheckResult {
  const lower = ip.toLowerCase();

  // Loopback ::1 (and :: which is also loopback per RFC 4291 §2.5.2)
  if (lower === "::1" || lower === "::") {
    return { safe: false, reason: `blocked IPv6: ${lower}` };
  }

  // Link-local fe80::/10
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) {
    return { safe: false, reason: "blocked IPv6 link-local: fe80::/10" };
  }

  // Private fc00::/7 (fc00-fdff)
  if (lower.length >= 2) {
    const firstByteHex = lower.substring(0, 2);
    const firstByte = parseInt(firstByteHex, 16);
    if (!isNaN(firstByte) && (firstByte & 0xfe) === 0xfc) {
      return { safe: false, reason: "blocked IPv6 private: fc00::/7" };
    }
  }

  // IPv4-mapped IPv6: ::ffff:x.x.x.x — strip and recheck IPv4
  // Match any ::ffff:xxxx:xxxx form (Node URL may compress)
  const ipv4Mapped = lower.match(/^::ffff:([\da-f:.]+)$/);
  if (ipv4Mapped && ipv4Mapped[1]) {
    const tail = ipv4Mapped[1];
    // Convert IPv4-in-IPv6 hex form (e.g., "a00:1" for 10.0.0.1) to dotted form
    // Or extract from mixed notation
    const dottedMatch = tail.match(/^([\d.]+)$/);
    if (dottedMatch && dottedMatch[1]) {
      const ipv4Result = checkIpv4(dottedMatch[1]);
      if (!ipv4Result.safe) {
        return { safe: false, reason: `IPv4-mapped IPv6 to ${ipv4Result.reason}` };
      }
    } else {
      // Try hex form (e.g., "a00:0001")
      const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hexMatch && hexMatch[1] && hexMatch[2]) {
        const high = parseInt(hexMatch[1], 16);
        const low = parseInt(hexMatch[2], 16);
        const a = (high >> 8) & 0xff;
        const b = high & 0xff;
        const c = (low >> 8) & 0xff;
        const d = low & 0xff;
        const dotted = `${a}.${b}.${c}.${d}`;
        const ipv4Result = checkIpv4(dotted);
        if (!ipv4Result.safe) {
          return { safe: false, reason: `IPv4-mapped IPv6 to ${ipv4Result.reason}` };
        }
      }
    }
  }

  // ::ffff:0:0/96 (IPv4-compatible — deprecated)
  if (lower.startsWith("::ffff:0.") || lower === "::ffff:0:0") {
    return { safe: false, reason: "blocked IPv4-compatible IPv6 (::/96)" };
  }

  return { safe: true };
}
