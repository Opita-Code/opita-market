import { describe, it, expect } from "vitest";
import {
  computeDeviceFingerprint,
  detectDeviceMismatch,
  hashDeviceId,
  type DeviceRecord,
} from "../../../src/lib/velocity/fingerprint.js";

/**
 * Tests for device fingerprinting (PR 2c — closes OPL-CARD-013).
 *
 * Spec (velocity-counter/spec.md R6):
 *   - Frontend integrates fingerprintjs (open-source)
 *   - device_id sent in payment intent headers
 *   - Backend persists device_id per user, tracks changes
 *   - DEVICE_FINGERPRINT_MISMATCH signal when device changes within 24h
 */
describe("device fingerprint — hashing", () => {
  it("produces stable hash for same input", () => {
    const a = hashDeviceId("device-abc");
    const b = hashDeviceId("device-abc");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashDeviceId("device-abc")).not.toBe(hashDeviceId("device-xyz"));
  });

  it("hash is hex string of length 64 (SHA-256)", () => {
    const hash = hashDeviceId("device-abc");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("device fingerprint — mismatch detection", () => {
  it("no mismatch when device is same", () => {
    const now = 1_000_000_000;
    const record: DeviceRecord = {
      userId: "user-123",
      deviceHash: hashDeviceId("device-abc"),
      firstSeenMs: now - 1000,
      lastSeenMs: now - 1000,
    };
    const result = detectDeviceMismatch({
      userId: "user-123",
      currentDeviceId: "device-abc",
      record,
      nowMs: now,
    });
    expect(result.isMismatch).toBe(false);
  });

  it("mismatch when device differs and last seen within 24h", () => {
    const now = 1_000_000_000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const record: DeviceRecord = {
      userId: "user-123",
      deviceHash: hashDeviceId("device-old"),
      firstSeenMs: now - 24 * 60 * 60 * 1000,
      lastSeenMs: oneHourAgo,
    };
    const result = detectDeviceMismatch({
      userId: "user-123",
      currentDeviceId: "device-new",
      record,
      nowMs: now,
    });
    expect(result.isMismatch).toBe(true);
    expect(result.hoursSinceLastSeen).toBeLessThan(24);
  });

  it("no mismatch when device differs but last seen > 24h ago", () => {
    const now = 1_000_000_000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const record: DeviceRecord = {
      userId: "user-123",
      deviceHash: hashDeviceId("device-old"),
      firstSeenMs: now - 7 * 24 * 60 * 60 * 1000,
      lastSeenMs: twoDaysAgo,
    };
    const result = detectDeviceMismatch({
      userId: "user-123",
      currentDeviceId: "device-new",
      record,
      nowMs: now,
    });
    expect(result.isMismatch).toBe(false);
  });

  it("no mismatch when no prior record", () => {
    const result = detectDeviceMismatch({
      userId: "user-123",
      currentDeviceId: "device-new",
      record: null,
      nowMs: Date.now(),
    });
    expect(result.isMismatch).toBe(false);
  });
});

describe("device fingerprint — computeDeviceFingerprint (metadata-based)", () => {
  it("produces consistent hash from same metadata", () => {
    const metadata = {
      userAgent: "Mozilla/5.0 ...",
      screenWidth: 1920,
      screenHeight: 1080,
      timezone: "America/Bogota",
      language: "es-CO",
    };
    const a = computeDeviceFingerprint(metadata);
    const b = computeDeviceFingerprint(metadata);
    expect(a).toBe(b);
  });

  it("produces different hash when UA changes", () => {
    const base = { screenWidth: 1920, timezone: "America/Bogota", language: "es-CO" };
    const a = computeDeviceFingerprint({ ...base, userAgent: "Mozilla/5.0 ..." });
    const b = computeDeviceFingerprint({ ...base, userAgent: "Chrome/120 ..." });
    expect(a).not.toBe(b);
  });
});
