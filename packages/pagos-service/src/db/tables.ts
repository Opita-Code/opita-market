/**
 * DynamoDB table schemas for Opita Pagos.
 *
 * Seven tables (clean domain separation, NOT single-table). For rationale see
 * `openspec/changes/opita-pagos-foundation/design.md` ADR-002.
 *
 * Tables:
 *   - MarketWallets:       pk=user_id, balance_cop, balance_coins, tier, kyc_state
 *   - MarketLedger:        pk=user_id, sk=ts_seq, append-only movements
 *   - MarketTransactions:  pk=transaction_id, intent, channel, status, idempotency_key
 *   - MarketReferrals:     pk=referrer_user_id, sk=referee_user_id, status, bonus
 *   - MarketBonuses:       pk=user_id, sk=rule_id#ts, applied rules with cooldown
 *   - IpGeoCache:          pk=ip, geo + proxy/vpn/tor flags, TTL 7d
 *   - FraudSignals:        pk=signal_id, ts, user_id, signal_type, decision, TTL 30d
 */

export type LedgerMovementType =
  | "DEPOSITO"
  | "RETIRO"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "BONUS"
  | "COMISION"
  | "REFUND";

export type TransactionChannel =
  | "WOMPI_CARD"
  | "WOMPI_BREB"
  | "WOMPI_PSE"
  | "WOMPI_NEQUI"
  | "WOMPI_DAVIPLATA"
  | "INTERNAL_TRANSFER";

export type TransactionStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "VOIDED"
  | "REFUNDED"
  | "ERROR";

export type EscrowState = "NONE" | "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED";

export type KycState = "INCOMPLETE" | "PENDING" | "VERIFIED" | "REJECTED";

export type ReferralStatus = "PENDING" | "QUALIFIED" | "PAID" | "REJECTED";

export type KycTier = 0 | 1 | 2 | 3 | 4;

export interface MarketWallet {
  user_id: string;
  balance_cop: number;
  balance_coins: number;
  tier: KycTier;
  kyc_state: KycState;
  referral_code: string;
  last_activity_at: string;
  lifetime_received_cop: number;
  lifetime_withdrawn_cop: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface MarketLedgerEntry {
  user_id: string;
  ts_seq: string;
  movement: LedgerMovementType;
  amount_cop: number;
  balance_after_cop: number;
  transaction_id?: string;
  bonus_rule_id?: string;
  metadata?: Record<string, string | number | boolean>;
  /**
   * PR 7 — Held-until timestamp for DEPOSITO entries (Decreto 222/2020 Art. 4).
   * Set to created_at + 5 days on DEPOSITO. Withdrawal flow uses
   * `getOldestUnreleasedDeposit()` to find the binding constraint.
   * `released=true` flag overrides held_until (manually released by DPO).
   */
  held_until?: string;
  released?: boolean;
  released_at?: string;
}

export interface MarketTransaction {
  transaction_id: string;
  wompi_tx_id?: string;
  intent: "PAYMENT" | "WITHDRAWAL" | "TRANSFER" | "REFUND";
  channel: TransactionChannel;
  status: TransactionStatus;
  amount_cop: number;
  reference: string;
  idempotency_key: string;
  idempotency_key_hash: string;
  from_user_id?: string;
  to_user_id?: string;
  wompi_payment_method?: string;
  product_context?: {
    kind: "LOBBY_BOOST" | "TENANT_PLAN" | "MARKETPLACE_ORDER" | "P2P_TRANSFER";
    ref_id: string;
  };
  escrow_state: EscrowState;
  escrow_released_at?: string;
  dispute_window_ends_at?: string;
  webhook_events?: Array<{ event: string; received_at: string; status: string }>;
  fraud_signals?: string[];
  created_at: string;
  updated_at: string;
  version: number;
}

export interface MarketReferral {
  referrer_user_id: string;
  referee_user_id: string;
  referral_code: string;
  status: ReferralStatus;
  qualified_at?: string;
  bonus_paid_at?: string;
  bonus_amount_cop: number;
  reject_reason?: string;
  created_at: string;
}

export type BonusRuleId =
  | "WELCOME_CELL_VERIFIED"
  | "EMAIL_VERIFIED"
  | "PROFILE_COMPLETED"
  | "NIT_VERIFIED"
  | "KYC_COMPLETED"
  | "FIRST_PURCHASE_CASHBACK"
  | "PURCHASE_CASHBACK"
  | "SELLER_FIRST_SALE"
  | "SELLER_REPEAT_SALE"
  | "REVIEW_LEFT"
  | "REFERRAL_QUALIFIED"
  | "REFERRAL_SIGNED_UP"
  | "DAILY_LOGIN"
  | "STREAK_7_DAYS"
  | "STREAK_30_DAYS"
  | "BIRTHDAY"
  | "ANNIVERSARY"
  | "RURAL_HUILA_CHALLENGE"
  | "BLACK_FRIDAY_OPITA"
  | "TIER_PROMOTION_BONUS";

export interface MarketBonus {
  user_id: string;
  rule_ts: string;
  rule_id: BonusRuleId;
  applied: boolean;
  amount_cop: number;
  multiplier: number;
  cooldown_until?: string;
  context: string;
  transaction_id?: string;
  reversed: boolean;
  reversed_at?: string;
  created_at: string;
}

export type IpGeoSource =
  | "MAXMIND"
  | "IP2PROXY"
  | "IP_API"
  | "RIPESTAT"
  | "TOR_LIST"
  | "ABUSEIPDB"
  | "TEAMCYMRU";

export interface IpGeoCache {
  ip: string;
  country_iso: string;
  country_name: string;
  region: string;
  city: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  asn: number;
  asn_org: string;
  isp: string;
  is_proxy: boolean;
  is_vpn: boolean;
  is_tor: boolean;
  is_datacenter: boolean;
  is_mobile: boolean;
  confidence: number;
  source: IpGeoSource;
  cached_at: string;
  expires_at: number;
}

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
  signal_id: string;
  ts: string;
  user_id: string;
  ip_hash: string;
  device_id?: string;
  signal_type: FraudSignalType;
  weight: number;
  context: Record<string, string | number | boolean>;
  acted_on: boolean;
  decision: FraudDecision;
  expires_at: number;
}