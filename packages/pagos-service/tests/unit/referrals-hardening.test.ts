import { describe, it, expect } from "vitest";
import { ReferralEngine, type ReferralStore } from "../../src/lib/referrals.js";
import { InMemoryReferralMonthlyCounter, type ReferralMonthlyCounter } from "../../src/lib/referral-monthly-counter.js";
import type { ReferralStatus } from "../../src/db/tables.js";

/**
 * Tests for PR 2e — Referral hardening.
 *
 * Closes:
 *   - OPL-LIB-009 (max 10 referrals per month per referrer)
 *   - OPL-CARD-010 (anti-fraud context REQUIRED — no silent pass)
 *
 * Spec: openspec/changes/pre-deploy-remediation/specs/bonus-atomicity/spec.md
 */

class FakeReferralStore implements ReferralStore {
  private referrals: any[] = [];
  private userCodes = new Map<string, string>();

  async getUserByCode(code: string) {
    for (const [uid, c] of this.userCodes.entries()) {
      if (c === code) return uid;
    }
    return null;
  }
  async getUserCode(userId: string) { return this.userCodes.get(userId) ?? null; }
  async setUserCode(userId: string, code: string) { this.userCodes.set(userId, code); }
  async createReferral(referral: any) { this.referrals.push(referral); }
  async getReferral(referrerId: string, refereeId: string) {
    return this.referrals.find(
      (r) => r.referrer_user_id === referrerId && r.referee_user_id === refereeId,
    ) ?? null;
  }
  async updateReferralStatus(referrerId: string, refereeId: string, status: ReferralStatus, qualifiedAt?: string) {
    const r = this.referrals.find(
      (r) => r.referrer_user_id === referrerId && r.referee_user_id === refereeId,
    );
    if (r) {
      r.status = status;
      if (qualifiedAt) r.qualified_at = qualifiedAt;
    }
  }
  async reverseReferralBonusesForTransaction(_txId: string) { return 0; }

  // Helpers
  setCode(userId: string, code: string) { this.userCodes.set(userId, code); }
  reset() { this.referrals = []; this.userCodes.clear(); }
}

function makeEngine(opts: { now?: () => Date; counter?: ReferralMonthlyCounter } = {}) {
  const store = new FakeReferralStore();
  const counter = opts.counter ?? new InMemoryReferralMonthlyCounter();
  const engine = new ReferralEngine({ store, monthlyCounter: counter, now: opts.now });
  return { engine, store, counter };
}

const VALID_ANTI_FRAUD = {
  refereeIp: "8.8.8.8",
  refereeDeviceId: "device-aaa",
  referrerIp: "1.1.1.1",
  referrerDeviceId: "device-bbb",
};

describe("PR 2e — anti-fraud context REQUIRED (closes OPL-CARD-010)", () => {
  it("throws when antiFraud is undefined", async () => {
    const { engine, store } = makeEngine();
    store.setCode("referrer-1", "CODE1234");
    await expect(
      engine.acceptCode("referee-1", "CODE1234"),
    ).rejects.toThrow(/anti-?fraud/i);
  });

  it("throws when antiFraud is missing required field (refereeIp)", async () => {
    const { engine, store } = makeEngine();
    store.setCode("referrer-1", "CODE1234");
    await expect(
      engine.acceptCode("referee-1", "CODE1234", {
        refereeDeviceId: "device-aaa",
        referrerIp: "1.1.1.1",
        referrerDeviceId: "device-bbb",
      } as any),
    ).rejects.toThrow(/anti-?fraud/i);
  });

  it("throws when antiFraud has empty strings", async () => {
    const { engine, store } = makeEngine();
    store.setCode("referrer-1", "CODE1234");
    await expect(
      engine.acceptCode("referee-1", "CODE1234", {
        refereeIp: "",
        refereeDeviceId: "device-aaa",
        referrerIp: "1.1.1.1",
        referrerDeviceId: "device-bbb",
      }),
    ).rejects.toThrow(/anti-?fraud/i);
  });

  it("accepts when antiFraud has all 4 required fields", async () => {
    const { engine, store } = makeEngine();
    store.setCode("referrer-1", "CODE1234");
    const r = await engine.acceptCode("referee-1", "CODE1234", VALID_ANTI_FRAUD);
    expect(r.status).toBe("PENDING");
    expect(r.referrerUserId).toBe("referrer-1");
  });
});

