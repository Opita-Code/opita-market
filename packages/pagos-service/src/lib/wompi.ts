/**
 * Wompi client for Opita Pagos.
 *
 * Supports:
 *   - Integrity signature generation (widget-side hash)
 *   - Webhook signature verification (HMAC SHA256 with timing-safe-equal)
 *
 * SPEC REFERENCES:
 *   - Widget signature: https://docs.wompi.co/en/docs/colombia/widget-checkout-web/#step-3-generate-an-integrity-signature
 *   - Webhook signature: https://docs.wompi.co/en/docs/colombia/eventos/
 *
 * SECURITY:
 *   - Webhook verification uses crypto.timingSafeEqual to prevent timing attacks.
 *   - Generic 401 error is thrown on any mismatch (no detail leaked to caller).
 *   - The integrity secret must NEVER be exposed to the client-side (always generate on server).
 */

import crypto from "node:crypto";
import { InvalidSignatureError } from "./errors.js";

// ─── Integrity signature (widget-side) ──────────────────────────────────────

export interface IntegritySignatureInput {
  reference: string;
  amountInCents: number;
  currency: string;
  /** Required. NEVER log this — it's the integrity secret. */
  integritySecret: string;
  /** Optional expiration time (ISO 8601). */
  expirationTime?: string;
}

/**
 * Generate Wompi integrity signature.
 *
 * Concatenation order (Wompi docs):
 *   Without expiration: `<Reference><AmountInCents><Currency><IntegritySecret>`
 *   With expiration:    `<Reference><AmountInCents><Currency><ExpirationTime><IntegritySecret>`
 *
 * Algorithm: SHA-256 hex.
 *
 * @throws Error on missing/invalid inputs.
 */
export function generateIntegritySignature(input: IntegritySignatureInput): string {
  // Input validation
  if (!input.reference || input.reference.length === 0) {
    throw new Error("reference is required");
  }
  if (!input.currency || input.currency.length === 0) {
    throw new Error("currency is required");
  }
  if (!input.integritySecret || input.integritySecret.length === 0) {
    throw new Error("integritySecret is required");
  }
  if (!Number.isInteger(input.amountInCents)) {
    throw new Error(`amountInCents must be an integer, got ${input.amountInCents}`);
  }
  if (input.amountInCents < 0) {
    throw new Error(`amountInCents must be non-negative, got ${input.amountInCents}`);
  }

  const parts = [
    input.reference,
    String(input.amountInCents),
    input.currency,
  ];
  if (input.expirationTime) {
    parts.push(input.expirationTime);
  }
  parts.push(input.integritySecret);

  const concatenated = parts.join("");
  return crypto.createHash("sha256").update(concatenated, "utf8").digest("hex");
}

// ─── Webhook signature (server-side verification) ───────────────────────────

export interface WompiWebhookBody {
  event: string;
  data: {
    transaction: {
      id: string;
      reference: string;
      status: string;
      amount_in_cents: number;
      currency: string;
      payment_method_type?: string;
    };
  };
  signature: {
    /** Array of dotted-paths into `data` (e.g., ["transaction.id", "transaction.status"]) */
    properties: string[];
    /** Computed checksum from Wompi */
    checksum: string;
  };
  timestamp: number;
  /** Environment: "prod" or "test" */
  environment?: string;
}

/**
 * Verify Wompi webhook signature using HMAC SHA256 with timing-safe-equal.
 *
 * Algorithm (Wompi docs):
 *   1. For each property in `signature.properties`, extract its value from `data`.
 *   2. Concatenate all extracted values (in order).
 *   3. Append the timestamp.
 *   4. Append the events secret.
 *   5. Compute SHA-256 hex.
 *   6. Compare with `signature.checksum` using timing-safe-equal.
 *
 * @throws InvalidSignatureError on any mismatch (generic, no detail leaked).
 */
