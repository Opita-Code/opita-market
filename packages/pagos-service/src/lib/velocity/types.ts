/**
 * Velocity counter types.
 *
 * Multi-dimensional velocity tracking for fraud prevention:
 *   - BIN_CARD: per first-6-digits of PAN
 *   - IP_CARD: per source IP
 *   - DEVICE_CARD: per device fingerprint
 *   - EMAIL_INTENT: per user email
 */

export type CounterType = "BIN_CARD" | "IP_CARD" | "DEVICE_CARD" | "EMAIL_INTENT";

export interface IncrementInput {
  type: CounterType;
  value: string;
  windowSec: number;
  ttlSec: number;
  /** Optional clock injection for tests; defaults to Date.now() */
  nowSec?: () => number;
}

export interface IncrementResult {
  count: number;
}

export interface VelocityCounter {
  increment(input: IncrementInput): Promise<IncrementResult>;
}

export interface CounterThreshold {
  type: CounterType;
  windowSec: number;
  threshold: number;
  ttlSec: number;
}

/**
 * Default thresholds per counter type.
 * TTL = window + 1 hour (per spec R1: ttl: window + 1h).
 */
export const DEFAULT_THRESHOLDS: Record<CounterType, CounterThreshold> = {
  BIN_CARD: { type: "BIN_CARD", windowSec: 60, threshold: 10, ttlSec: 60 + 3600 },
  IP_CARD: { type: "IP_CARD", windowSec: 300, threshold: 50, ttlSec: 300 + 3600 },
  DEVICE_CARD: { type: "DEVICE_CARD", windowSec: 300, threshold: 20, ttlSec: 300 + 3600 },
  EMAIL_INTENT: { type: "EMAIL_INTENT", windowSec: 3600, threshold: 100, ttlSec: 3600 + 3600 },
};

/**
 * Validate counter input — fail-fast on bad data.
 */
export function validateIncrementInput(input: IncrementInput): void {
  if (!input.value || input.value.length === 0) {
    throw new Error("velocity: value must be non-empty");
  }
  if (!Number.isFinite(input.windowSec) || input.windowSec <= 0) {
    throw new Error("velocity: windowSec must be positive finite number");
  }
  if (!Number.isFinite(input.ttlSec) || input.ttlSec < input.windowSec) {
    throw new Error("velocity: ttlSec must be >= windowSec");
  }
}
