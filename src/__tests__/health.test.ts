import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Health check", () => {
  let client: OpenClawClient;

  beforeEach(async () => {
    installMockWebSocket();
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: false,
    });
    await completeHandshake(client);
  });

  afterEach(async () => {
    await client.disconnect();
    vi.restoreAllMocks();
  });

  it("sends health request and returns result", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const healthPromise = client.health();

    // Verify the sent message
    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("health");
    expect(sentMsg.params).toEqual({});

    // Simulate a successful response
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok", uptime: 12345 },
    });

    const result = await healthPromise;
    expect(result).toEqual({ status: "ok", uptime: 12345 });
  });

  it("times out after 5 seconds (not 30)", async () => {
    vi.useFakeTimers();

    const healthPromise = client.health();

    // At 4999ms, should not have timed out yet
    vi.advanceTimersByTime(4999);

    // The promise should still be pending
    const raceResult4s = await Promise.race([
      healthPromise.then(() => "resolved").catch(() => "rejected"),
      Promise.resolve("pending"),
    ]);
    expect(raceResult4s).toBe("pending");

    // At 5000ms, should time out
    vi.advanceTimersByTime(1);

    await expect(healthPromise).rejects.toThrow("Health check timed out");

    vi.useRealTimers();
  });
});
