import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import {
  installMockWebSocket,
  getMockWs,
  completeHandshake,
} from "./helpers/mock-ws";

describe("Request/response correlation", () => {
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

  it("resolves the matching request promise when a response arrives", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const requestPromise = client.request("health", {});

    // Grab the sent request to extract its ID
    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("health");

    // Simulate a matching response
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const response = await requestPromise;
    expect(response.ok).toBe(true);
    expect(response.payload).toEqual({ status: "ok" });
  });

  it("rejects the matching request promise when an error response arrives", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const requestPromise = client.request("sessions.list", {});

    const sentMsg = JSON.parse(ws.sent[sentBefore]);

    // Simulate an error response
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Invalid token" },
    });

    await expect(requestPromise).rejects.toThrow("Invalid token");
  });

  it("times out after 30s if no response arrives", async () => {
    vi.useFakeTimers();

    const requestPromise = client.request("health", {});

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30_000);

    await expect(requestPromise).rejects.toThrow("timed out");

    vi.useRealTimers();
  });

  it("does not resolve a request when the response ID does not match", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const requestPromise = client.request("health", {});

    const sentMsg = JSON.parse(ws.sent[sentBefore]);

    // Send a response with a different ID
    ws.simulateMessage({
      type: "res",
      id: "wrong-id-" + sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    // The promise should still be pending -- verify by racing with a short timeout
    const result = await Promise.race([
      requestPromise.then(() => "resolved"),
      new Promise<string>((r) => setTimeout(() => r("timeout"), 50)),
    ]);

    expect(result).toBe("timeout");

    // Clean up: resolve the actual request so it doesn't leak
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });
    await requestPromise;
  });
});
