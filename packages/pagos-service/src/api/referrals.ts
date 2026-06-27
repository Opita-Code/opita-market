import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { InvalidReferralCodeError, SelfReferralError, IpDuplicateError, DeviceDuplicateError } from "../lib/errors.js";
import { getAppContext } from "./index.js";
import { ReferralEngine } from "../lib/referrals.js";

export const referrals = new Hono();

// ─── GET /v1/referrals/code ───────────────────────────────────────────────

referrals.get("/code", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const engine = new ReferralEngine({ store: makeStore(ctx), monthlyCounter: ctx.referralMonthlyCounter });
  const code = await engine.generateCode(user.email);
  return c.json({ user_id: user.email, referral_code: code });
});

// ─── POST /v1/referrals/create ────────────────────────────────────────────

referrals.post("/create", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const body = await c.req.json();
  const code = String(body?.referral_code ?? "");

  const engine = new ReferralEngine({ store: makeStore(ctx), monthlyCounter: ctx.referralMonthlyCounter });
  try {
    const result = await engine.acceptCode(
      user.email,
      code,
      {
        refereeIp: user.ip,
        refereeDeviceId: user.deviceId,
        // PR 8: look up referrer's IP/device from session history
      },
    );
    return c.json(result);
  } catch (e: any) {
    if (e.code === "INVALID_CODE") return c.json({ error_code: e.code }, 422);
    if (e.code === "SELF_REFERRAL") return c.json({ error_code: e.code }, 422);
    if (e.code === "IP_DUPLICATE") return c.json({ error_code: e.code }, 422);
    if (e.code === "DEVICE_DUPLICATE") return c.json({ error_code: e.code }, 422);
    if (e.code === "MISSING_ANTI_FRAUD_CONTEXT") return c.json({ error_code: e.code }, 400);
    if (e.code === "MONTHLY_REFERRAL_LIMIT_EXCEEDED") return c.json({ error_code: e.code }, 422);
    throw e;
  }
});

function makeStore(ctx: any): any {
  return {
    getUserByCode: async () => null, // PR 8 wires to DynamoDB
    getUserCode: async () => null,
    setUserCode: async () => {},
    createReferral: async () => {},
    getReferral: async () => null,
    updateReferralStatus: async () => {},
    reverseReferralBonusesForTransaction: async () => 0,
  };
}