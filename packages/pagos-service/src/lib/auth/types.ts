/**
 * Auth types — shared between gateway, RBAC, and rate limiter.
 */

export type Role = "user" | "merchant" | "dpo" | "admin";

export type AuthMethod = "jwt" | "dev-bypass" | "webhook-signature";

export interface AuthContext {
  userId: string;
  email: string;
  groups: Role[];
  deviceId?: string;
  ip: string;
  authMethod: AuthMethod;
}

export interface RateLimiter {
  /**
   * Check (and atomically increment) a counter for the given key.
   * Returns allowed=false if the count exceeds max within the window.
   */
  check(key: string, max: number, windowMs: number): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
  }>;
}

export interface AuthGatewayDeps {
  jwtSecret: string;
  jwtAudience: string;
  jwtIssuer: string;
  rateLimiter: RateLimiter;
  /**
   * Injectable so tests can verify behavior. In production, pass
   * `isDevBypassEnabled` from dev-bypass.ts.
   */
  devBypassEnabled: () => boolean;
}
