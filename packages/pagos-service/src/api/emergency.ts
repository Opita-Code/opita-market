import { Hono } from "hono";
import { requireDpo } from "../lib/auth.js";
import { getAppContext } from "./index.js";

export const emergency = new Hono();

// ─── POST /v1/emergency/kill-switch (DPO-only) ───────────────────────────

emergency.post("/kill-switch", async (c) => {
  const dpo = requireDpo(c);
  const ctx = getAppContext();
  const body = await c.req.json();

  const flag = String(body?.flag ?? "");
  const enabled = Boolean(body?.enabled);

  if (flag === "SST_API_PAUSED") {
    ctx.abortFlags.paymentPaused = enabled;
  } else if (flag === "SST_PAYOUTS_PAUSED") {
    ctx.abortFlags.payoutsPaused = enabled;
  } else {
    return c.json({ error_code: "INVALID_FLAG" }, 422);
  }

  return c.json({
    flag,
    enabled,
    applied_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
});