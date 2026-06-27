import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferralEngine,
  type ReferralStore,
  type AntiFraudContext,
} from "../../src/lib/referrals.js";
import { InMemoryReferralMonthlyCounter } from "../../src/lib/referral-monthly-counter.js";
import type { ReferralStatus } from "../../src/db/tables.js";
import {
  DeviceDuplicateError,
  InvalidReferralCodeError,
  IpDuplicateError,
  SelfReferralError,
} from "../../src/lib/errors.js";

/**
 * Tests for ReferralEngine — referral code generation, qualification,
 * anti-fraud (self/IP/device duplicate), bonus firing.
 *
 * PR 2e update:
 *   - ReferralEngine requires monthlyCounter dep (closes OPL-LIB-009)
 *   - ReferralEngine requires anti-fraud context (closes OPL-CARD-010)
 *   - Errors are typed (not ad-hoc Error with .code string)
 */

class FakeReferralStore implements ReferralStore {
  private referrals: Array<{
    referrer_user_id: string;
    referee_user_id: string;
    referral_code: string;
    status: ReferralStatus;
    qualified_at?: string;
    bonus_paid_at?: string;
    bonus_amount_cop: number;
    reject_reason?: string;
    created_at: string;
  }> = [];
  private userCodes = new Map<string, string>();

  async getUserByCode(code: string): Promise<string | null> {
    for (const [uid, c] of this.userCodes.entries()) {
      if (c === code) return uid;
    }
    return null;
  }

  async getUserCode(userId: string): Promise<string | null> {
    return this.userCodes.get(userId) ?? null;
  }

  async setUserCode(userId: string, code: string): Promise<void> {
    this.userCodes.set(userId, code);
  }

  async createReferral(referral: any): Promise<void> {
    this.referrals.push(referral);
  }

  async getReferral(referrerId: string, refereeId: string) {
    return this.referrals.find(
      (r) => r.referrer_user_id === referrerId && r.referee_user_id === refereeId,
    ) ?? null;
  }

  async updateReferralStatus(
    referrerId: string,
    refereeId: string,
    status: ReferralStatus,
    qualifiedAt?: string,
  ): Promise<void> {
    const r = this.referrals.find(
      (r) => r.referrer_user_id === referrerId && r.referee_user_id === refereeId,
    );
    if (r) {
      r.status = status;
      if (qualifiedAt) r.qualified_at = qualifiedAt;
    }
  }

  async reverseReferralBonusesForTransaction(_transactionId: string): Promise<number> {
    return 0;
  }

  all() { return this.referrals; }
  reset() {
    this.referrals = [];
    this.userCodes.clear();
  }
}

const VALID_ANTI_FRAUD: AntiFraudContext = {
  refereeIp: "8.8.8.8",
  refereeDeviceId: "device-A",
  referrerIp: "1.1.1.1",
  referrerDeviceId: "device-B",
};

