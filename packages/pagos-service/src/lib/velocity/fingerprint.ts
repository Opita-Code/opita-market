/**
 * Device fingerprinting (PR 2c — closes OPL-CARD-013).
 *
 * Spec (velocity-counter/spec.md R6):
 *   - Frontend integrates fingerprintjs (open-source) or maxmind-device-tracking
 *   - device_id sent in payment intent headers
 *   - Backend persists device_id per user, tracks changes
 *   - DEVICE_FINGERPRINT_MISMATCH signal when device changes within 24h
 */

import { createHash } from "node:crypto";

export interface DeviceFingerprintMetadata {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  timezone: string;
  language: string;
}

/** Stable SHA-256 hex of the raw device_id (from fingerprintjs). */
export function hashDeviceId(deviceId: string): string {
  if (!deviceId || deviceId.length === 0) {
    throw new Error("fingerprint: deviceId must be non-empty");
  }
  return createHash("sha256").update(deviceId).digest("hex");
}

/** Compute device fingerprint hash from browser metadata (fallback when fingerprintjs unavailable). */
export function computeDeviceFingerprint(metadata: DeviceFingerprintMetadata): string {
  const canonical = JSON.stringify({
    ua: metadata.userAgent,
    w: metadata.screenWidth,
    h: metadata.screenHeight,
    tz: metadata.timezone,
    lang: metadata.language,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface DeviceRecord {
  userId: string;
  deviceHash: string;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface DetectMismatchInput {
  userId: string;
  currentDeviceId: string;
  record: DeviceRecord | null;
  nowMs: number;
}

export interface DetectMismatchResult {
  isMismatch: boolean;
  hoursSinceLastSeen: number;
}

const DEVICE_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export function detectDeviceMismatch(input: DetectMismatchInput): DetectMismatchResult {
  if (!input.record) {
    return { isMismatch: false, hoursSinceLastSeen: Infinity };
  }
  const currentHash = hashDeviceId(input.currentDeviceId);
  const hoursSinceLastSeen = (input.nowMs - input.record.lastSeenMs) / (60 * 60 * 1000);

  if (currentHash === input.record.deviceHash) {
    return { isMismatch: false, hoursSinceLastSeen };
  }

  // Device changed — only signal if change is within 24h window
  return {
    isMismatch: hoursSinceLastSeen < 24,
    hoursSinceLastSeen,
  };
}
