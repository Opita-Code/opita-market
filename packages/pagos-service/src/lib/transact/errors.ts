/**
 * Transact errors.
 *
 * All errors extend OpitaPagosError so the HTTP layer can map them
 * deterministically. NO error message may include internal data
 * (balance values, version numbers, etc.) — see R5 of transact-wrapper spec.
 */

import { OpitaPagosError } from "../errors.js";

export class TransactError extends OpitaPagosError {
  readonly code = "TRANSACT_FAILED";
  readonly httpStatus = 500;
  constructor(message: string = "Transact operation failed") {
    super(message);
  }
}

export class ConditionFailedError extends OpitaPagosError {
  readonly code = "CONDITION_FAILED";
  readonly httpStatus = 422;
  constructor(
    message: string = "Condition check failed",
    public readonly failedCondition: string = "unknown",
  ) {
    super(message);
  }
}

export class InsufficientBalanceError extends OpitaPagosError {
  readonly code = "INSUFFICIENT_BALANCE";
  readonly httpStatus = 422;
  // R5: generic message, never include the actual balance.
  constructor() {
    super("Insufficient balance for this operation");
  }
}

export class SelfTransferError extends OpitaPagosError {
  readonly code = "SELF_TRANSFER";
  readonly httpStatus = 422;
  constructor() {
    super("Cannot transfer to yourself");
  }
}

export class InvalidAmountError extends OpitaPagosError {
  readonly code = "INVALID_AMOUNT";
  readonly httpStatus = 422;
  constructor() {
    super("Amount must be a positive integer");
  }
}

export class TooManyItemsError extends OpitaPagosError {
  readonly code = "TOO_MANY_ITEMS";
  readonly httpStatus = 422;
  constructor() {
    super("TransactWriteItems supports at most 100 items per call");
  }
}

export class DuplicateIdempotencyError extends OpitaPagosError {
  readonly code = "DUPLICATE_IDEMPOTENCY_KEY";
  readonly httpStatus = 409;
  constructor() {
    super("Operation already processed");
  }
}

export class ConflictingIdempotencyError extends OpitaPagosError {
  readonly code = "CONFLICTING_IDEMPOTENCY_KEY";
  readonly httpStatus = 409;
  constructor() {
    super("Idempotency key already used for a different operation");
  }
}
