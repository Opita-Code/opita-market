/**
 * Typed errors for Opita Pagos.
 *
 * Every error in the system MUST extend OpitaPagosError so the HTTP layer
 * can map error_code → HTTP status + body deterministically.
 *
 * NEVER throw a plain Error — always throw a typed one.
 */

/**
 * Base class for all Opita Pagos errors.
 * The HTTP layer inspects `code` to choose status and `safeMessage` for the body.
 */
export abstract class OpitaPagosError extends Error {
  abstract readonly code: string;
  /** HTTP status code (for surface-level handlers). */
  abstract readonly httpStatus: number;
  /** Whether to expose `message` to clients (false = generic 422). */
  readonly exposeMessage: boolean;

  constructor(message: string, exposeMessage: boolean = false) {
    super(message);
    this.name = this.constructor.name;
    this.exposeMessage = exposeMessage;
    // Preserve stack trace pointing at the caller
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Safe message for clients (exposes details only when allowed). */
  get safeMessage(): string {
    return this.exposeMessage ? this.message : this.code;
  }
}

// ─── Tier / limit errors ──────────────────────────────────────────────────────

export class TierLimitExceededError extends OpitaPagosError {
  readonly code = "TIER_LIMIT_EXCEEDED";
  readonly httpStatus = 422;
  constructor(
    message: string,
    public readonly currentTier: 0 | 1 | 2 | 3 | 4,
    public readonly limitCop: number,
    public readonly attemptedCop: number,
  ) {
    super(message, true);
  }
}

export class WithdrawHoldNotElapsedError extends OpitaPagosError {
  readonly code = "WITHDRAW_HOLD_NOT_ELAPSED";
  readonly httpStatus = 422;
  constructor(
    message: string,
    public readonly availableAtIso: string,
    public readonly hoursRemaining: number,
  ) {
    super(message, true);
  }
}

export class InsufficientBalanceError extends OpitaPagosError {
  readonly code = "INSUFFICIENT_BALANCE";
  readonly httpStatus = 422;
  constructor(
    message: string,
    public readonly balanceCop: number,
    public readonly requestedCop: number,
  ) {
    super(message, false);  // do NOT expose balance to clients
  }
}

export class AmountInvalidError extends OpitaPagosError {
  readonly code = "AMOUNT_INVALID";
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message, false);
  }
}

export class ChannelNotAllowedError extends OpitaPagosError {
  readonly code = "CHANNEL_NOT_ALLOWED";
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message, false);
  }
}

// ─── Idempotency errors ──────────────────────────────────────────────────────

export class IdempotencyKeyReusedError extends OpitaPagosError {
  readonly code = "IDEMPOTENCY_KEY_REUSED";
  readonly httpStatus = 409;
  constructor(
    message: string,
    public readonly originalTransactionId: string,
  ) {
    super(message, false);  // do NOT expose internal tx id
  }
}

// ─── Auth errors ──────────────────────────────────────────────────────────────

export class UnauthenticatedError extends OpitaPagosError {
  readonly code = "UNAUTHENTICATED";
  readonly httpStatus = 401;
  constructor(message: string = "No authenticated user") {
    super(message, false);
  }
}

export class ForbiddenNotDpoError extends OpitaPagosError {
  readonly code = "FORBIDDEN_NOT_DPO";
  readonly httpStatus = 403;
  constructor(message: string = "DPO group required") {
    super(message, false);
  }
}

// ─── Fraud errors ─────────────────────────────────────────────────────────────

export class FraudBlockedError extends OpitaPagosError {
  readonly code = "FRAUD_BLOCKED";
  readonly httpStatus = 403;
  constructor(
    message: string,
    public readonly signals: Array<{ type: string; weight: number }>,
  ) {
    super(message, false);  // do NOT expose signals to clients
  }
}

export class FraudReviewQueuedError extends OpitaPagosError {
  readonly code = "FRAUD_REVIEW_QUEUED";
  readonly httpStatus = 202;  // Accepted — pending DPO review
  constructor(message: string) {
    super(message, false);
  }
}

// ─── Tier promotion errors ────────────────────────────────────────────────────

export class MissingRequirementsError extends OpitaPagosError {
  readonly code = "MISSING_REQUIREMENTS";
  readonly httpStatus = 422;
  constructor(
    message: string,
    public readonly unmet: string[],
  ) {
    super(message, true);
  }
}

// ─── Dispute / escrow errors ──────────────────────────────────────────────────

export class DisputeWindowClosedError extends OpitaPagosError {
  readonly code = "DISPUTE_WINDOW_CLOSED";
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message, false);
  }
}

export class EvidenceRequiredError extends OpitaPagosError {
  readonly code = "EVIDENCE_REQUIRED";
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message, false);
  }
}

export class InvalidStateError extends OpitaPagosError {
  readonly code = "INVALID_STATE";
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message, false);
  }
}

// ─── Referral errors ──────────────────────────────────────────────────────────

export class SelfReferralError extends OpitaPagosError {
  readonly code = "SELF_REFERRAL";
  readonly httpStatus = 422;
  constructor(message: string = "Self-referral not allowed") {
    super(message, false);
  }
}

export class InvalidReferralCodeError extends OpitaPagosError {
  readonly code = "INVALID_CODE";
  readonly httpStatus = 422;
  constructor(message: string = "Referral code not found") {
    super(message, false);
  }
}

export class IpDuplicateError extends OpitaPagosError {
  readonly code = "IP_DUPLICATE";
  readonly httpStatus = 422;
  constructor(message: string = "Referrer and referee share an IP") {
    super(message, false);
  }
}

export class DeviceDuplicateError extends OpitaPagosError {
  readonly code = "DEVICE_DUPLICATE";
  readonly httpStatus = 422;
  constructor(message: string = "Referrer and referee share a device") {
    super(message, false);
  }
}

// ─── Webhook errors ──────────────────────────────────────────────────────────

export class InvalidSignatureError extends OpitaPagosError {
  readonly code = "INVALID_SIGNATURE";
  readonly httpStatus = 401;
  constructor(message: string = "Invalid webhook signature") {
    super(message, false);
  }
}

// ─── Internal errors ─────────────────────────────────────────────────────────

export class InternalError extends OpitaPagosError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
  constructor(message: string = "Internal error", public readonly traceId?: string) {
    super(message, false);
  }
}