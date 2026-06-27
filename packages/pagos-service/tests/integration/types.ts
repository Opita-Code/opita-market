export interface TestUser {
  email: string;
  groups: string[];
  deviceId?: string;
  ip?: string;
}

export interface TestClient {
  api: any;
  currentUser: TestUser | null;
  geoCache: Map<string, any>;
  fraudSignals: any[];
  bonusCalls: Array<{ userId: string; ruleId: string }>;
}