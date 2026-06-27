/**
 * Test helper — invokes the Hono app via app.request() (in-process).
 */

import type { TestClient } from "./types.js";

export function uniqueId(prefix = "id"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function mockAuth(client: TestClient, user: { email: string; groups: string[] }): void {
  client.currentUser = user;
}

export function testClient(): TestClient {
  return {
    api: globalThis.__testApp__ as any,
    currentUser: null,
    geoCache: new Map(),
    fraudSignals: [],
    bonusCalls: [],
  };
}

export function makeFetch(client: TestClient) {
  return async (path: string, init: RequestInit = {}) => {
    const app = globalThis.__testApp__;
    const headers = new Headers(init.headers);
    if (client.currentUser) {
      headers.set("x-dev-user", client.currentUser.email);
      headers.set("x-dev-groups", client.currentUser.groups.join(","));
    }
    const url = `http://test.local${path}`;
    const req = new Request(url, { ...init, headers });
    return app.request(req);
  };
}