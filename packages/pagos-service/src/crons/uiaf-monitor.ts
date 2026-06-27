/**
 * UIAF (anti-money-laundering) monitor cron — hourly.
 *
 * PR 4a — closes OPL-COMP-014, OPL-COMP-015, OPL-COMP-016, OPL-COMP-017.
 *
 * Detects users whose 24h transaction volume exceeds the per-channel
 * UIAF reporting threshold. Now with channel-specific thresholds
 * (Decreto 2358/2020: 5M COP cash, 10M COP non-cash) and structuring
 * detection (5+ txs in [900k, 1M) within 24h).
 *
 * Window: 24h back from now.
 *
 * Flow:
 *   1. Fetch APPROVED transactions in last 24h
 *   2. Aggregate by (user_id, channel)
 *   3. For each (user, channel) pair above threshold: generate SAR, persist
 *   4. Detect structuring per user: emit SAR with STRUCTURING_SUSPECTED
 *   5. Dedupe by sar_key (per user per channel per run)
 */

import {
  type SarRecord,
  type SarReason,
  type SarTransaction,
} from "../lib/uiaf-reports.js";

export interface UiafTransaction {
  transaction_id: string;
  user_id: string;
  amount_cop: number;
  created_at: string;
  channel: string;
  status: string;
}

export interface UiafAlerter {
  sendAlert(userId: string, amountCop: number, channel: string): Promise<void>;
}

export interface UiafMonitorDeps {
  store: { getRecentTransactions(hoursBack: number): Promise<UiafTransaction[]> };
  alerter: UiafAlerter;
  /** Optional: callback to persist SAR after generation */
  onSarGenerated?: (sar: SarRecord) => Promise<void>;
  windowHours?: number;
  /** Function returning dedupe key. Default: `${userId}:${channel}` */
  dedupeKey?: (userId: string, channel: string) => string;
  alreadyFlagged?: () => Set<string>;
  recordFlag?: (key: string) => void;
  /** Optional injection for testing. */
  now?: () => Date;
}

export interface UiafResult {
  /** Users flagged in this run (above threshold, not previously flagged). */
  flagged: number;
  /** Users skipped because they were flagged in the dedupe window. */
  deduplicated: number;
  /** Users who exceeded threshold but alerter failed. */
  errors: number;
  /** Structuring detections. */
  structuringFlagged: number;
  /** SARs generated. */
  sarsGenerated: number;
}

// ─── Channel-specific thresholds (closes OPL-COMP-017) ───────────────────────

/**
 * Per-channel UIAF thresholds (Decreto 2358/2020 + UIAF guidance).
 *   - 5M COP for cash-equivalent (WOMPI_CARD, WOMPI_BREB)
 *   - 10M COP for non-cash digital (WOMPI_PSE, WOMPI_NEQUI, WOMPI_DAVIPLATA)
 */
export const THRESHOLD_BY_CHANNEL: Record<string, number> = {
  WOMPI_CARD: 5_000_000,
  WOMPI_BREB: 5_000_000,
  WOMPI_PSE: 10_000_000,
  WOMPI_NEQUI: 10_000_000,
  WOMPI_DAVIPLATA: 10_000_000,
};

/** Default 5M for unknown channels (defensive). */
export const DEFAULT_THRESHOLD_COP = 5_000_000;

/** Backward-compat alias for the original single threshold. */
export const THRESHOLD_COP = DEFAULT_THRESHOLD_COP;

function getThreshold(channel: string): number {
  return THRESHOLD_BY_CHANNEL[channel] ?? DEFAULT_THRESHOLD_COP;
}

// ─── Structuring detection (closes OPL-COMP-016) ─────────────────────────────

/**
 * Range for "structuring-amount" transactions:
 *   - Above normal retail (>$800k) to suggest intentional avoidance
 *   - Below the SAR threshold ($1M for cash, $10M for non-cash)
 *   - Conservative default: [900k, 1M)
 */
export const STRUCTURING_LOWER_COP = 900_000;
export const STRUCTURING_UPPER_COP = 1_000_000;

/** Default minimum count to flag structuring. */
export const STRUCTURING_MIN_COUNT = 5;

export function isStructuringAmount(amountCop: number): boolean {
  return amountCop >= STRUCTURING_LOWER_COP && amountCop < STRUCTURING_UPPER_COP;
}

export interface StructuringDetectOptions {
  windowHours?: number;
  minCount?: number;
}

export interface StructuringResult {
  flagged: string[];
  /** Per-user reason strings. */
  reasons: Map<string, string>;
}