export function verifyWebhookSignature(
  body: WompiWebhookBody,
  eventsSecret: string,
): boolean {
  if (!eventsSecret || eventsSecret.length === 0) {
    throw new Error("eventsSecret is required for webhook verification");
  }

  if (!body.signature?.properties || !Array.isArray(body.signature.properties)) {
    throw new InvalidSignatureError("Missing or invalid signature.properties");
  }

  if (!body.signature.checksum || typeof body.signature.checksum !== "string") {
    throw new InvalidSignatureError("Missing or invalid signature.checksum");
  }

  if (!body.timestamp || typeof body.timestamp !== "number") {
    throw new InvalidSignatureError("Missing or invalid timestamp");
  }

  // 1+2. Extract values from data using dotted paths
  let concatenated = "";
  for (const prop of body.signature.properties) {
    const value = getNestedValue(body.data, prop);
    if (value === undefined) {
      throw new InvalidSignatureError(`Property not found in data: ${prop}`);
    }
    concatenated += String(value);
  }

  // 3. Append timestamp
  concatenated += String(body.timestamp);

  // 4. Append events secret
  concatenated += eventsSecret;

  // 5. Compute SHA-256 hex
  const expectedChecksum = crypto.createHash("sha256").update(concatenated, "utf8").digest("hex");

  // 6. Compare with timing-safe-equal
  const expectedBuf = Buffer.from(expectedChecksum, "utf8");
  const receivedBuf = Buffer.from(body.signature.checksum, "utf8");

  // timingSafeEqual requires equal-length buffers
  if (expectedBuf.length !== receivedBuf.length) {
    throw new InvalidSignatureError();
  }

  if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new InvalidSignatureError();
  }

  return true;
}

/**
 * Safely traverse a nested object using dotted path notation.
 * Returns undefined if any segment is missing.
 *
 * Examples:
 *   getNestedValue({a: {b: 1}}, "a.b") → 1
 *   getNestedValue({a: 1}, "a.b")      → undefined
 *   getNestedValue({a: {b: 1}}, "a")   → {b: 1}
 */
function getNestedValue(obj: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── WompiClient (sandbox URLs) ─────────────────────────────────────────────

export const WOMPI_ENV_URLS = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
} as const;

export type WompiEnvironment = keyof typeof WOMPI_ENV_URLS;

export interface WompiClientConfig {
  environment: WompiEnvironment;
  /** Public commerce key (for widget display + safe API calls) */
  publicKey: string;
  /** Private commerce key (server-side only — NEVER expose to client) */
  privateKey: string;
  /** Integrity secret for signature generation */
  integritySecret: string;
  /** Events secret for webhook verification */
  eventsSecret: string;
}

export class WompiClient {
  readonly baseUrl: string;
  readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;
  private readonly eventsSecret: string;

  constructor(config: WompiClientConfig) {
    if (!config.publicKey) throw new Error("publicKey is required");
    if (!config.privateKey) throw new Error("privateKey is required");
    if (!config.integritySecret) throw new Error("integritySecret is required");
    if (!config.eventsSecret) throw new Error("eventsSecret is required");
    if (config.environment !== "sandbox" && config.environment !== "production") {
      throw new Error(`environment must be 'sandbox' or 'production', got ${config.environment}`);
    }
    this.baseUrl = WOMPI_ENV_URLS[config.environment];
    this.publicKey = config.publicKey;
    this.privateKey = config.privateKey;
    this.integritySecret = config.integritySecret;
    this.eventsSecret = config.eventsSecret;
  }

  /** Generate integrity signature for a widget transaction. */
  signTransaction(input: Omit<IntegritySignatureInput, "integritySecret">): string {
    return generateIntegritySignature({ ...input, integritySecret: this.integritySecret });
  }

  /** Verify a webhook event. Throws InvalidSignatureError on mismatch. */
  verifyWebhook(body: WompiWebhookBody): boolean {
    return verifyWebhookSignature(body, this.eventsSecret);
  }
}