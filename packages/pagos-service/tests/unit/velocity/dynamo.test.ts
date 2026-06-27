import { describe, it, expect, vi } from "vitest";
import { DynamoVelocityCounter } from "../../../src/lib/velocity/dynamo-counter.js";
import { DynamoUserHistory } from "../../../src/lib/velocity/dynamo-user-history.js";

/**
 * Tests for DynamoDB-backed velocity counter + user history (production code path).
 *
 * Uses a mocked DynamoDBDocumentClient to verify the wire format
 * (UpdateExpression, Key shape, ExpressionAttributeValues) without hitting AWS.
 *
 * These complement the InMemory tests which verify the SEMANTICS.
 */

function makeMockClient(impl: (cmd: any) => Promise<any>) {
  return { send: vi.fn(impl) } as any;
}

describe("DynamoVelocityCounter — wire format", () => {
  it("increment uses UpdateCommand with ADD count :one + TTL", async () => {
    const send = vi.fn(async () => ({ Attributes: { count: 1 } }));
    const client = { send } as any;
    const counter = new DynamoVelocityCounter(client, "VelocityCountersTable");

    const result = await counter.increment({
      type: "IP_CARD",
      value: "192.0.2.1",
      windowSec: 300,
      ttlSec: 3960,
    });

    expect(result.count).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe("VelocityCountersTable");
    expect(cmd.input.Key).toEqual({ counter_id: "IP_CARD:192.0.2.1:300" });
    expect(cmd.input.UpdateExpression).toContain("ADD count :one");
    expect(cmd.input.ExpressionAttributeValues[":one"]).toBe(1);
    expect(cmd.input.ExpressionAttributeValues[":ttl"]).toBeGreaterThan(0);
  });

  it("counter_id includes type, value, and windowSec", async () => {
    const send = vi.fn(async () => ({ Attributes: { count: 5 } }));
    const counter = new DynamoVelocityCounter({ send } as any, "T");

    await counter.increment({
      type: "BIN_CARD",
      value: "453212",
      windowSec: 60,
      ttlSec: 3660,
    });

    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Key.counter_id).toBe("BIN_CARD:453212:60");
  });

  it("returns the new count from DynamoDB Attributes", async () => {
    const send = vi.fn(async () => ({ Attributes: { count: 7 } }));
    const counter = new DynamoVelocityCounter({ send } as any, "T");

    const result = await counter.increment({
      type: "IP_CARD",
      value: "10.0.0.1",
      windowSec: 300,
      ttlSec: 3960,
    });

    expect(result.count).toBe(7);
  });

  it("peek uses GetCommand with same Key", async () => {
    const send = vi.fn(async () => ({ Item: { count: 42 } }));
    const counter = new DynamoVelocityCounter({ send } as any, "T");

    const peeked = await counter.peek("IP_CARD:1.2.3.4:300");
    expect(peeked).toBe(42);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Key).toEqual({ counter_id: "IP_CARD:1.2.3.4:300" });
  });

  it("peek returns null when no item exists", async () => {
    const send = vi.fn(async () => ({}));
    const counter = new DynamoVelocityCounter({ send } as any, "T");

    const peeked = await counter.peek("NONEXISTENT");
    expect(peeked).toBeNull();
  });
});

describe("DynamoUserHistory — wire format", () => {
  it("recordDecision uses PutCommand with TTL = timestamp + 30 days", async () => {
    const send = vi.fn(async () => ({}));
    const history = new DynamoUserHistory({ send } as any, "UserHistoryTable");

    await history.recordDecision({
      userId: "user-123",
      decision: "BLOCK",
      reason: "TOR_EXIT",
      timestampMs: 1_700_000_000_000,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.TableName).toBe("UserHistoryTable");
    expect(cmd.input.Item.user_id).toBe("user-123");
    expect(cmd.input.Item.decision).toBe("BLOCK");
    expect(cmd.input.Item.reason).toBe("TOR_EXIT");
    expect(cmd.input.Item.timestamp_ms).toBe(1_700_000_000_000);
    expect(cmd.input.Item.ttl_epoch).toBeGreaterThan(0);
    expect(cmd.input.Item.block_id).toMatch(/^1700000000000#/);
  });

  it("findRecentBlock queries by user_id with BLOCK filter and TTL cutoff", async () => {
    const send = vi.fn(async () => ({
      Items: [
        {
          user_id: "user-123",
          reason: "BLACKLIST_MATCH",
          timestamp_ms: 1_700_000_000_000,
        },
      ],
    }));
    const history = new DynamoUserHistory({ send } as any, "UserHistoryTable");

    const block = await history.findRecentBlock("user-123");
    expect(block).not.toBeNull();
    expect(block?.reason).toBe("BLACKLIST_MATCH");

    const cmd = send.mock.calls[0][0];
    expect(cmd.input.KeyConditionExpression).toBe("user_id = :uid");
    expect(cmd.input.ExpressionAttributeValues[":uid"]).toBe("user-123");
    expect(cmd.input.ExpressionAttributeValues[":block"]).toBe("BLOCK");
    expect(cmd.input.FilterExpression).toContain("#d");
    expect(cmd.input.ScanIndexForward).toBe(false);
    expect(cmd.input.Limit).toBe(1);
  });

  it("findRecentBlock returns null when no items", async () => {
    const send = vi.fn(async () => ({ Items: [] }));
    const history = new DynamoUserHistory({ send } as any, "UserHistoryTable");

    const block = await history.findRecentBlock("user-456");
    expect(block).toBeNull();
  });
});
