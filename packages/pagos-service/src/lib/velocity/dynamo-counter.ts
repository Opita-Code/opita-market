/**
 * DynamoDB-backed velocity counter (production).
 *
 * Semantics:
 *   - counter_id = `${type}:${value}:${windowSec}`
 *   - TTL = window + 1 hour (per spec R1)
 *   - Atomic increment via UpdateCommand ADD count :one
 *   - Returns new count value
 *
 * DynamoDB schema (sst.config.ts):
 *   pk: counter_id, range key: window (per spec: counter_id = type:value:window)
 *
 * NOTE: For SST v4, the spec says pk = counter_id alone with embedded window.
 * We use counter_id as the PK (which already includes windowSec to keep it unique).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { VelocityCounter, IncrementInput, IncrementResult } from "./types.js";
import { validateIncrementInput } from "./types.js";

export class DynamoVelocityCounter implements VelocityCounter {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async increment(input: IncrementInput): Promise<IncrementResult> {
    validateIncrementInput(input);
    const counterId = `${input.type}:${input.value}:${input.windowSec}`;
    const nowSec = input.nowSec ? input.nowSec() : Math.floor(this.clock() / 1000);
    const ttlEpoch = nowSec + input.ttlSec;

    // Atomic increment + set TTL on first write. If record exists, ADD is no-op on TTL.
    // Use SET for TTL on first insert via "if_not_exists".
    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
        UpdateExpression: "ADD count :one SET ttl_epoch = if_not_exists(ttl_epoch, :ttl)",
        ExpressionAttributeValues: {
          ":one": 1,
          ":ttl": ttlEpoch,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    const count = (result.Attributes?.count as number) ?? 1;
    return { count };
  }

  /** Test helper — read current count without incrementing. */
  async peek(counterId: string): Promise<number | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
      }),
    );
    return (result.Item?.count as number) ?? null;
  }
}