/**
 * Detect structuring: user has N+ transactions in the structuring range
 * [900k, 1M) within the window.
 */
export function detectStructuring(
  txs: UiafTransaction[],
  options: StructuringDetectOptions = {},
): StructuringResult {
  const minCount = options.minCount ?? STRUCTURING_MIN_COUNT;
  const windowMs = (options.windowHours ?? 24) * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  // Count structuring-amount txs per user within window
  const userCounts = new Map<string, number>();
  for (const tx of txs) {
    if (tx.status !== "APPROVED") continue;
    if (new Date(tx.created_at).getTime() < cutoff) continue;
    if (!isStructuringAmount(tx.amount_cop)) continue;
    userCounts.set(tx.user_id, (userCounts.get(tx.user_id) ?? 0) + 1);
  }

  const flagged: string[] = [];
  const reasons = new Map<string, string>();
  for (const [userId, count] of userCounts.entries()) {
    if (count >= minCount) {
      flagged.push(userId);
      reasons.set(
        userId,
        `Structuring suspected: ${count} transactions in [${STRUCTURING_LOWER_COP}, ${STRUCTURING_UPPER_COP}) range within ${options.windowHours ?? 24}h`,
      );
    }
  }

  return { flagged, reasons };
}

// ─── SAR generation (closes OPL-COMP-015) ────────────────────────────────────

export interface GenerateSarInput {
  sarId: string;
  userId: string;
  totalAmountCop: number;
  transactions: SarTransaction[];
  reason: SarReason;
  generatedAtIso: string;
  /** Optional channel for the SAR report. */
  channel?: string;
  /** Optional structuring reason text. */
  structuringNote?: string;
}

export interface SarValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Generate a SAR record with UIAF-formatted XML payload.
 *
 * NOTE: This is the internal representation. Actual UIAF filing happens
 * via the UIAF portal/API (out of scope for in-app — requires UIAF cert).
 * SARs are queued in PENDING_FILING status for operator review.
 */
export function generateSar(input: GenerateSarInput): SarRecord {
  const referenceNumber = `SAR-${input.generatedAtIso.replace(/[^0-9]/g, "").slice(0, 8)}-${input.sarId.slice(-6)}`;
  const xmlPayload = buildSarXml(input, referenceNumber);
  return {
    sarId: input.sarId,
    userId: input.userId,
    totalAmountCop: input.totalAmountCop,
    transactions: input.transactions,
    reason: input.reason,
    generatedAtIso: input.generatedAtIso,
    status: "PENDING_FILING",
    uiafReferenceNumber: referenceNumber,
    xmlPayload,
  };
}

