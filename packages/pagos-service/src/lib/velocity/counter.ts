/**
 * Velocity counter — InMemory implementation for tests.
 *
 * For production, use DynamoCounter (UpdateCommand with ADD count :one + TTL).
 * Same interface as InMemoryCounter, so route code is identical.
 *
 * Semantics:
 *   - counter_id = `${type}:${value}:${windowSec}`
 *   - First call: count = 1
 *   - Subsequent calls within window: count++
 *   - Calls after TTL expiry: reset to 1
 */

import type { VelocityCounter, IncrementInput, IncrementResult } from "./types.js";
import { validateIncrementInput } from "./types.js";

interface CounterEntry {
  count: number;
  expiresAtSec: number;
}

export class InMemoryCounter implements VelocityCounter {
  private entries = new Map<string, CounterEntry>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async increment(input: IncrementInput): Promise<IncrementResult> {
    validateIncrementInput(input);
    const id = `${input.type}:${input.value}:${input.windowSec}`;
    const now = input.nowSec ? input.nowSec() : Math.floor(this.clock() / 1000);

    const existing = this.entries.get(id);
    if (existing && existing.expiresAtSec > now) {
      existing.count++;
      return { count: existing.count };
    }

    // First call or expired — start fresh at 1
    const entry: CounterEntry = {
      count: 1,
      expiresAtSec: now + input.ttlSec,
    };
    this.entries.set(id, entry);
    return { count: 1 };
  }

  /** Test helper — clear all entries. */
  clear(): void {
    this.entries.clear();
  }
}
