import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { requireUser } from "../lib/auth.js";
import { AmountInvalidError, InvalidStateError } from "../lib/errors.js";
import { getAppContext } from "./index.js";
import { BonusEngine } from "../lib/bonuses.js";
import { transactBonusClaim } from "../lib/transact/index.js";

export const bonuses = new Hono();

// ─── GET /v1/bonuses/:user/balance ─────────────────────────────────────────

bonuses.get("/:user/balance", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email) {
    return c.json({ error_code: "FORBIDDEN" }, 403);
  }

  // Read wallet balance (closes pre-existing BatchExecuteStatementCommand bug)
  // PR 1.4c: use GetCommand instead of inline object — fixes TS2353.
  // PR 2.x: will sum pending bonuses from Bonuses table.
  const result = await ctx.dynamoClient.send(
    new GetCommand({
      TableName: ctx.walletsTable,
      Key: { user_id: targetUser },
    }),
  );
  return c.json({
    user_id: targetUser,
    available_for_withdraw_cop: result.Item?.balance_cop ?? 0,
    pending_coins_cop: 0, // PR 2.x will sum from Bonuses table
  });
});

// ─── POST /v1/bonuses/:user/trigger (admin/dev) ───────────────────────────

bonuses.post("/:user/trigger", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  // SECURITY: explicit role check. User can trigger own bonus; DPO can trigger anyone's.
  // Closes OPL-API-010 — bonus trigger ownership.
  if (targetUser !== user.email && !user.groups.includes("dpo")) {
    throw new InvalidStateError("Cannot trigger bonus for another user");
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

  // PR 2b — atomic bonus claim via TransactWriteItems
  // Closes: OPL-LIB-008 (FIRST_PURCHASE bonus race), OPL-CARD-019 (concurrent claim)
  // If apply succeeded and amount > 0, credit the wallet atomically.
  if (result.applied && result.amountCop > 0 && body?.transaction_id) {
    const baseClient = new DynamoDBClient({});
    try {
      await transactBonusClaim(
        {
          userId: targetUser,
          ruleId,
          amountCop: result.amountCop,
          transactionId: body.transaction_id,
          idempotencyKey: `bonus:${targetUser}:${ruleId}:${body.transaction_id}`,
        },
        { client: baseClient as any },
      );
    } catch (err) {
      // ConditionFailedError = already claimed (concurrent first-purchase). OK.
      if ((err as { code?: string }).code !== "CONDITION_FAILED") throw err;
    }
  }

  return c.json(result);
});

// Simple in-memory bonus store for PR 2b. Wired to Bonuses table via transactBonusClaim above.
function makeBonusStore(_ctx: any): any {
  return {
    getLastBonus: async () => null,
    recordBonus: async () => {},
    reverseBonusesForTransaction: async () => 0,
  };
}