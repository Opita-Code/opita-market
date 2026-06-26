export interface AuditEntry {
  audit_id: string;
  timestamp: string;
  action: string;
  nit: string | null;
  outcome: "verified" | "rejected" | "completed" | "failed";
  dpo_signoff: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ComplaintEntry {
  request_id: string;
  nit: string;
  request_type: "know" | "update" | "rectify" | "suppress";
  received_at: string;
  sla_deadline: string;
  status: "received" | "in_progress" | "resolved" | "rejected";
  channel: "email" | "admin_tool" | "self_service";
}

export interface RnbdWindowState {
  in_window: boolean;
  days_until_open: number;
  days_until_close: number;
  window_start: string;
  window_end: string;
}

export interface SlaMetric {
  week: string;
  requests_received: number;
  requests_resolved_on_time: number;
  requests_breached: number;
}

export interface DashboardSnapshot {
  generated_at: string;
  audit_total: number;
  complaints_pending: number;
  rnbd_window: RnbdWindowState;
  recent_audit: AuditEntry[];
  complaints: ComplaintEntry[];
  sla_metrics: SlaMetric[];
}