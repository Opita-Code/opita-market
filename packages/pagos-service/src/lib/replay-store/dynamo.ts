/**
 * DynamoDB-backed EventReplayStore for the webhook gateway.
 *
 * Persists processed event_ids in the ProcessedWebhooksTable (DynamoDB).
 * TTL: 7 days (configurable). Used to detect duplicate webhook deliveries
 * (idempotency).
 *
 * Closes: OPL-API-004 (webhook idempotency).
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ReplayStore } from "../webhook-gateway/types.js";

export class DynamoReplayStore implements ReplayStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly ttlDays: number = 7,
  ) {}

  async isProcessed(eventId: string): Promise<boolean> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { event_id: eventId },
      }),
    );
    return result.Item !== undefined;
  }

  async markProcessed(eventId: string, txId: string): Promise<void> {
    const now = Date.now();
    const ttlEpoch = Math.floor(now / 1000) + this.ttlDays * 24 * 60 * 60;
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            event_id: eventId,
            tx_id: txId,
            processed_at: new Date(now).toISOString(),
            ttl_epoch: ttlEpoch,
          },
          // Atomic idempotency: only insert if event_id doesn't exist.
          // If a concurrent delivery already inserted, we ignore the error
          // (the other delivery is processing the same event).
          ConditionExpression: "attribute_not_exists(event_id)",
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
        // Already processed by a concurrent delivery — safe to ignore.
        return;
      }
      throw err;
    }
  }
}
