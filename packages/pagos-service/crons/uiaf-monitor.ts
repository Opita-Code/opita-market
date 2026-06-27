/**
 * UIAF (anti-money-laundering) monitor cron — hourly.
 *
 * Detects users whose 24h transaction volume exceeds COP $5M (the threshold
 * for required UIAF reporting in Colombia). Alerts the DPO via SES.
 *
 * Window: 24h back from now.
 *
 * Idempotency: each user is alerted at most once per dedupe window
 * (operator-configurable; default 24h). Subsequent runs within the same
 * window skip already-flagged users.
 */

export interface UiafTransaction {
  transaction_id: string;
  user_id: string;
  amount_cop: number;
  created_at: string; // ISO 8601
  channel: string;
  status: string;
}

export interface UiafAlerter {
  sendAlert(userId: string, amountCop: number): Promise<void>;
}

export interface UiafMonitorDeps {
  store: { getRecentTransactions(hoursBack: number): Promise<UiafTransaction[]> };
  alerter: UiafAlerter;
  windowHours?: number;
  /** Function returning dedupe key (default: user_id). Override to scope by IP, etc. */
  dedupeKey?: (userId: string) => string;
  alreadyFlagged?: () => Set<string>;
  /** Optional injection for testing. */
  recordFlag?: (key: string) => void;
}

export interface UiafResult {
  /** Users flagged in this run (above threshold, not previously flagged). */
  flagged: number;
  /** Users skipped because they were flagged in the dedupe window. */
  deduplicated: number;
  /** Users who exceeded threshold but alerter failed. */
  errors: number;
}

export class UiafMonitor {
  private readonly store: UiafMonitorDeps["store"];
  private readonly alerter: UiafAlerter;
  private readonly windowHours: number;
  private readonly dedupeKey: (userId: string) => string;
  private readonly alreadyFlagged: () => Set<string>;
  private readonly recordFlag: (key: string) => void;

  constructor(deps: UiafMonitorDeps) {
    this.store = deps.store;
    this.alerter = deps.alerter;
    this.windowHours = deps.windowHours ?? 24;
    this.dedupeKey = deps.dedupeKey ?? ((uid: string) => uid);
    this.alreadyFlagged = deps.alreadyFlagged ?? (() => new Set<string>());
    this.recordFlag = deps.recordFlag ?? (() => {});
  }

  async run(): Promise<UiafResult> {
    const result: UiafResult = { flagged: 0, deduplicated: 0, errors: 0 };
    const txs = await this.store.getRecentTransactions(this.windowHours);

    // Aggregate per user
    const userTotals = new Map<string, number>();
    for (const tx of txs) {
      if (tx.status !== "APPROVED") continue;
      const prev = userTotals.get(tx.user_id) ?? 0;
      userTotals.set(tx.user_id, prev + tx.amount_cop);
    }

    const flagged = this.alreadyFlagged();

    for (const [userId, total] of userTotals.entries()) {
      if (total < THRESHOLD_COP) continue;

      const key = this.dedupeKey(userId);
      if (flagged.has(key)) {
        result.deduplicated++;
        continue;
      }

      try {
        await this.alerter.sendAlert(userId, total);
        this.recordFlag(key);
        result.flagged++;
      } catch {
        result.errors++;
      }
    }

    return result;
  }
}

export const THRESHOLD_COP = 5_000_000;

/**
 * AWS Lambda handler for EventBridge cron (hourly).
 * PR 6 wires this to `sst.aws.Cron` schedule `cron(0 * * * ? *)`.
 */
export async function handler(): Promise<void> {
  // PR 6: load recent APPROVED transactions from DynamoDB, wire real alerter
  throw new Error("Not implemented in PR 5 — wire in PR 6");
}