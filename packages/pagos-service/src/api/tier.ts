import { Hono } from "hono";
import { requireUser, requireDpo } from "../lib/auth.js";
import { MissingRequirementsError, InvalidStateError } from "../lib/errors.js";
import { TIERS, canPromoteTo, isValidTier, type Tier } from "../lib/tiers.js";
import { getAppContext } from "./index.js";

export const tier = new Hono();

// ─── GET /v1/tier/:user ───────────────────────────────────────────────────

tier.get("/:user", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email && !user.groups.includes("dpo")) {
    throw new InvalidStateError("Cannot view another user's tier");
  }

  const result = await ctx.dynamoClient.send({
    TableName: ctx.walletsTable,
    Key: { user_id: targetUser },
  });
  const wallet = result.Item;
  const rawTier = wallet?.tier;
  const currentTier: Tier = isValidTier(rawTier) ? rawTier : 0;
  const current = TIERS[currentTier];

  // Compute next tier progress
  const nextTier = (currentTier < 4 ? currentTier + 1 : null) as 1 | 2 | 3 | 4 | null;

  let progress: any = null;
  if (nextTier) {
    const next = TIERS[nextTier];
    // PR 6 simplified: assume all requirements are unverified (operator verifies per-flow)
    const unmet = next.requirements;
    progress = {
      target_tier: nextTier,
      unmet_requirements: unmet, // operator verifies each one
      next_tier_benefits: [
        `Receive limit: ${formatCop(next.receiveLimitDayCop)}/day`,
        `Withdraw limit: ${formatCop(next.withdrawLimitDayCop)}/day`,
        `Withdraw hold: ${next.withdrawHoldHours}h`,
        `3DS threshold: ${next.threeDsThresholdCop === Number.MAX_SAFE_INTEGER ? "never" : `>${formatCop(next.threeDsThresholdCop)}`}`,
        next.badge ? `Badge: "${next.badge}"` : null,
      ].filter(Boolean),
    };
  }

  return c.json({
    user_id: targetUser,
    current_tier: currentTier,
    current_tier_name: current.name,
    trust_badge: current.badge,
    progress_to_next_tier: progress,
  });
});

// ─── POST /v1/tier/:user/promote ───────────────────────────────────────────

tier.post("/:user/promote", async (c) => {
  const user = requireUser(c);
  const ctx = getAppContext();
  const targetUser = c.req.param("user");
  if (targetUser !== user.email && !user.groups.includes("dpo")) {
    throw new InvalidStateError("Cannot promote another user");
  }

  const body = await c.req.json();
  const targetTier = Number(body?.target_tier);
  if (!isValidTier(targetTier)) {
    throw new InvalidStateError(`Invalid target_tier: ${targetTier}`);
  }
  const verifiedRequirements = new Set<string>(body?.evidence?.verified_requirements ?? []);

  // Read current tier
  const result = await ctx.dynamoClient.send({
    TableName: ctx.walletsTable,
    Key: { user_id: targetUser },
  });
  const currentTier = isValidTier(result.Item?.tier) ? result.Item.tier : 0;

  if (!canPromoteTo(currentTier, targetTier, verifiedRequirements)) {
    const next = TIERS[targetTier];
    throw new MissingRequirementsError(
      `Cannot promote to tier ${targetTier}`,
      next.requirements.filter((r) => !verifiedRequirements.has(r)),
    );
  }

  await ctx.dynamoClient.send({
    TableName: ctx.walletsTable,
    Key: { user_id: targetUser },
    UpdateExpression: "SET tier = :t, updated_at = :now",
    ExpressionAttributeValues: {
      ":t": targetTier,
      ":now": new Date().toISOString(),
    },
  });

  return c.json({
    tier: targetTier,
    trust_badge: TIERS[targetTier].badge,
    limits: {
      receiveLimitDayCop: TIERS[targetTier].receiveLimitDayCop,
      withdrawLimitDayCop: TIERS[targetTier].withdrawLimitDayCop,
      withdrawHoldHours: TIERS[targetTier].withdrawHoldHours,
    },
  });
});

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO").format(n);
}