describe("PR 2e — monthly referral cap (closes OPL-LIB-009)", () => {
  it("allows up to 10 referrals in a month", async () => {
    const fakeNow = { current: new Date("2026-06-15T10:00:00Z").getTime() };
    const { engine, store } = makeEngine({ now: () => new Date(fakeNow.current) });
    store.setCode("referrer-1", "CODE1234");

    for (let i = 0; i < 10; i++) {
      const r = await engine.acceptCode(`referee-${i}`, "CODE1234", {
        ...VALID_ANTI_FRAUD,
        refereeIp: `10.0.0.${i}`,  // different IP per referee
      });
      expect(r.status).toBe("PENDING");
    }
  });

  it("throws MONTHLY_REFERRAL_LIMIT_EXCEEDED on 11th referral", async () => {
    const fakeNow = { current: new Date("2026-06-15T10:00:00Z").getTime() };
    const { engine, store } = makeEngine({ now: () => new Date(fakeNow.current) });
    store.setCode("referrer-1", "CODE1234");

    for (let i = 0; i < 10; i++) {
      await engine.acceptCode(`referee-${i}`, "CODE1234", {
        ...VALID_ANTI_FRAUD,
        refereeIp: `10.0.0.${i}`,
      });
    }

    // 11th: different IP, same referrer
    await expect(
      engine.acceptCode("referee-10", "CODE1234", {
        ...VALID_ANTI_FRAUD,
        refereeIp: "10.0.0.99",
      }),
    ).rejects.toThrow(/monthly/i);
  });

  it("different referrers have independent monthly caps", async () => {
    const fakeNow = { current: new Date("2026-06-15T10:00:00Z").getTime() };
    const { engine, store } = makeEngine({ now: () => new Date(fakeNow.current) });
    store.setCode("referrer-A", "CODEAAAA");
    store.setCode("referrer-B", "CODEBBBB");

    // referrer-A: 10 referrals
    for (let i = 0; i < 10; i++) {
      await engine.acceptCode(`refA-${i}`, "CODEAAAA", {
        ...VALID_ANTI_FRAUD,
        refereeIp: `172.16.0.${i}`,
      });
    }
    // referrer-A: 11th blocked
    await expect(
      engine.acceptCode("refA-10", "CODEAAAA", {
        ...VALID_ANTI_FRAUD,
        refereeIp: "172.16.0.99",
      }),
    ).rejects.toThrow(/monthly/i);

    // referrer-B: still has full quota
    const r = await engine.acceptCode("refB-0", "CODEBBBB", {
      ...VALID_ANTI_FRAUD,
      refereeIp: "203.0.113.1",
    });
    expect(r.status).toBe("PENDING");
  });

  it("cap resets on new month", async () => {
    const fakeNow = { current: new Date("2026-06-15T10:00:00Z").getTime() };
    const { engine, store } = makeEngine({ now: () => new Date(fakeNow.current) });
    store.setCode("referrer-1", "CODE1234");

    // June: 10 referrals
    for (let i = 0; i < 10; i++) {
      await engine.acceptCode(`ref-${i}`, "CODE1234", {
        ...VALID_ANTI_FRAUD,
        refereeIp: `8.8.4.${i}`,
      });
    }
    await expect(
      engine.acceptCode("ref-10", "CODE1234", {
        ...VALID_ANTI_FRAUD,
        refereeIp: "8.8.4.99",
      }),
    ).rejects.toThrow(/monthly/i);

    // Move to July: reset
    fakeNow.current = new Date("2026-07-01T10:00:00Z").getTime();
    const r = await engine.acceptCode("ref-jul", "CODE1234", {
      ...VALID_ANTI_FRAUD,
      refereeIp: "1.0.0.1",
    });
    expect(r.status).toBe("PENDING");
  });
});
