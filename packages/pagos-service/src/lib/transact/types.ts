/**
 * Transact types — shared by wrapper and high-level operations.
 */

export interface TransactItem {
  /** DynamoDB table name. */
  table: string;
  /** Primary key. */
  key: Record<string, unknown>;
  /** Update expression (e.g., "SET balance_cop = balance_cop - :amt"). */
  updateExpression: string;
  /** Condition expression for atomic check (e.g., "balance_cop >= :amt"). */
  conditionExpression?: string;
  /** Expression attribute values, e.g., { ":amt": 100 }. */
  expressionAttributeValues: Record<string, unknown>;
  /** Expression attribute names for reserved words, e.g., { "#v": "version" }. */
  expressionAttributeNames?: Record<string, string>;
}

export interface TransactRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY: TransactRetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 10,
};

export interface TransactDeps {
  /**
   * DynamoDB client compatible with @aws-sdk/lib-dynamodb's `send` method.
   * Accepts a TransactWriteCommand (from @aws-sdk/lib-dynamodb) or any
   * compatible shape.
   */
  client: {
    send: (command: unknown) => Promise<unknown>;
  };
  retry?: TransactRetryConfig;
  /** Optional sleep function for testing (default: real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}
