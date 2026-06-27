/**
 * Anti-fraud engine for Opita Pagos.
 *
 * ALGORITHM (PR 2c — closes OPL-CARD-007 high FPR):
 *   - Each signal weight is clamped to [0, 0.5] (per-signal cap)
 *   - Score = sum(clamped weights)
 *   - Decision:
 *       score >= 0.8  → BLOCK  (raised from 0.7 to compensate for cap)
 *       score >= 0.4  → REVIEW
 *       score <  0.4  → ALLOW
 *
 * WHY THE CAP (closes OPL-CARD-007):
 *   The previous formula had no per-signal cap. A single TOR_EXIT (weight 1.0)
 *   would BLOCK alone — but TOR users include legit privacy-conscious users
 *   (journalists, activists, security researchers). A datacenter IP + a slightly
 *   unusual time (0.5 + 0.3 = 0.8) would also BLOCK a legit cloud worker.
 *
 *   With cap=0.5 + threshold=0.8:
 *     - TOR_EXIT alone: capped 0.5 → REVIEW (human review, not BLOCK)
 *     - 5 weak signals (0.15 each): 0.75 → REVIEW (not BLOCK)
 *     - 2 strong signals (0.6 + 0.5 → 0.5 + 0.5 = 1.0): → BLOCK
 *     - TOR_EXIT + VPN (1.0 + 0.8 → 0.5 + 0.5 = 1.0): → BLOCK
 *
 *   The result: BLOCK requires MULTIPLE signals to accumulate, not a single
 *   one. This forces attackers to evade multiple controls simultaneously.
 *
 * USAGE:
 *   1. Collect signals (e.g., TOR_EXIT, VELOCITY_EXCEEDED) from various sources
 *   2. Call evaluateSignals(signals)
 *   3. Apply decision: BLOCK halts the request, REVIEW queues for DPO, ALLOW proceeds
 */

export type FraudSignalType =
  | "VELOCITY_EXCEEDED"
  | "AMOUNT_LIMIT_EXCEEDED"
  | "GEO_MISMATCH"
  | "GEO_CITY_MISMATCH"
  | "TOR_EXIT"
  | "VPN_DETECTED"
  | "PROXY_DETECTED"
  | "DATACENTER_IP"
  | "DEVICE_FINGERPRINT_MISMATCH"
  | "BLACKLIST_MATCH"
  | "REFERRAL_FRAUD_SUSPECTED"
  | "CHARGEBACK_HISTORY"
  | "SUSPICIOUS_TIMING";

export type FraudDecision = "ALLOW" | "REVIEW" | "BLOCK";

export interface FraudSignal {
  type: FraudSignalType;
  weight: number; // 0.0 - 1.0
}

export interface FraudEvaluation {
  decision: FraudDecision;
  score: number;
  signals: FraudSignal[];
  /** Sum of clamped weights used for the decision (signals[i].weight is preserved). */
  cappedScore: number;
}

// Decision thresholds (PR 2c: BLOCK raised to 0.8 to compensate for cap=0.5)
const BLOCK_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.4;

// Per-signal contribution cap (PR 2c: closes OPL-CARD-007 high FPR)
const MAX_SIGNAL_CONTRIBUTION = 0.5;

export class FraudEngine {
  /**
   * Evaluate a set of fired signals and produce a decision.
   *
   * Score formula:
   *   - cappedScore = sum(min(signal.weight, 0.5))   // each capped at 0.5
   *   - BLOCK  if cappedScore >= 0.8
   *   - REVIEW if cappedScore >= 0.4
   *   - ALLOW  otherwise
   *
   * Example scenarios (post PR 2c):
   *   - TOR_EXIT alone (1.0): capped 0.5 → REVIEW (was BLOCK pre-PR 2c)
   *   - 5 weak signals (0.15 each): 0.75 → REVIEW (was BLOCK pre-PR 2c)
   *   - TOR_EXIT + VPN (1.0 + 0.8 → 0.5 + 0.5 = 1.0): → BLOCK
   *   - VELOCITY + DATACENTER (0.6 + 0.5 → 0.5 + 0.5 = 1.0): → BLOCK
   *   - DATACENTER_IP alone (0.5): → REVIEW
   *   - SUSPICIOUS_TIMING alone (0.3): → ALLOW
   *   - No signals: → ALLOW
   */
  evaluateSignals(signals: FraudSignal[]): FraudEvaluation {
    // Validate input
    for (const s of signals) {
      if (!Number.isFinite(s.weight) || s.weight < 0 || s.weight > 1) {
        throw new Error(
          `Invalid signal weight: ${s.weight} (must be finite, 0 ≤ w ≤ 1)`,
        );
      }
    }

    if (signals.length === 0) {
      return { decision: "ALLOW", score: 0, signals: [], cappedScore: 0 };
    }

    // PR 2c: clamp each signal to MAX_SIGNAL_CONTRIBUTION before summing
    const cappedScore = signals.reduce(
      (acc, s) => acc + Math.min(s.weight, MAX_SIGNAL_CONTRIBUTION),
      0,
    );

    let decision: FraudDecision;
    if (cappedScore >= BLOCK_THRESHOLD) {
      decision = "BLOCK";
    } else if (cappedScore >= REVIEW_THRESHOLD) {
      decision = "REVIEW";
    } else {
      decision = "ALLOW";
    }

    return { decision, score: cappedScore, signals, cappedScore };
  }
}

/** Reference weights for each signal type (used by signal collectors). */
export const SIGNAL_WEIGHTS: Record<FraudSignalType, number> = {
  VELOCITY_EXCEEDED: 0.6,
  AMOUNT_LIMIT_EXCEEDED: 0.5,
  GEO_MISMATCH: 0.4,
  GEO_CITY_MISMATCH: 0.2,
  TOR_EXIT: 1.0,
  VPN_DETECTED: 0.8,
  PROXY_DETECTED: 0.6,
  DATACENTER_IP: 0.5,
  DEVICE_FINGERPRINT_MISMATCH: 0.4,
  BLACKLIST_MATCH: 0.9,
  REFERRAL_FRAUD_SUSPECTED: 0.7,
  CHARGEBACK_HISTORY: 0.8,
  SUSPICIOUS_TIMING: 0.3,
};