/**
 * Webhook gateway types.
 */

export type WompiEventType =
  | "transaction.approved"
  | "transaction.declined"
  | "transaction.reversed"
  | "transaction.disputed";

export type WompiTransactionStatus = "APPROVED" | "DECLINED" | "VOIDED" | "ERROR" | "REVERSED";

export type WompiPaymentMethod =
  | "CARD"
  | "BREB"
  | "BANCOLOMBIA_TRANSFER"
  | "NEQUI"
  | "PSE"
  | "DAVIPLATA";

export interface WompiTransaction {
  id: string;
  reference: string;
  status: WompiTransactionStatus;
  amount_in_cents: number;
  currency: string;
  payment_method_type: WompiPaymentMethod;
  requires_3ds?: boolean;
  customer_email?: string;
  merchant_id?: string;
}

export interface WompiEvent {
  event: WompiEventType;
  data: { transaction: WompiTransaction };
  /** Unix seconds */
  timestamp: number;
  signature: { properties: string[]; checksum: string };
  environment: "test" | "prod";
}

export interface WebhookResult {
  ok: boolean;
  txId: string;
  newState?: string;
  replay?: boolean;
  fraudSignal?: string;
}

export interface ReplayStore {
  isProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, txId: string): Promise<void>;
}

export interface WompiClient {
  getTransaction(id: string): Promise<{
    id: string;
    status: string;
    payment_method: { extra?: { three_ds_authentication?: { authentication_value?: string } } };
  } | null>;
  /**
   * PR 7 — Issue a refund (closes OPL-CARD-014).
   * Returns { ok, wompiRefundId?, status?, error? }.
   * Does NOT throw on business failure — caller maps HTTP status.
   */
  refundTransaction(input: {
    wompiTransactionId: string;
    amountInCents?: number;
    reason?: string;
  }): Promise<{
    ok: boolean;
    wompiRefundId?: string;
    status?: string;
    amountInCents?: number;
    error?: string;
    httpStatus?: number;
  }>;
}

export interface ThreeDsVerifier {
  verify(
    wompiTxId: string,
    cacheTtlMs?: number,
  ): Promise<{ authenticated: boolean; authenticationValue?: string }>;
}

export interface EscrowMachine {
  transition(
    txId: string,
    event: string,
  ): Promise<{ txId: string; newState: string }>;
}

export interface CreditInput {
  userId: string;
  amountCop: number;
  idempotencyKey: string;
}

export interface CreditResult {
  userId: string;
  newBalanceCop: number;
  version: number;
}

export interface EscrowTransitionInput {
  txId: string;
  fromState: string;
  toState: string;
  idempotencyKey: string;
}

export interface EscrowTransitionResult {
  txId: string;
  fromState: string;
  toState: string;
  version: number;
}

export interface ReverseBonusInput {
  transactionId: string;
  idempotencyKey: string;
}

export interface WebhookGatewayDeps {
  eventsSecret: string;
  maxAgeMs: number; // default 5 * 60 * 1000
  replayStore: ReplayStore;
  escrowMachine: EscrowMachine;
  threeDsVerifier: ThreeDsVerifier;
  wompiClient: WompiClient;
  transactCredit: (input: CreditInput) => Promise<CreditResult>;
  transactTransition: (input: EscrowTransitionInput) => Promise<EscrowTransitionResult>;
  transactReverseBonus: (input: ReverseBonusInput) => Promise<void>;
  /** Optional: where to resolve user_id for crediting. For tests, inject directly. */
  resolveUserFromReference?: (reference: string) => Promise<string>;
  /** Optional: for tests, override the eventId derivation. */
  deriveEventId?: (event: WompiEvent) => string;
}

export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

export const ESCROW_EVENT_MAP: Record<WompiEventType, string> = {
  "transaction.approved": "WOMPI_APPROVED",
  "transaction.declined": "WOMPI_DECLINED",
  "transaction.reversed": "WOMPI_CHARGEBACK",
  "transaction.disputed": "BUYER_DISPUTE",
};

export const FRAUD_SIGNAL_3DS_NOT_VERIFIED = "3DS_NOT_VERIFIED";

export function defaultEventId(event: WompiEvent): string {
  // Wompi does not provide a unique event_id in the body. Derive a stable
  // key from (transaction_id + event_type) — duplicate deliveries of the
  // same logical event will collide on this key.
  return `${event.data.transaction.id}:${event.event}`;
}
