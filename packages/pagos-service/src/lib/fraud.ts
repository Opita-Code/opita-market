/**
 * Anti-fraud engine for Opita Pagos.
 *
 * ALGORITHM:
 *   - Aggregate fired signals (each with weight 0-1)
 *   - Score = sum(weights) / N where N = count of fired signals
 *     (Note: this is NOT a weighted average — it's a simple sum, normalized by count)
 *   - Decision:
 *       score >= 0.7  → BLOCK
 *       score >= 0.4  → REVIEW
 *       score <  0.4  → ALLOW
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
}

// Decision thresholds
const BLOCK_THRESHOLD = 0.7;
const REVIEW_THRESHOLD = 0.4;

export class FraudEngine {
  /**
   * Evaluate a set of fired signals and produce a decision.
   *
   * Score formula (SUM, not average):
   *   - If no signals fired: score = 0
   *   - Otherwise: score = sum(signal.weight)
   *
   * Why SUM not average: a single strong signal (e.g., TOR_EXIT weight 1.0)
   * should immediately BLOCK regardless of how many weak signals fired. SUM
   * captures "any strong indicator" naturally; AVERAGE would dilute it.
   *
   * Thresholds:
   *   - score >= 0.7 → BLOCK
   *   - score >= 0.4 → REVIEW
   *   - score <  0.4 → ALLOW
   *
   * Example scenarios:
   *   - TOR_EXIT alone (weight 1.0): sum=1.0 → BLOCK
   *   - DATACENTER_IP + SUSPICIOUS_TIMING (0.5+0.3=0.8): sum=0.8 → BLOCK
   *   - DATACENTER_IP alone (0.5): sum=0.5 → REVIEW
   *   - SUSPICIOUS_TIMING alone (0.3): sum=0.3 → ALLOW
   *   - No signals: sum=0 → ALLOW
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
      return { decision: "ALLOW", score: 0, signals: [] };
    }

    const score = signals.reduce((acc, s) => acc + s.weight, 0);

    let decision: FraudDecision;
    if (score >= BLOCK_THRESHOLD) {
      decision = "BLOCK";
    } else if (score >= REVIEW_THRESHOLD) {
      decision = "REVIEW";
    } else {
      decision = "ALLOW";
    }

    return { decision, score, signals };
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