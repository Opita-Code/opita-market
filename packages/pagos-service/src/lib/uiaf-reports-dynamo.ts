/**
 * DynamoDB-backed UIAF reports store (production).
 *
 * Table: UiafReportsTable
 *   pk: sar_id
 *   ttl: 5 years
 */

import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { type UiafReportsStore, type SarRecord } from "./uiaf-reports.js";

export class DynamoUiafReportsStore implements UiafReportsStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(sar: SarRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          sar_id: sar.sarId,
          user_id: sar.userId,
          total_amount_cop: sar.totalAmountCop,
          transactions: sar.transactions,
          reason: sar.reason,
          generated_at: sar.generatedAtIso,
          status: sar.status,
          uiaf_reference_number: sar.uiafReferenceNumber,
          xml_payload: sar.xmlPayload,
          filed_at: sar.filedAtIso,
          uiaf_confirmation_number: sar.uiafConfirmationNumber,
          ttl_epoch: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60,
        },
      }),
    );
  }

  async list(filter: { status?: string; userId?: string }): Promise<SarRecord[]> {
    // For simplicity, full scan with filter — production should add a GSI on status
    // For now (low volume SARs), scan is acceptable.
    // TODO: add StatusIndex GSI when SAR volume > 100/day
    const all: SarRecord[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result: { Items?: any[]; LastEvaluatedKey?: Record<string, any> } =
        await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: "sar_id <> :empty",
            FilterExpression: filter.status
              ? "#s = :status"
              : filter.userId
              ? "user_id = :uid"
              : undefined,
            ExpressionAttributeNames: filter.status ? { "#s": "status" } : undefined,
            ExpressionAttributeValues: filter.status
              ? { ":empty": "", ":status": filter.status }
              : filter.userId
              ? { ":empty": "", ":uid": filter.userId }
              : { ":empty": "" },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
      for (const item of result.Items ?? []) {
        all.push({
          sarId: item.sar_id as string,
          userId: item.user_id as string,
          totalAmountCop: item.total_amount_cop as number,
          transactions: (item.transactions as SarRecord["transactions"]) ?? [],
          reason: item.reason as SarRecord["reason"],
          generatedAtIso: item.generated_at as string,
          status: item.status as SarRecord["status"],
          uiafReferenceNumber: item.uiaf_reference_number as string,
          xmlPayload: item.xml_payload as string,
          filedAtIso: item.filed_at as string | undefined,
          uiafConfirmationNumber: item.uiaf_confirmation_number as string | undefined,
        });
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return all;
  }
}
