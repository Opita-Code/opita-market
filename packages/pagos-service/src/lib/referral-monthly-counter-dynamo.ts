/**
 * DynamoDB-backed referral monthly counter (production).
 */

import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  REFERRAL_MONTHLY_TTL_SEC,
  monthlyCounterKey,
  type ReferralMonthlyCounter,
} from "./referral-monthly-counter.js";

export class DynamoReferralMonthlyCounter implements ReferralMonthlyCounter {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(input: { referrerUserId: string; nowMs: number }): Promise<number> {
    const counterId = monthlyCounterKey(input.referrerUserId, input.nowMs);
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
      }),
    );
    return (result.Item?.claims_count as number) ?? 0;
  }

  async add(input: { referrerUserId: string; nowMs: number }): Promise<number> {
    const counterId = monthlyCounterKey(input.referrerUserId, input.nowMs);
    const ttlEpoch = Math.floor(input.nowMs / 1000) + REFERRAL_MONTHLY_TTL_SEC;

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { counter_id: counterId },
        UpdateExpression:
          "ADD claims_count :one SET ttl_epoch = if_not_exists(ttl_epoch, :ttl)",
        ExpressionAttributeValues: {
          ":one": 1,
          ":ttl": ttlEpoch,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return (result.Attributes?.claims_count as number) ?? 1;
  }
}
