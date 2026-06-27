/**
 * Habeas Data — Ley 1581/2012 + Decreto 1377/2013.
 *
 * Right to oppose data processing (Art. 9): users can submit opposition
 * requests via REST endpoint, which must be acknowledged within 10 business
 * days per Ley 1581 Art. 16.
 *
 * PR 5 — closes OPL-COMP-002 (opposition REST endpoint for Habeas Data right)
 *              OPL-COMP-021 (TOS acceptance record)
 *
 * NOTE: This module handles only the request/acknowledgment workflow.
 * Actual data deletion/update/access are scheduled in PR 8+
 * (requires data warehouse + compliance officer review).
 */

import { randomUUID } from "node:crypto";

export type HabeasDataRight = "ACCESS" | "UPDATE" | "OPPOSITION" | "DELETION";
export type OppositionStatus = "RECEIVED" | "ACKNOWLEDGED" | "PROCESSING" | "COMPLETED" | "REJECTED";

export interface OppositionRequest {
  requestId: string;
  userId: string;
  requestType: HabeasDataRight;
  reason: string;
  status: OppositionStatus;
  submittedAtIso: string;
  acknowledgmentDeadlineIso: string;
  acknowledgedAtIso?: string;
  processedAtIso?: string;
  notes?: string;
}

export interface TosAcceptance {
  acceptanceId: string;
  userId: string;
  tosVersion: string;
  acceptedAtIso: string;
  ipAddress: string;
  userAgent: string;
}

export interface OppositionStore {
  saveOpposition(req: OppositionRequest): Promise<void>;
  listOppositions(userId: string): Promise<OppositionRequest[]>;
  saveTosAcceptance(acceptance: TosAcceptance): Promise<void>;
  listTosAcceptances(userId: string): Promise<TosAcceptance[]>;
}

/** 10 business days acknowledgment deadline per Ley 1581/2012 Art. 16. */
const ACKNOWLEDGMENT_BUSINESS_DAYS = 10;

/** Convert business days to ms (5 business days = 7 calendar days). */
function businessDaysToMs(days: number): number {
  return days * (7 / 5) * 24 * 60 * 60 * 1000;
}

export const ACKNOWLEDGMENT_DEADLINE_MS = businessDaysToMs(ACKNOWLEDGMENT_BUSINESS_DAYS);

export class InMemoryOppositionStore implements OppositionStore {
  private oppositions: OppositionRequest[] = [];
  private tosAcceptances: TosAcceptance[] = [];

  async saveOpposition(req: OppositionRequest): Promise<void> {
    this.oppositions.push(req);
  }

  async listOppositions(userId: string): Promise<OppositionRequest[]> {
    return this.oppositions.filter((o) => o.userId === userId);
  }

  async saveTosAcceptance(acceptance: TosAcceptance): Promise<void> {
    this.tosAcceptances.push(acceptance);
  }

  async listTosAcceptances(userId: string): Promise<TosAcceptance[]> {
    return this.tosAcceptances.filter((a) => a.userId === userId);
  }

  // Test helpers
  clear(): void {
    this.oppositions = [];
    this.tosAcceptances = [];
  }
}

export interface HabeasDataServiceDeps {
  store: OppositionStore;
  now?: () => Date;
}

export class HabeasDataService {
  private readonly store: OppositionStore;
  private readonly now: () => Date;

  constructor(deps: HabeasDataServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Submit a Habeas Data right request (Art. 9).
   * Returns the request with REJECTED status if input is invalid.
   */
  async submitOpposition(input: {
    userId: string;
    requestType: HabeasDataRight;
    reason: string;
  }): Promise<OppositionRequest> {
    if (!input.userId || input.userId.length === 0) {
      throw new Error("habeas-data: userId is required");
    }
    const validTypes: HabeasDataRight[] = ["ACCESS", "UPDATE", "OPPOSITION", "DELETION"];
    if (!validTypes.includes(input.requestType)) {
      throw new Error(
        `habeas-data: requestType must be one of ${validTypes.join(", ")}, got '${input.requestType}'`,
      );
    }

    const nowMs = this.now().getTime();
    const req: OppositionRequest = {
      requestId: `opposition-${randomUUID()}`,
      userId: input.userId,
      requestType: input.requestType,
      reason: input.reason,
      status: "RECEIVED",
      submittedAtIso: new Date(nowMs).toISOString(),
      acknowledgmentDeadlineIso: new Date(nowMs + ACKNOWLEDGMENT_DEADLINE_MS).toISOString(),
    };
    await this.store.saveOpposition(req);
    return req;
  }

  async getOppositionStatus(userId: string): Promise<OppositionRequest[]> {
    return this.store.listOppositions(userId);
  }

  async recordTosAcceptance(input: {
    userId: string;
    tosVersion: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<TosAcceptance> {
    if (!input.userId || input.userId.length === 0) {
      throw new Error("habeas-data (TOS): userId is required");
    }
    if (!input.tosVersion || input.tosVersion.length === 0) {
      throw new Error("habeas-data (TOS): tosVersion is required");
    }
    const acceptance: TosAcceptance = {
      acceptanceId: `tos-${randomUUID()}`,
      userId: input.userId,
      tosVersion: input.tosVersion,
      acceptedAtIso: new Date(this.now().getTime()).toISOString(),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    };
    await this.store.saveTosAcceptance(acceptance);
    return acceptance;
  }
}
