/**
 * Velocity signal emission — collects velocity + history signals for fraud engine.
 *
 * Spec (velocity-counter/spec.md R3, R4):
 *   - If count exceeds threshold: emit VELOCITY_EXCEEDED signal (weight 0.6)
 *   - If UserHistory has prior BLOCK: emit auto-BLOCK signal (weight 1.0)
 *
 * Multi-dimensional: BIN + IP + Device + Email all checked independently.
 */

import type { VelocityCounter, CounterType } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./types.js";
import type { UserHistory } from "./user-history.js";
import type { FraudSignal } from "../fraud.js";

export interface VelocitySignalsDeps {
  counter: VelocityCounter;
  history: UserHistory;
}

export interface VelocitySignalsInput {
  userId?: string;
  bin?: string;
  ip?: string;
  deviceId?: string;
  email?: string;
}

export interface VelocitySignalsResult {
  signals: FraudSignal[];
  recentBlock: { userId: string; reason: string; timestampMs: number } | null;
}

const VELOCITY_WEIGHT = 0.6;
const AUTO_BLOCK_WEIGHT = 1.0;

async function checkAndEmit(
  deps: VelocitySignalsDeps,
  input: VelocitySignalsInput,
  type: CounterType,
  value: string | undefined,
): Promise<FraudSignal[]> {
  if (!value) return [];
  const { threshold, windowSec, ttlSec } = DEFAULT_THRESHOLDS[type];
  const { count } = await deps.counter.increment({ type, value, windowSec, ttlSec });
  if (count > threshold) {
    return [{ type: "VELOCITY_EXCEEDED", weight: VELOCITY_WEIGHT }];
  }
  return [];
}

export async function collectVelocitySignals(
  deps: VelocitySignalsDeps,
  input: VelocitySignalsInput,
): Promise<VelocitySignalsResult> {
  const signals: FraudSignal[] = [];

  // Per-BIN, per-IP, per-device, per-email — all independent counters
  signals.push(...(await checkAndEmit(deps, input, "BIN_CARD", input.bin)));
  signals.push(...(await checkAndEmit(deps, input, "IP_CARD", input.ip)));
  signals.push(...(await checkAndEmit(deps, input, "DEVICE_CARD", input.deviceId)));
  signals.push(...(await checkAndEmit(deps, input, "EMAIL_INTENT", input.email)));

  // Repeat offender check (closes OPL-CARD-012)
  let recentBlock: VelocitySignalsResult["recentBlock"] = null;
  if (input.userId) {
    const block = await deps.history.findRecentBlock(input.userId);
    if (block) {
      recentBlock = block;
      signals.push({ type: "BLACKLIST_MATCH", weight: AUTO_BLOCK_WEIGHT });
    }
  }

  return { signals, recentBlock };
}
