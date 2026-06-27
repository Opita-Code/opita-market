/**
 * Compliance screening provider abstraction (PEP + Sanctions).
 *
 * Closes OPL-COMP-018 (no PEP screening), OPL-COMP-019 (no sanctions screening).
 *
 * Design (Option A — provider abstraction + mock):
 *   - ComplianceScreeningProvider interface — all production screening flows
 *     call this interface, NOT a specific vendor.
 *   - MockComplianceScreeningProvider — for dev/test, no external calls.
 *   - ComplyAdvantageComplianceScreeningProvider — production skeleton that
 *     can be enabled by setting COMPLYADVANTAGE_API_KEY in SST Secrets.
 *     Currently a placeholder; uncomment + finish when operator commits to $$$.
 *
 * Swapping providers: 1 line in api/index.ts handler init.
 *
 * Risk assessment:
 *   - HIGH: BLOCK (transaction blocked, user flagged for DPO review)
 *   - MEDIUM: REVIEW (queued for DPO review, transaction may proceed with flag)
 *   - LOW: ALLOW (proceed normally)
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ScreeningType = "USER" | "TRANSACTION";
export type MatchType = "PEP" | "SANCTIONS" | "ADVERSE_MEDIA";

export interface ScreeningMatch {
  /** Type of watchlist hit. */
  type: MatchType;
  /** Source list (e.g., "OFAC SDN", "UN Security Council", "ComplyAdvantage PEP"). */
  source: string;
  /** Match confidence 0-1. */
  matchScore: number;
  /** Matched entity name from the watchlist. */
  matchedName: string;
  /** Matched entity country code (ISO 3166-1 alpha-2) if available. */
  matchedCountry?: string;
  /** Optional notes (e.g., reason for sanctions). */
  notes?: string;
}

export interface ScreeningRequest {
  userId: string;
  /** Full name as on government ID (for PEP/sanctions matching). */
  fullName: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Optional date of birth for disambiguation. */
  dateOfBirth?: string;
}

export interface TransactionScreeningRequest {
  userId: string;
  amountCop: number;
  channel: string;
  /** Counterparty user_id for P2P transfers; null for direct purchases. */
  counterpartyUserId?: string;
  /** Counterparty name (if known) for screening against watchlists. */
  counterpartyName?: string;
  /** Counterparty country (if known). */
  counterpartyCountry?: string;
}

export interface ScreeningResult {
  /** Screening request type. */
  screeningType: ScreeningType;
  /** Highest risk from all matches. */
  riskLevel: RiskLevel;
  /** All watchlist matches (empty if clean). */
  matches: ScreeningMatch[];
  /** Provider source (for audit). */
  provider: string;
  /** ISO timestamp of screening. */
  screenedAtIso: string;
  /** Provider's reference ID (for audit + dispute resolution). */
  providerReferenceId?: string;
}

export interface ComplianceScreeningProvider {
  /** Screen a user (typically at onboarding or periodic re-screen). */
  screenUser(request: ScreeningRequest): Promise<ScreeningResult>;
  /** Screen a transaction (typically above 1M COP per pentest spec). */
  screenTransaction(request: TransactionScreeningRequest): Promise<ScreeningResult>;
  /** Provider name for audit logging. */
  readonly providerName: string;
}

// ─── Risk thresholds (closes OPL-COMP-018, OPL-COMP-019) ────────────────────

export const RISK_THRESHOLDS = {
  BLOCK: "HIGH" as RiskLevel,
  REVIEW: "MEDIUM" as RiskLevel,
  ALLOW: "LOW" as RiskLevel,
};

/** Transactions above this COP threshold require screening (pentest OPL-COMP-019). */
export const TRANSACTION_SCREENING_THRESHOLD_COP = 1_000_000;

export function shouldBlockTransaction(result: Pick<ScreeningResult, "riskLevel">): boolean {
  return result.riskLevel === RISK_THRESHOLDS.BLOCK;
}

export function shouldReviewTransaction(result: Pick<ScreeningResult, "riskLevel">): boolean {
  return result.riskLevel === RISK_THRESHOLDS.REVIEW;
}

/**
 * Aggregate multiple matches into the highest risk level.
 * Risk hierarchy: HIGH > MEDIUM > LOW.
 */
export function assessRisk(matches: ScreeningMatch[]): RiskLevel {
  if (matches.some((m) => m.matchScore >= 0.85)) return "HIGH";
  if (matches.some((m) => m.matchScore >= 0.5)) return "MEDIUM";
  return "LOW";
}

export function validateScreeningRequest(request: ScreeningRequest): void {
  if (!request.userId || request.userId.length === 0) {
    throw new Error("compliance-screening: userId is required");
  }
  if (!request.fullName || request.fullName.length === 0) {
    throw new Error("compliance-screening: fullName is required");
  }
  if (!request.country || request.country.length === 0) {
    throw new Error("compliance-screening: country is required");
  }
}

export function validateTransactionScreeningRequest(request: TransactionScreeningRequest): void {
  if (!request.userId || request.userId.length === 0) {
    throw new Error("compliance-screening (tx): userId is required");
  }
  if (!Number.isFinite(request.amountCop) || request.amountCop < 0) {
    throw new Error("compliance-screening (tx): amountCop must be non-negative finite");
  }
  if (!request.channel || request.channel.length === 0) {
    throw new Error("compliance-screening (tx): channel is required");
  }
}