describe("referrals engine", () => {
  let store: FakeReferralStore;
  let engine: ReferralEngine;
  let referrerCode: string;

  beforeEach(async () => {
    store = new FakeReferralStore();
    const monthlyCounter = new InMemoryReferralMonthlyCounter();
    engine = new ReferralEngine({ store, monthlyCounter });
    referrerCode = await engine.generateCode("referrer-1");
  });

  describe("generateCode", () => {
    it("returns 8-character alphanumeric code", async () => {
      expect(referrerCode).toMatch(/^[A-Z0-9]{8}$/);
    });

    it("avoids ambiguous characters (no 0/O, no 1/I)", async () => {
      for (let i = 0; i < 100; i++) {
        const code = await engine.generateCode(`user-${i}`);
        expect(code).not.toMatch(/[0O1I]/);
      }
    });

    it("returns same code on second call (idempotent)", async () => {
      const c1 = await engine.generateCode("user-stable");
      const c2 = await engine.generateCode("user-stable");
      expect(c1).toBe(c2);
    });

    it("different users get different codes", async () => {
      const c1 = await engine.generateCode("user-1");
      const c2 = await engine.generateCode("user-2");
      expect(c1).not.toBe(c2);
    });

    it("throws on empty userId", async () => {
      await expect(engine.generateCode("")).rejects.toThrow();
    });
  });

  describe("acceptCode", () => {
    it("creates PENDING referral when valid code is accepted (with anti-fraud)", async () => {
      const result = await engine.acceptCode("referee-1", referrerCode, VALID_ANTI_FRAUD);
      expect(result.status).toBe("PENDING");
      expect(result.referrerUserId).toBe("referrer-1");
      expect(store.all()).toHaveLength(1);
    });

    it("rejects invalid code (no referrer found) via typed InvalidReferralCodeError", async () => {
      await expect(
        engine.acceptCode("referee-1", "INVALID", VALID_ANTI_FRAUD),
      ).rejects.toThrow(InvalidReferralCodeError);
    });

    it("rejects self-referral (same user) via typed SelfReferralError", async () => {
      const selfCode = await engine.generateCode("user-self");
      await expect(
        engine.acceptCode("user-self", selfCode, VALID_ANTI_FRAUD),
      ).rejects.toThrow(SelfReferralError);
    });

    it("rejects duplicate referral (same referee + referrer)", async () => {
      await engine.acceptCode("referee-dup-1", referrerCode, VALID_ANTI_FRAUD);
      await expect(
        engine.acceptCode("referee-dup-1", referrerCode, VALID_ANTI_FRAUD),
      ).rejects.toThrow();
    });

    it("rejects IP duplicate (referrer + referee share IP) via typed IpDuplicateError", async () => {
      const antiFraud: AntiFraudContext = {
        refereeIp: "1.2.3.4",
        refereeDeviceId: "device-A",
        referrerIp: "1.2.3.4",
        referrerDeviceId: "device-B",
      };
      await expect(
        engine.acceptCode("referee-ip-1", referrerCode, antiFraud),
      ).rejects.toThrow(IpDuplicateError);
    });

    it("rejects device duplicate (referrer + referee share device) via typed DeviceDuplicateError", async () => {
      const antiFraud: AntiFraudContext = {
        refereeIp: "8.8.8.8",
        refereeDeviceId: "same-device",
        referrerIp: "1.1.1.1",
        referrerDeviceId: "same-device",
      };
      await expect(
        engine.acceptCode("referee-dev-1", referrerCode, antiFraud),
      ).rejects.toThrow(DeviceDuplicateError);
    });

    it("allows referral when no anti-fraud context provided → MissingAntiFraudContext (closes OPL-CARD-010)", async () => {
      // PR 2e changed behavior: antiFraud is now REQUIRED.
      // Previously: defer check. Now: throw 400.
      await expect(
        engine.acceptCode("referee-noaf", referrerCode),
      ).rejects.toThrow(/anti-?fraud/i);
    });
  });

  describe("qualifyOnAction", () => {
    it("sets status QUALIFIED on first purchase", async () => {
      await engine.acceptCode("referee-qp-1", referrerCode, VALID_ANTI_FRAUD);
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-qp-1",
        action: "FIRST_PURCHASE",
      });
      expect(result.qualified).toBe(true);
      const r = store.all()[0];
      expect(r.status).toBe("QUALIFIED");
      expect(r.qualified_at).toBeDefined();
    });

    it("sets status QUALIFIED on first incoming payment > $10k COP", async () => {
      await engine.acceptCode("referee-qi-1", referrerCode, VALID_ANTI_FRAUD);
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-qi-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 50_000,
      });
      expect(result.qualified).toBe(true);
    });

    it("does NOT qualify on small incoming payment (< $10k)", async () => {
      await engine.acceptCode("referee-qs-1", referrerCode, VALID_ANTI_FRAUD);
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-qs-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 5_000,
      });
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe("AMOUNT_BELOW_THRESHOLD");
    });

    it("is idempotent (qualifying twice does not re-fire)", async () => {
      await engine.acceptCode("referee-qi-2", referrerCode, VALID_ANTI_FRAUD);
      const r1 = await engine.qualifyOnAction({
        refereeUserId: "referee-qi-2",
        action: "FIRST_PURCHASE",
      });
      expect(r1.qualified).toBe(true);

      const r2 = await engine.qualifyOnAction({
        refereeUserId: "referee-qi-2",
        action: "FIRST_PURCHASE",
      });
      expect(r2.qualified).toBe(false);
      expect(r2.alreadyQualified).toBe(true);
    });

    it("returns NOT_QUALIFIED when no PENDING referral exists for referee", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "no-referral-user",
        action: "FIRST_PURCHASE",
      });
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe("NO_PENDING_REFERRAL");
    });
  });

  describe("qualification threshold for incoming payments", () => {
    it("qualifies at exactly $10k (boundary inclusive)", async () => {
      await engine.acceptCode("referee-bdry", referrerCode, VALID_ANTI_FRAUD);
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-bdry",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 10_000,
      });
      expect(result.qualified).toBe(true);
    });

    it("does NOT qualify at $9,999 (boundary exclusive)", async () => {
      await engine.acceptCode("referee-justunder", referrerCode, VALID_ANTI_FRAUD);
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-justunder",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 9_999,
      });
      expect(result.qualified).toBe(false);
    });
  });

  describe("input validation", () => {
    it("throws on empty refereeUserId", async () => {
      await expect(
        engine.acceptCode("", "ANYCODE", VALID_ANTI_FRAUD),
      ).rejects.toThrow();
    });

    it("throws on empty code", async () => {
      await expect(
        engine.acceptCode("user-1", "", VALID_ANTI_FRAUD),
      ).rejects.toThrow();
    });
  });
});
