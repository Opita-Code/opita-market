import { describe, it, expect } from "vitest";
import { isSafeUrl, type SsrfCheckResult } from "../../src/lib/ssrf-guard.js";

/**
 * Tests for SSRF guard (PR 2e — closes OPL-LIB-004, OPL-CARD-009).
 *
 * Spec: openspec/changes/pre-deploy-remediation/tasks.md PR 2e
 *
 * Blocked:
 *   - Non-HTTP(S) schemes: file://, javascript:, data:, ftp://, etc.
 *   - Internal/private IPs: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - Link-local: 169.254.0.0/16 (AWS IMDS lives here)
 *   - Loopback: 127.0.0.0/8, localhost, ::1
 *   - 0.0.0.0
 *   - IPv6 link-local fc00::/7
 *   - IPv4-mapped IPv6 ::ffff:10.0.0.1
 *
 * Allowed:
 *   - http:// and https:// only
 *   - Public IPs only (no internal)
 */

describe("ssrf-guard — scheme blocklist", () => {
  it("blocks file:// scheme", () => {
    const r = isSafeUrl("file:///etc/passwd");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("scheme");
  });

  it("blocks javascript: scheme", () => {
    const r = isSafeUrl("javascript:alert(1)");
    expect(r.safe).toBe(false);
  });

  it("blocks data: scheme", () => {
    const r = isSafeUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(r.safe).toBe(false);
  });

  it("blocks ftp:// scheme", () => {
    const r = isSafeUrl("ftp://internal.example.com/file.txt");
    expect(r.safe).toBe(false);
  });

  it("blocks vbscript: scheme", () => {
    const r = isSafeUrl("vbscript:msgbox(1)");
    expect(r.safe).toBe(false);
  });

  it("allows http://", () => {
    const r = isSafeUrl("http://example.com/photo.jpg");
    expect(r.safe).toBe(true);
  });

  it("allows https://", () => {
    const r = isSafeUrl("https://example.com/photo.jpg");
    expect(r.safe).toBe(true);
  });
});

describe("ssrf-guard — URL parsing", () => {
  it("rejects invalid URL syntax", () => {
    const r = isSafeUrl("not a url");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("parse");
  });

  it("rejects empty string", () => {
    const r = isSafeUrl("");
    expect(r.safe).toBe(false);
  });

  it("rejects URL without host (only scheme)", () => {
    const r = isSafeUrl("://invalid-url");
    expect(r.safe).toBe(false);
  });
});

describe("ssrf-guard — IPv4 private ranges blocklist", () => {
  it("blocks 10.0.0.0/8 (private)", () => {
    expect(isSafeUrl("http://10.0.0.1/foo").safe).toBe(false);
    expect(isSafeUrl("http://10.255.255.255/foo").safe).toBe(false);
  });

  it("blocks 172.16.0.0/12 (private)", () => {
    expect(isSafeUrl("http://172.16.0.1/foo").safe).toBe(false);
    expect(isSafeUrl("http://172.31.255.255/foo").safe).toBe(false);
  });

  it("blocks 192.168.0.0/16 (private)", () => {
    expect(isSafeUrl("http://192.168.1.1/foo").safe).toBe(false);
    expect(isSafeUrl("http://192.168.255.255/foo").safe).toBe(false);
  });

  it("blocks 169.254.0.0/16 (link-local, AWS IMDS)", () => {
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data/").safe).toBe(false);
  });

  it("blocks 127.0.0.0/8 (loopback)", () => {
    expect(isSafeUrl("http://127.0.0.1/foo").safe).toBe(false);
    expect(isSafeUrl("http://127.255.255.255/foo").safe).toBe(false);
  });

  it("blocks 0.0.0.0", () => {
    expect(isSafeUrl("http://0.0.0.0/foo").safe).toBe(false);
  });

  it("blocks 'localhost' hostname", () => {
    expect(isSafeUrl("http://localhost/foo").safe).toBe(false);
    expect(isSafeUrl("http://LOCALHOST/foo").safe).toBe(false); // case-insensitive
  });

  it("blocks 'broadcasthost'", () => {
    expect(isSafeUrl("http://broadcasthost/foo").safe).toBe(false);
  });

  it("blocks 100.64.0.0/10 (CGNAT)", () => {
    expect(isSafeUrl("http://100.64.0.1/foo").safe).toBe(false);
  });

  it("blocks 198.18.0.0/15 (benchmark testing)", () => {
    expect(isSafeUrl("http://198.18.0.1/foo").safe).toBe(false);
  });

  it("blocks 192.0.0.0/24 (IETF protocol)", () => {
    expect(isSafeUrl("http://192.0.0.1/foo").safe).toBe(false);
  });

  it("blocks 192.0.2.0/24 (TEST-NET-1 documentation)", () => {
    expect(isSafeUrl("http://192.0.2.1/foo").safe).toBe(false);
  });

  it("blocks 198.51.100.0/24 (TEST-NET-2)", () => {
    expect(isSafeUrl("http://198.51.100.1/foo").safe).toBe(false);
  });

  it("blocks 203.0.113.0/24 (TEST-NET-3)", () => {
    expect(isSafeUrl("http://203.0.113.1/foo").safe).toBe(false);
  });

  it("blocks 240.0.0.0/4 (reserved)", () => {
    expect(isSafeUrl("http://240.0.0.1/foo").safe).toBe(false);
  });
});

describe("ssrf-guard — IPv6 blocklist", () => {
  it("blocks ::1 (loopback)", () => {
    expect(isSafeUrl("http://[::1]/foo").safe).toBe(false);
  });

  it("blocks fe80:: (link-local)", () => {
    expect(isSafeUrl("http://[fe80::1]/foo").safe).toBe(false);
  });

  it("blocks fc00::/7 (private IPv6)", () => {
    expect(isSafeUrl("http://[fc00::1]/foo").safe).toBe(false);
    expect(isSafeUrl("http://[fd00::1]/foo").safe).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 (::ffff:10.0.0.1)", () => {
    expect(isSafeUrl("http://[::ffff:10.0.0.1]/foo").safe).toBe(false);
  });
});

describe("ssrf-guard — public IPs allowed", () => {
  it("allows 8.8.8.8 (Google DNS)", () => {
    expect(isSafeUrl("http://8.8.8.8/foo").safe).toBe(true);
  });

  it("allows 1.1.1.1 (Cloudflare DNS)", () => {
    expect(isSafeUrl("http://1.1.1.1/foo").safe).toBe(true);
  });

  it("allows public domains (uses hostname — DNS resolved separately)", () => {
    // For IP-literal hosts, we can statically check.
    // For domain hosts, we don't resolve here — caller must do that separately.
    expect(isSafeUrl("https://example.com/photo.jpg").safe).toBe(true);
  });
});
