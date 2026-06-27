import { describe, it, expect, beforeEach } from "vitest";
import { TorList } from "../../src/lib/tor-list.js";

/**
 * Tests for TorList — in-memory set of known Tor exit relay IPs.
 *
 * Source: https://check.torproject.org/torbulkexitlist (one IP per line)
 * Refreshed daily by cron (see PR 5).
 */
describe("tor-list — Tor exit relay detection", () => {
  beforeEach(() => {
    TorList.reset();
  });

  describe("isTorExit", () => {
    it("returns true for known Tor exit IP", () => {
      TorList.loadFromText("185.220.101.5\n66.79.143.229\n171.25.193.20\n");
      expect(TorList.isTorExit("185.220.101.5")).toBe(true);
    });

    it("returns true for second known Tor exit IP", () => {
      TorList.loadFromText("185.220.101.5\n66.79.143.229\n");
      expect(TorList.isTorExit("66.79.143.229")).toBe(true);
    });

    it("returns false for non-Tor IP", () => {
      TorList.loadFromText("185.220.101.5\n");
      expect(TorList.isTorExit("8.8.8.8")).toBe(false);
    });

    it("returns false for empty list", () => {
      expect(TorList.isTorExit("1.2.3.4")).toBe(false);
    });

    it("is case-insensitive (IPv6 support)", () => {
      TorList.loadFromText("2001:db8::1\n");
      expect(TorList.isTorExit("2001:DB8::1")).toBe(true);
    });
  });

  describe("loading from text", () => {
    it("ignores empty lines", () => {
      TorList.loadFromText("\n\n185.220.101.5\n\n\n");
      expect(TorList.size()).toBe(1);
      expect(TorList.isTorExit("185.220.101.5")).toBe(true);
    });

    it("ignores lines that don't look like IPs", () => {
      TorList.loadFromText("# This is a comment\n185.220.101.5\nrandom text\n");
      expect(TorList.size()).toBe(1);
    });

    it("trims whitespace around IPs", () => {
      TorList.loadFromText("  185.220.101.5  \n");
      expect(TorList.isTorExit("185.220.101.5")).toBe(true);
    });

    it("replaces previous list on reload (not appends)", () => {
      TorList.loadFromText("1.1.1.1\n");
      TorList.loadFromText("2.2.2.2\n");
      expect(TorList.isTorExit("1.1.1.1")).toBe(false);
      expect(TorList.isTorExit("2.2.2.2")).toBe(true);
      expect(TorList.size()).toBe(1);
    });
  });

  describe("size", () => {
    it("returns 0 for empty list", () => {
      expect(TorList.size()).toBe(0);
    });

    it("counts unique IPs", () => {
      TorList.loadFromText("1.1.1.1\n2.2.2.2\n3.3.3.3\n");
      expect(TorList.size()).toBe(3);
    });

    it("counts duplicates once", () => {
      TorList.loadFromText("1.1.1.1\n1.1.1.1\n2.2.2.2\n");
      expect(TorList.size()).toBe(2);
    });
  });

  describe("IP validation in loadFromText", () => {
    it("rejects malformed IPs (too few octets)", () => {
      TorList.loadFromText("1.2.3\n");
      expect(TorList.size()).toBe(0);
    });

    it("rejects malformed IPs (too many octets)", () => {
      TorList.loadFromText("1.2.3.4.5\n");
      expect(TorList.size()).toBe(0);
    });

    it("rejects non-numeric IPs", () => {
      TorList.loadFromText("not.an.ip.addr\n");
      expect(TorList.size()).toBe(0);
    });

    it("accepts valid IPv4", () => {
      TorList.loadFromText("192.168.1.1\n");
      expect(TorList.size()).toBe(1);
    });

    it("accepts valid IPv6 (full form)", () => {
      TorList.loadFromText("2001:0db8:85a3:0000:0000:8a2e:0370:7334\n");
      expect(TorList.size()).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears the list", () => {
      TorList.loadFromText("1.1.1.1\n");
      TorList.reset();
      expect(TorList.size()).toBe(0);
      expect(TorList.isTorExit("1.1.1.1")).toBe(false);
    });
  });
});