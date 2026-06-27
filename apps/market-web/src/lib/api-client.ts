/**
 * Typed API client for PagosAPI.
 *
 * Uses the browser's native fetch (no axios, no SWR for PR 7 — keep deps small).
 * Components pass cookies automatically via `credentials: "include"`.
 *
 * PR 3 — closes MW-FE-005: state-mutating requests now send X-CSRF-Token
 * header (double-submit cookie pattern). Backend validates the token
 * matches the __csrf-token cookie using constant-time comparison.
 */

import {
  CSRF_HEADER_NAME,
  readCsrfTokenFromCookie,
} from "./csrf-token";

const DEFAULT_BASE_URL = "https://api.opitacode.com/pagos";
const LOCAL_BASE_URL = "http://localhost:8080";

function getBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return LOCAL_BASE_URL;
  }
  return DEFAULT_BASE_URL;
}

/** Methods that mutate state — require CSRF token. */
const STATE_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Read CSRF token from browser cookies (if state-mutating request). */
function getCsrfHeader(method: string): Record<string, string> {
  if (!STATE_MUTATING_METHODS.has(method.toUpperCase())) return {};
  if (typeof document === "undefined") return {};
  const cookieHeader = document.cookie || null;
  const token = readCsrfTokenFromCookie(cookieHeader);
  if (!token) return {};
  return { [CSRF_HEADER_NAME]: token };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IntentRequest {
  amount_cop: number;
  channel: "WOMPI_CARD" | "WOMPI_BREB" | "WOMPI_PSE" | "WOMPI_NEQUI" | "WOMPI_DAVIPLATA";
  from_user_id: string;
  to_user_id: string;
  product_context: { kind: string; ref_id: string };
  idempotency_key: string;
  device_id?: string;
}

export interface IntentResponse {
  transaction_id: string;
  reference: string;
  amount_in_cents: number;
  currency: "COP";
  public_key: string;
  integrity_signature: string;
  requires_3ds: boolean;
  expires_at: string;
}

export interface BalanceResponse {
  user_id: string;
  balance_cop: number;
  tier: 0 | 1 | 2 | 3 | 4;
  kyc_state: "INCOMPLETE" | "PENDING" | "VERIFIED" | "REJECTED";
  trust_badge: string | null;
  receive_limit_day_cop: number;
  withdraw_limit_day_cop: number;
  withdraw_hold_hours: number;
}

export interface TierResponse {
  user_id: string;
  current_tier: 0 | 1 | 2 | 3 | 4;
  current_tier_name: string;
  trust_badge: string | null;
  progress_to_next_tier: {
    target_tier: 1 | 2 | 3 | 4;
    unmet_requirements: string[];
    next_tier_benefits: string[];
  } | null;
}

export interface ReferralCodeResponse {
  user_id: string;
  referral_code: string;
}

export interface ApiError {
  error_code: string;
  message?: string;
}

// ─── Fetch helper ───────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const method = (init.method ?? "GET").toString();
  // PR 3 — include CSRF token on state-mutating requests
  const csrfHeaders = getCsrfHeader(method);
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let body: ApiError = { error_code: "UNKNOWN_ERROR" };
    try { body = await response.json(); } catch { /* ignore */ }
    throw new ApiClientError(response.status, body.error_code, body.message ?? body.error_code);
  }

  return (await response.json()) as T;
}

// ─── Typed endpoints ─────────────────────────────────────────────────────────

export const apiClient = {
  /** POST /v1/payments/intent */
  createPaymentIntent(body: IntentRequest): Promise<IntentResponse> {
    return request<IntentResponse>("/v1/payments/intent", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** GET /v1/wallet/:user/balance */
  getBalance(userId: string): Promise<BalanceResponse> {
    return request<BalanceResponse>(`/v1/wallet/${encodeURIComponent(userId)}/balance`);
  },

  /** POST /v1/wallet/:user/withdraw */
  withdraw(userId: string, body: {
    amount_cop: number;
    destination: { kind: "BREB"; phone: string };
  }): Promise<{ withdrawal_id: string; status: string; available_at: string }> {
    return request(`/v1/wallet/${encodeURIComponent(userId)}/withdraw`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** GET /v1/tier/:user */
  getTier(userId: string): Promise<TierResponse> {
    return request<TierResponse>(`/v1/tier/${encodeURIComponent(userId)}`);
  },

  /** GET /v1/referrals/code */
  getReferralCode(userId: string): Promise<ReferralCodeResponse> {
    return request<ReferralCodeResponse>(`/v1/referrals/code?user_id=${encodeURIComponent(userId)}`);
  },
};