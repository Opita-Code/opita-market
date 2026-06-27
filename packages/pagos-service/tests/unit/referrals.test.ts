import { describe, it, expect, beforeEach } from "vitest";
import {
  ReferralEngine,
  type ReferralStore,
  type AntiFraudContext,
} from "../../src/lib/referrals.js";
import type { ReferralStatus } from "../../src/db/tables.js";

/**
 * Tests for ReferralEngine — referral code generation, qualification,
 * anti-fraud (self/IP/device duplicate), bonus firing.
 *
 * Decoupled from DynamoDB via ReferralStore (mocked here).
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
  private userCodes = new Map<string, string>(); // userId → code

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

  async reverseReferralBonusesForTransaction(transactionId: string): Promise<number> {
    return 0; // stub for PR 4 — real impl in PR 6
  }

  // Test helpers
  all() { return this.referrals; }
  reset() {
    this.referrals = [];
    this.userCodes.clear();
  }
}

describe("referrals engine", () => {
  let store: FakeReferralStore;
  let engine: ReferralEngine;
  let referrerCode: string;

  beforeEach(async () => {
    store = new FakeReferralStore();
    engine = new ReferralEngine({ store });
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
    it("creates PENDING referral when valid code is accepted", async () => {
      const result = await engine.acceptCode("referee-1", referrerCode);
      expect(result.status).toBe("PENDING");
      expect(result.referrerUserId).toBe("referrer-1");
      expect(store.all()).toHaveLength(1);
    });

    it("rejects invalid code (no referrer found)", async () => {
      try {
        await engine.acceptCode("referee-1", "INVALID");
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as Error & { code?: string }).code).toBe("INVALID_CODE");
      }
    });

    it("rejects self-referral (same user)", async () => {
      const selfCode = await engine.generateCode("user-self");
      try {
        await engine.acceptCode("user-self", selfCode);
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as Error & { code?: string }).code).toBe("SELF_REFERRAL");
      }
    });

    it("rejects duplicate referral (same referee + referrer)", async () => {
      await engine.acceptCode("referee-1", referrerCode);
      await expect(
        engine.acceptCode("referee-1", referrerCode),
      ).rejects.toThrow();
    });

    it("rejects IP duplicate (referrer + referee share IP)", async () => {
      const antiFraud: AntiFraudContext = {
        refereeIp: "1.2.3.4",
        refereeDeviceId: "device-A",
        referrerIp: "1.2.3.4",
        referrerDeviceId: "device-B",
      };
      try {
        await engine.acceptCode("referee-1", referrerCode, antiFraud);
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as Error & { code?: string }).code).toBe("IP_DUPLICATE");
      }
    });

    it("rejects device duplicate (same device_id)", async () => {
      const antiFraud: AntiFraudContext = {
        refereeIp: "5.6.7.8",
        refereeDeviceId: "device-X",
        referrerIp: "9.10.11.12",
        referrerDeviceId: "device-X",
      };
      try {
        await engine.acceptCode("referee-1", referrerCode, antiFraud);
        expect.fail("should have thrown");
      } catch (e) {
        expect((e as Error & { code?: string }).code).toBe("DEVICE_DUPLICATE");
      }
    });

    it("allows referral when no anti-fraud context provided (defers check)", async () => {
      const result = await engine.acceptCode("referee-1", referrerCode);
      expect(result.status).toBe("PENDING");
    });
  });

  describe("qualifyOnAction", () => {
    beforeEach(async () => {
      await engine.acceptCode("referee-1", referrerCode);
    });

    it("sets status QUALIFIED on first purchase", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-1",
        action: "FIRST_PURCHASE",
      });
      expect(result.qualified).toBe(true);
      const referral = store.all()[0];
      expect(referral.status).toBe("QUALIFIED");
      expect(referral.qualified_at).toBeDefined();
    });

    it("sets status QUALIFIED on first incoming payment > $10k COP", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 50_000,
      });
      expect(result.qualified).toBe(true);
    });

    it("does NOT qualify on small incoming payment (< $10k)", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 5_000,
      });
      expect(result.qualified).toBe(false);
    });

    it("is idempotent (qualifying twice does not re-fire)", async () => {
      await engine.qualifyOnAction({ refereeUserId: "referee-1", action: "FIRST_PURCHASE" });
      const second = await engine.qualifyOnAction({ refereeUserId: "referee-1", action: "FIRST_PURCHASE" });
      expect(second.qualified).toBe(false);
    });

    it("returns NOT_QUALIFIED when no PENDING referral exists for referee", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "unknown-user",
        action: "FIRST_PURCHASE",
      });
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe("NO_PENDING_REFERRAL");
    });
  });

  describe("qualification threshold for incoming payments", () => {
    beforeEach(async () => {
      await engine.acceptCode("referee-1", referrerCode);
    });

    it("qualifies at exactly $10k (boundary inclusive)", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 10_000,
      });
      expect(result.qualified).toBe(true);
    });

    it("does NOT qualify at $9,999", async () => {
      const result = await engine.qualifyOnAction({
        refereeUserId: "referee-1",
        action: "FIRST_INCOMING_PAYMENT",
        amountCop: 9_999,
      });
      expect(result.qualified).toBe(false);
    });
  });
});