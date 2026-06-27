/**
 * Webhook gateway errors.
 */

import { OpitaPagosError } from "../errors.js";

export class InvalidSignatureError extends OpitaPagosError {
  readonly code = "INVALID_SIGNATURE";
  readonly httpStatus = 401;
  // R-lib-007: no descriptive message — generic to avoid schema leak.
  constructor() {
    super("Invalid webhook signature");
  }
}

export class WebhookExpiredError extends OpitaPagosError {
  readonly code = "WEBHOOK_EXPIRED";
  readonly httpStatus = 401;
  constructor() {
    super("Webhook timestamp outside acceptable window");
  }
}

export class WebhookBodyTooLargeError extends OpitaPagosError {
  readonly code = "WEBHOOK_BODY_TOO_LARGE";
  readonly httpStatus = 413;
  constructor() {
    super("Webhook body exceeds maximum size");
  }
}

export class FraudSignalError extends OpitaPagosError {
  readonly code = "FRAUD_SIGNAL";
  readonly httpStatus = 200; // Return 200 to avoid Wompi retry, but log signal.
  constructor(
    public readonly signalCode: string,
    public readonly txId: string,
  ) {
    super(`Fraud signal: ${signalCode} for tx ${txId}`);
  }
}