function buildSarXml(input: GenerateSarInput, ref: string): string {
  const txLines = input.transactions
    .map(
      (tx) =>
        `    <Transaction id="${escapeXml(tx.transaction_id)}" amount="${tx.amount_cop}" channel="${escapeXml(tx.channel)}" at="${escapeXml(tx.created_at)}"/>`,
    )
    .join("\n");
  const noteLine = input.structuringNote
    ? `\n  <Note>${escapeXml(input.structuringNote)}</Note>`
    : "";
  const channelLine = input.channel ? `\n  <Channel>${escapeXml(input.channel)}</Channel>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<UIAFSAR reference="${ref}" generatedAt="${input.generatedAtIso}">
  <Subject userId="${escapeXml(input.userId)}"/>
  <Reason>${escapeXml(input.reason)}</Reason>${channelLine}${noteLine}
  <TotalAmount>${input.totalAmountCop}</TotalAmount>
  <Transactions>
${txLines}
  </Transactions>
</UIAFSAR>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function validateSar(sar: SarRecord): SarValidationResult {
  if (!sar.sarId) return { valid: false, error: "sarId is required" };
  if (!sar.userId) return { valid: false, error: "userId is required" };
  if (sar.totalAmountCop <= 0) return { valid: false, error: "totalAmountCop must be positive" };
  if (!sar.transactions || sar.transactions.length === 0) {
    return { valid: false, error: "at least one transaction is required" };
  }
  if (!sar.uiafReferenceNumber) {
    return { valid: false, error: "uiafReferenceNumber is required" };
  }
  return { valid: true };
}

// ─── UiafMonitor with channel-aware thresholds ──────────────────────────────

export class UiafMonitor {
  private readonly store: UiafMonitorDeps["store"];
  private readonly alerter: UiafAlerter;
  private readonly windowHours: number;
  private readonly dedupeKey: (userId: string, channel: string) => string;
  private readonly alreadyFlagged: () => Set<string>;
  private readonly recordFlag: (key: string) => void;
  private readonly now: () => Date;
  private readonly onSarGenerated?: (sar: SarRecord) => Promise<void>;

  constructor(deps: UiafMonitorDeps) {
    this.store = deps.store;
    this.alerter = deps.alerter;
    this.windowHours = deps.windowHours ?? 24;
    this.dedupeKey = deps.dedupeKey ?? ((u, c) => `${u}:${c}`);
    this.alreadyFlagged = deps.alreadyFlagged ?? (() => new Set<string>());
    this.recordFlag = deps.recordFlag ?? (() => {});
    this.now = deps.now ?? (() => new Date());
    this.onSarGenerated = deps.onSarGenerated;
  }

  async run(): Promise<UiafResult> {
    const result: UiafResult = {
      flagged: 0,
      deduplicated: 0,
      errors: 0,
      structuringFlagged: 0,
      sarsGenerated: 0,
    };
    const txs = await this.store.getRecentTransactions(this.windowHours);

    // 1. Aggregate by (user_id, channel) — channel-aware
    const userChannelTotals = new Map<string, { userId: string; channel: string; total: number }>();
    for (const tx of txs) {
      if (tx.status !== "APPROVED") continue;
      const key = `${tx.user_id}:${tx.channel}`;
      const existing = userChannelTotals.get(key);
      if (existing) {
        existing.total += tx.amount_cop;
      } else {
        userChannelTotals.set(key, { userId: tx.user_id, channel: tx.channel, total: tx.amount_cop });
      }
    }

    const flagged = this.alreadyFlagged();
    const nowIso = this.now().toISOString();

    // 2. Check threshold per (user, channel)
    for (const [, agg] of userChannelTotals) {
      const threshold = getThreshold(agg.channel);
      if (agg.total < threshold) continue;

      const key = this.dedupeKey(agg.userId, agg.channel);
      if (flagged.has(key)) {
        result.deduplicated++;
        continue;
      }

      try {
        await this.alerter.sendAlert(agg.userId, agg.total, agg.channel);
        this.recordFlag(key);
        result.flagged++;

        // Generate + persist SAR (closes OPL-COMP-015)
        if (this.onSarGenerated) {
          const userTxs = txs.filter(
            (tx) => tx.user_id === agg.userId && tx.channel === agg.channel && tx.status === "APPROVED",
          );
          const sar = generateSar({
            sarId: `sar-${agg.userId}-${agg.channel}-${nowIso.replace(/[^0-9]/g, "")}`,
            userId: agg.userId,
            totalAmountCop: agg.total,
            transactions: userTxs,
            reason: "VOLUME_THRESHOLD_EXCEEDED",
            generatedAtIso: nowIso,
            channel: agg.channel,
          });
          await this.onSarGenerated(sar);
          result.sarsGenerated++;
        }
      } catch {
        result.errors++;
      }
    }

    // 3. Structuring detection (closes OPL-COMP-016)
    const structuring = detectStructuring(txs, { windowHours: this.windowHours });
    for (const userId of structuring.flagged) {
      const key = this.dedupeKey(userId, "STRUCTURING");
      if (flagged.has(key)) {
        result.deduplicated++;
        continue;
      }
      try {
        const userTxs = txs.filter((tx) => tx.user_id === userId && tx.status === "APPROVED");
        const totalAmount = userTxs.reduce((acc, tx) => acc + tx.amount_cop, 0);
        await this.alerter.sendAlert(userId, totalAmount, "STRUCTURING");
        this.recordFlag(key);
        result.structuringFlagged++;

        if (this.onSarGenerated) {
          const sar = generateSar({
            sarId: `sar-${userId}-STRUCTURING-${nowIso.replace(/[^0-9]/g, "")}`,
            userId,
            totalAmountCop: totalAmount,
            transactions: userTxs,
            reason: "STRUCTURING_SUSPECTED",
            generatedAtIso: nowIso,
            structuringNote: structuring.reasons.get(userId) ?? "",
          });
          await this.onSarGenerated(sar);
          result.sarsGenerated++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }
}

/**
 * AWS Lambda handler for EventBridge cron (hourly).
 *
 * PR 4a — wired: load APPROVED transactions from TransactionsTable (last 24h),
 * run UiafMonitor with channel-aware thresholds, persist SARs to UiafReportsTable,
 * alert DPO via SNS on findings.
 */
export async function handler(): Promise<UiafResult> {
  // Implementation injected at deploy-time via SST — see sst.config.ts.
  // This signature is the contract; the actual handler is wired in cron handler.
  throw new Error("handler() requires SST bindings — use the SST-wired cron instead");
}
