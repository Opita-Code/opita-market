/**
 * DynamoDB-backed bonus daily counter (production).
 *
 * Schema (sst.config.ts):
 *   pk: counter_id = `${userId}:${ruleId}:${YYYY-MM-DD}` (UTC date)
 *   ttl_epoch: 7 days from creation
 *
 * Atomic semantics:
 *   - add() uses UpdateCommand with ADD amount_cop :amt, claims_count :one
 *   - SET ttl_epoch = if_not_exists(ttl_epoch, :ttl)
 *   - ReturnValues ALL_NEW returns the new state
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  DAILY_COUNTER_TTL_SEC,
  dailyCounterKey,
  type BonusDailyCounter,
  type DailyCounterInput,
  type DailyCounterState,
} from "./bonus-daily-counter.js";

export class DynamoBonusDailyCounter implements BonusDailyCounter {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async get(input: { userId: string; ruleId: string; nowMs?: number }): Promise<DailyCounterState | null> {
    const nowMs = input.nowMs ?? this.clock();
    const counterId = dailyCounterKey(input.userId, input.ruleId, nowMs);
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
      }),
    );
    if (!result.Item) return null;
    return {
      amountCop: (result.Item.amount_cop as number) ?? 0,
      claimsCount: (result.Item.claims_count as number) ?? 0,
    };
  }

  async add(input: DailyCounterInput): Promise<DailyCounterState> {
    const counterId = dailyCounterKey(input.userId, input.ruleId, input.nowMs);
    const ttlEpoch = Math.floor(input.nowMs / 1000) + DAILY_COUNTER_TTL_SEC;

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
        UpdateExpression:
          "ADD amount_cop :amt, claims_count :one SET ttl_epoch = if_not_exists(ttl_epoch, :ttl)",
        ExpressionAttributeValues: {
          ":amt": input.amountCop,
          ":one": 1,
          ":ttl": ttlEpoch,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    return {
      amountCop: (result.Attributes?.amount_cop as number) ?? input.amountCop,
      claimsCount: (result.Attributes?.claims_count as number) ?? 1,
    };
  }
}
