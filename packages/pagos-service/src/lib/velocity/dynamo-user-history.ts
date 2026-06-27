/**
 * DynamoDB-backed user history (production).
 *
 * Schema:
 *   pk: user_id, range key: block_id = `${timestampMs}#${uuid}`
 *   TTL: ttl_epoch = timestampMs + 30 days
 *
 * Use:
 *   - findRecentBlock(userId) → Query most recent entry where decision=BLOCK
 *   - recordDecision({ userId, decision, reason, timestampMs }) → PutCommand
 */

import { randomUUID } from "node:crypto";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  UserHistory,
  BlockRecord,
  RecordDecisionInput,
} from "./user-history.js";
import { USER_HISTORY_TTL_MS } from "./user-history.js";

export class DynamoUserHistory implements UserHistory {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async recordDecision(input: RecordDecisionInput): Promise<void> {
    const ttlEpoch = Math.floor((input.timestampMs + USER_HISTORY_TTL_MS) / 1000);
    const blockId = `${input.timestampMs}#${randomUUID()}`;
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          user_id: input.userId,
          block_id: blockId,
          decision: input.decision,
          reason: input.reason,
          timestamp_ms: input.timestampMs,
          ttl_epoch: ttlEpoch,
        },
      }),
    );
  }

  async findRecentBlock(userId: string): Promise<BlockRecord | null> {
    const cutoffMs = Date.now() - USER_HISTORY_TTL_MS;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "user_id = :uid",
        FilterExpression: "#d = :block AND timestamp_ms >= :cutoff",
        ExpressionAttributeNames: { "#d": "decision" },
        ExpressionAttributeValues: {
          ":uid": userId,
          ":block": "BLOCK",
          ":cutoff": cutoffMs,
        },
        ScanIndexForward: false, // descending — most recent first
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    if (!item) return null;
    return {
      userId: item.user_id as string,
      reason: item.reason as string,
      timestampMs: item.timestamp_ms as number,
    };
  }
}
