/**
 * User history — prior BLOCK lookup for repeat offenders.
 *
 * Spec (velocity-counter/spec.md R4):
 *   - New `UserHistory` table (pk: user_id, ttl: 30 days)
 *   - After every BLOCK decision, write user_id with reason + timestamp
 *   - Before evaluating signals, lookup UserHistory for prior BLOCKs
 *   - If found and not expired: auto-BLOCK without signal evaluation
 *
 * Closes OPL-CARD-012 (repeat offender bypass).
 */

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export interface BlockRecord {
  userId: string;
  reason: string;
  timestampMs: number;
}

export interface RecordDecisionInput {
  userId: string;
  decision: Decision;
  reason: string;
  timestampMs: number;
}

export interface UserHistory {
  findRecentBlock(userId: string): Promise<BlockRecord | null>;
  recordDecision(input: RecordDecisionInput): Promise<void>;
}

export const USER_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function validateRecordInput(input: RecordDecisionInput): void {
  if (!input.userId || input.userId.length === 0) {
    throw new Error("user-history: userId must be non-empty");
  }
  if (!input.reason || input.reason.length === 0) {
    throw new Error("user-history: reason must be non-empty");
  }
  if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
    throw new Error("user-history: timestampMs must be non-negative finite number");
  }
}

interface HistoryEntry {
  userId: string;
  decision: Decision;
  reason: string;
  timestampMs: number;
}

export class InMemoryUserHistory implements UserHistory {
  private entries: HistoryEntry[] = [];

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async recordDecision(input: RecordDecisionInput): Promise<void> {
    validateRecordInput(input);
    this.entries.push({
      userId: input.userId,
      decision: input.decision,
      reason: input.reason,
      timestampMs: input.timestampMs,
    });
  }

  async findRecentBlock(userId: string): Promise<BlockRecord | null> {
    const now = this.clock();
    const cutoff = now - USER_HISTORY_TTL_MS;

    // Find most recent BLOCK within TTL window
    let mostRecent: HistoryEntry | null = null;
    for (const entry of this.entries) {
      if (entry.userId !== userId) continue;
      if (entry.decision !== "BLOCK") continue;
      if (entry.timestampMs < cutoff) continue;
      if (!mostRecent || entry.timestampMs > mostRecent.timestampMs) {
        mostRecent = entry;
      }
    }

    if (!mostRecent) return null;
    return {
      userId: mostRecent.userId,
      reason: mostRecent.reason,
      timestampMs: mostRecent.timestampMs,
    };
  }

  /** Test helper — clear all entries. */
  clear(): void {
    this.entries = [];
  }
}
