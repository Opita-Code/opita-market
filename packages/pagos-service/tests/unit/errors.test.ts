import { describe, it, expect } from "vitest";
import {
  OpitaPagosError,
  TierLimitExceededError,
  InsufficientBalanceError,
  IdempotencyKeyReusedError,
  FraudBlockedError,
  InternalError,
  WithdrawHoldNotElapsedError,
  AmountInvalidError,
  ChannelNotAllowedError,
  UnauthenticatedError,
  ForbiddenNotDpoError,
  FraudReviewQueuedError,
  MissingRequirementsError,
  DisputeWindowClosedError,
  EvidenceRequiredError,
  InvalidStateError,
  SelfReferralError,
  InvalidReferralCodeError,
  IpDuplicateError,
  DeviceDuplicateError,
  InvalidSignatureError,
} from "../../src/lib/errors.js";

describe("OpitaPagosError (typed errors)", () => {
  describe("base class", () => {
    it("extends Error with constructor name", () => {
      const e = new TierLimitExceededError("exceeded", 0, 500000, 1000000);
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(OpitaPagosError);
      expect(e.name).toBe("TierLimitExceededError");
      expect(e.code).toBe("TIER_LIMIT_EXCEEDED");
      expect(e.httpStatus).toBe(422);
    });

    it("safeMessage hides details by default (exposeMessage=false)", () => {
      const e = new InsufficientBalanceError("balance 100, requested 1000", 100, 1000);
      expect(e.exposeMessage).toBe(false);
      expect(e.safeMessage).toBe("INSUFFICIENT_BALANCE"); // code only
      expect(e.safeMessage).not.toContain("100");           // does NOT leak balance
    });

    it("safeMessage exposes details when exposeMessage=true", () => {
      const e = new TierLimitExceededError("exceeded limit", 0, 500000, 1000000);
      expect(e.exposeMessage).toBe(true);
      expect(e.safeMessage).toBe("exceeded limit");
    });

    it("IdempotencyKeyReusedError does NOT leak transaction_id to client", () => {
      const e = new IdempotencyKeyReusedError("reused", "tx-secret-123");
      expect(e.exposeMessage).toBe(false);
      expect(e.safeMessage).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(e.safeMessage).not.toContain("tx-secret");
    });

    it("FraudBlockedError does NOT leak signals to client", () => {
      const e = new FraudBlockedError("blocked", [{ type: "TOR_EXIT", weight: 1.0 }]);
      expect(e.exposeMessage).toBe(false);
      expect(e.safeMessage).toBe("FRAUD_BLOCKED");
      expect(e.safeMessage).not.toContain("TOR_EXIT");
    });
  });

  describe("context properties", () => {
    it("TierLimitExceededError carries tier + limit + attempted amounts", () => {
      const e = new TierLimitExceededError("exceeded", 2, 20_000_000, 25_000_000);
      expect(e.currentTier).toBe(2);
      expect(e.limitCop).toBe(20_000_000);
      expect(e.attemptedCop).toBe(25_000_000);
    });

    it("WithdrawHoldNotElapsedError carries availableAt + hoursRemaining", () => {
      const e = new WithdrawHoldNotElapsedError(
        "hold not elapsed",
        "2026-06-27T10:00:00Z",
        18,
      );
      expect(e.availableAtIso).toBe("2026-06-27T10:00:00Z");
      expect(e.hoursRemaining).toBe(18);
    });

    it("FraudBlockedError carries signal details for internal logging (not exposed)", () => {
      const e = new FraudBlockedError("blocked", [
        { type: "VELOCITY_EXCEEDED", weight: 0.6 },
        { type: "TOR_EXIT", weight: 1.0 },
      ]);
      expect(e.signals).toEqual([
        { type: "VELOCITY_EXCEEDED", weight: 0.6 },
        { type: "TOR_EXIT", weight: 1.0 },
      ]);
    });
  });

  describe("stack trace", () => {
    it("captures stack at caller (not at base class)", () => {
      const fn = () => new InternalError("boom");
      const e = fn();
      expect(e.stack).toBeDefined();
      expect(e.stack).toContain("errors.test.ts");
    });
  });

  describe("every error class has correct code + httpStatus + name", () => {
    const cases: Array<{
      name: string;
      ctor: () => OpitaPagosError;
      expectedCode: string;
      expectedStatus: number;
      expectedSafeCodeOnly: boolean; // safeMessage should equal code
    }> = [
      { name: "AmountInvalidError",          ctor: () => new AmountInvalidError("x"),             expectedCode: "AMOUNT_INVALID",          expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "ChannelNotAllowedError",      ctor: () => new ChannelNotAllowedError("x"),         expectedCode: "CHANNEL_NOT_ALLOWED",    expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "UnauthenticatedError",        ctor: () => new UnauthenticatedError(),               expectedCode: "UNAUTHENTICATED",        expectedStatus: 401, expectedSafeCodeOnly: true },
      { name: "ForbiddenNotDpoError",        ctor: () => new ForbiddenNotDpoError(),               expectedCode: "FORBIDDEN_NOT_DPO",      expectedStatus: 403, expectedSafeCodeOnly: true },
      { name: "FraudReviewQueuedError",      ctor: () => new FraudReviewQueuedError("x"),         expectedCode: "FRAUD_REVIEW_QUEUED",    expectedStatus: 202, expectedSafeCodeOnly: true },
      { name: "MissingRequirementsError",    ctor: () => new MissingRequirementsError("x", ["a"]), expectedCode: "MISSING_REQUIREMENTS",  expectedStatus: 422, expectedSafeCodeOnly: false },
      { name: "DisputeWindowClosedError",    ctor: () => new DisputeWindowClosedError("x"),      expectedCode: "DISPUTE_WINDOW_CLOSED",  expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "EvidenceRequiredError",       ctor: () => new EvidenceRequiredError("x"),         expectedCode: "EVIDENCE_REQUIRED",      expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "InvalidStateError",           ctor: () => new InvalidStateError("x"),             expectedCode: "INVALID_STATE",          expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "SelfReferralError",           ctor: () => new SelfReferralError(),                expectedCode: "SELF_REFERRAL",          expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "InvalidReferralCodeError",    ctor: () => new InvalidReferralCodeError(),         expectedCode: "INVALID_CODE",           expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "IpDuplicateError",            ctor: () => new IpDuplicateError(),                 expectedCode: "IP_DUPLICATE",           expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "DeviceDuplicateError",        ctor: () => new DeviceDuplicateError(),             expectedCode: "DEVICE_DUPLICATE",       expectedStatus: 422, expectedSafeCodeOnly: true },
      { name: "InvalidSignatureError",       ctor: () => new InvalidSignatureError(),            expectedCode: "INVALID_SIGNATURE",      expectedStatus: 401, expectedSafeCodeOnly: true },
      { name: "InternalError",               ctor: () => new InternalError("x"),                 expectedCode: "INTERNAL_ERROR",         expectedStatus: 500, expectedSafeCodeOnly: true },
    ];

    for (const c of cases) {
      it(`${c.name} has code=${c.expectedCode} status=${c.expectedStatus}`, () => {
        const e = c.ctor();
        expect(e).toBeInstanceOf(OpitaPagosError);
        expect(e.code).toBe(c.expectedCode);
        expect(e.httpStatus).toBe(c.expectedStatus);
        expect(e.name).toBe(c.name);
        if (c.expectedSafeCodeOnly) {
          expect(e.safeMessage).toBe(c.expectedCode);
        }
      });
    }
  });
});