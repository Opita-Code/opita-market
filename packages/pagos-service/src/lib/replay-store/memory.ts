/**
 * In-memory EventReplayStore for tests.
 */

import type { ReplayStore } from "../webhook-gateway/types.js";

export class InMemoryReplayStore implements ReplayStore {
  private processed = new Set<string>();

  async isProcessed(eventId: string): Promise<boolean> {
    return this.processed.has(eventId);
  }

  async markProcessed(eventId: string, _txId: string): Promise<void> {
    this.processed.add(eventId);
  }
}
