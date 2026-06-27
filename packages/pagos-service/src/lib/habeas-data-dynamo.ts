/**
 * DynamoDB-backed Habeas Data store (production).
 *
 * Tables:
 *   - HabeasDataOppositionsTable: pk user_id, range request_id (sortable by date)
 *   - TosAcceptancesTable: pk user_id, range acceptance_id
 *
 * 5-year retention for audit (Ley 1581 + Decreto 1377/2013).
 */

import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  type OppositionStore,
  type OppositionRequest,
  type TosAcceptance,
} from "./habeas-data.js";

export class DynamoOppositionStore implements OppositionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly oppositionsTable: string,
    private readonly tosAcceptancesTable: string,
  ) {}

  async saveOpposition(req: OppositionRequest): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.oppositionsTable,
        Item: {
          user_id: req.userId,
          request_id: req.requestId,
          request_type: req.requestType,
          reason: req.reason,
          status: req.status,
          submitted_at: req.submittedAtIso,
          acknowledgment_deadline: req.acknowledgmentDeadlineIso,
          acknowledged_at: req.acknowledgedAtIso,
          processed_at: req.processedAtIso,
          notes: req.notes,
          // 5y TTL
          ttl_epoch: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60,
        },
      }),
    );
  }

  async listOppositions(userId: string): Promise<OppositionRequest[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.oppositionsTable,
        KeyConditionExpression: "user_id = :uid",
        ExpressionAttributeValues: { ":uid": userId },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      requestId: item.request_id as string,
      userId: item.user_id as string,
      requestType: item.request_type as any,
      reason: item.reason as string,
      status: item.status as any,
      submittedAtIso: item.submitted_at as string,
      acknowledgmentDeadlineIso: item.acknowledgment_deadline as string,
      acknowledgedAtIso: item.acknowledged_at as string | undefined,
      processedAtIso: item.processed_at as string | undefined,
      notes: item.notes as string | undefined,
    }));
  }

  async saveTosAcceptance(acceptance: TosAcceptance): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tosAcceptancesTable,
        Item: {
          user_id: acceptance.userId,
          acceptance_id: acceptance.acceptanceId,
          tos_version: acceptance.tosVersion,
          accepted_at: acceptance.acceptedAtIso,
          ip_address: acceptance.ipAddress,
          user_agent: acceptance.userAgent,
          // 5y TTL for audit
          ttl_epoch: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60,
        },
      }),
    );
  }

  async listTosAcceptances(userId: string): Promise<TosAcceptance[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tosAcceptancesTable,
        KeyConditionExpression: "user_id = :uid",
        ExpressionAttributeValues: { ":uid": userId },
      }),
    );
    return (result.Items ?? []).map((item) => ({
      acceptanceId: item.acceptance_id as string,
      userId: item.user_id as string,
      tosVersion: item.tos_version as string,
      acceptedAtIso: item.accepted_at as string,
      ipAddress: item.ip_address as string,
      userAgent: item.user_agent as string,
    }));
  }
}
