import { Hono } from "hono";
import { requireUser } from "../lib/auth.js";
import { AmountInvalidError } from "../lib/errors.js";
import { getAppContext } from "./index.js";
import { BonusEngine } from "../lib/bonuses.js";

export const bonuses = new Hono();

// ─── GET /v1/bonuses/:user/balance ─────────────────────────────────────────

bonuses.get("/:user/balance", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email) {
    return c.json({ error_code: "FORBIDDEN" }, 403);
  }

  // PR 6 simplified: just return wallet balance
  // PR 8 will sum pending bonuses not yet applied
  const result = await ctx.dynamoClient.send({
    TableName: ctx.walletsTable,
    Key: { user_id: targetUser },
  });
  return c.json({
    user_id: targetUser,
    available_for_withdraw_cop: result.Item?.balance_cop ?? 0,
    pending_coins_cop: 0, // PR 8 will sum from MarketBonuses
  });
});

// ─── POST /v1/bonuses/:user/trigger (admin/dev) ───────────────────────────

bonuses.post("/:user/trigger", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email && !user.groups.includes("dpo")) {
    return c.json({ error_code: "FORBIDDEN" }, 403);
  }

  const body = await c.req.json();
  const ruleId = String(body?.rule_id ?? "");
  if (!ruleId) throw new AmountInvalidError("rule_id is required");

  const engine = new BonusEngine({ store: makeBonusStore(ctx) });
  const result = await engine.triggerRule({
    userId: targetUser,
    ruleId: ruleId as any,
    transactionAmountCop: body?.transaction_amount_cop,
    transactionId: body?.transaction_id,
  });

  return c.json(result);
});

// Simple in-memory bonus store for PR 6 — PR 8 wires to DynamoDB
function makeBonusStore(ctx: any): any {
  return {
    getLastBonus: async () => null,
    recordBonus: async () => {},
    reverseBonusesForTransaction: async () => 0,
  };
}