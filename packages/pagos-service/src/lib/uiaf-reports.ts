/**
 * UIAF reports store — persists SAR records (Suspicious Activity Reports).
 *
 * Closes OPL-COMP-015 (no SAR filing).
 *
 * Schema (sst.config.ts):
 *   pk: sar_id
 *   attrs: user_id, total_amount_cop, reason, generated_at, status,
 *          uiaf_reference_number, xml_payload, transactions (list)
 *   ttl: 5 years (UIAF retention requirement)
 *
 * Decoupled from DynamoDB via UiafReportsStore interface.
 */

export type SarStatus = "PENDING_FILING" | "FILED" | "FAILED";

export type SarReason =
  | "VOLUME_THRESHOLD_EXCEEDED"
  | "STRUCTURING_SUSPECTED"
  | "PEP_MATCH"
  | "SANCTIONS_MATCH"
  | "VELOCITY_ALERT";

export interface SarTransaction {
  transaction_id: string;
  user_id: string;
  amount_cop: number;
  created_at: string;
  channel: string;
}

export interface SarRecord {
  sarId: string;
  userId: string;
  totalAmountCop: number;
  transactions: SarTransaction[];
  reason: SarReason;
  generatedAtIso: string;
  status: SarStatus;
  uiafReferenceNumber: string;
  xmlPayload: string;
  /** Set after successful filing. */
  filedAtIso?: string;
  /** UIAF confirmation number after filing. */
  uiafConfirmationNumber?: string;
}

export interface UiafReportsStore {
  save(sar: SarRecord): Promise<void>;
  list(filter: { status?: SarStatus; userId?: string }): Promise<SarRecord[]>;
}

/** 5 years TTL — UIAF retention requirement (C Circular Externa 029/2014). */
export const UIAF_REPORTS_TTL_SEC = 5 * 365 * 24 * 60 * 60;

export class InMemoryUiafReportsStore implements UiafReportsStore {
  private reports: SarRecord[] = [];

  async save(sar: SarRecord): Promise<void> {
    // Idempotent: replace if sar_id exists
    const idx = this.reports.findIndex((r) => r.sarId === sar.sarId);
    if (idx >= 0) {
      this.reports[idx] = sar;
    } else {
      this.reports.push(sar);
    }
  }

  async list(filter: { status?: SarStatus; userId?: string }): Promise<SarRecord[]> {
    return this.reports.filter((r) => {
      if (filter.status && r.status !== filter.status) return false;
      if (filter.userId && r.userId !== filter.userId) return false;
      return true;
    });
  }

  /** Test helper. */
  clear(): void {
    this.reports = [];
  }
}
