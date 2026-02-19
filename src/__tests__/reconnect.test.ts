import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import {
  installMockWebSocket,
  getMockWs,
  completeHandshake,
} from "./helpers/mock-ws";

describe("Auto-reconnect with exponential backoff", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    vi.useFakeTimers();
    installMockWebSocket();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reconnects after unexpected close", async () => {
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 5,
    });

    await completeHandshake(client);
    const ws1 = getMockWs();

    // Simulate unexpected close
    ws1.simulateClose();

    // Advance timer past the first reconnect delay (1s)
    await vi.advanceTimersByTimeAsync(1000);

    // A new WebSocket should have been created
    const ws2 = getMockWs();
    expect(ws2).not.toBe(ws1);
  });

  it("uses exponential backoff: 1s, 2s, 4s, 8s", async () => {
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 10,
    });

    // Suppress error events from failed reconnects
    client.on("error", () => {});

    await completeHandshake(client);

    // 1st close -> delay should be 1s (1000 * 2^0)
    const ws1 = getMockWs();
    ws1.simulateClose();

    // At 999ms, no reconnect yet
    await vi.advanceTimersByTimeAsync(999);
    expect(getMockWs()).toBe(ws1);

    // At 1000ms, reconnect happens
    await vi.advanceTimersByTimeAsync(1);
    const ws2 = getMockWs();
    expect(ws2).not.toBe(ws1);

    // Simulate the reconnect failing (close again without handshake)
    ws2.simulateClose();

    // 2nd close -> delay should be 2s (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(1999);
    expect(getMockWs()).toBe(ws2);

    await vi.advanceTimersByTimeAsync(1);
    const ws3 = getMockWs();
    expect(ws3).not.toBe(ws2);

    // Simulate the reconnect failing again
    ws3.simulateClose();

    // 3rd close -> delay should be 4s (1000 * 2^2)
    await vi.advanceTimersByTimeAsync(3999);
    expect(getMockWs()).toBe(ws3);

    await vi.advanceTimersByTimeAsync(1);
    const ws4 = getMockWs();
    expect(ws4).not.toBe(ws3);

    // Simulate the reconnect failing again
    ws4.simulateClose();

    // 4th close -> delay should be 8s (1000 * 2^3)
    await vi.advanceTimersByTimeAsync(7999);
    expect(getMockWs()).toBe(ws4);

    await vi.advanceTimersByTimeAsync(1);
    const ws5 = getMockWs();
    expect(ws5).not.toBe(ws4);
  });

  it("stops reconnecting after max attempts and emits error", async () => {
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 2,
    });

    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    await completeHandshake(client);

    // 1st unexpected close -> triggers reconnect attempt 1
    getMockWs().simulateClose();
    await vi.advanceTimersByTimeAsync(1000);

    // Reconnect attempt 1 fails
    getMockWs().simulateClose();
    await vi.advanceTimersByTimeAsync(2000);

    // Reconnect attempt 2 fails - this should hit max
    const wsBeforeMax = getMockWs();
    getMockWs().simulateClose();

    // No more reconnect attempts should happen
    await vi.advanceTimersByTimeAsync(60000);
    expect(getMockWs()).toBe(wsBeforeMax);

    // Should have emitted an error with "Max reconnect" message
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Max reconnect"),
      })
    );
  });

  it("does NOT reconnect after explicit disconnect()", async () => {
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 5,
    });

    await completeHandshake(client);
    const wsBeforeDisconnect = getMockWs();

    // Explicit disconnect
    await client.disconnect();

    // Wait long enough for any reconnect to trigger
    await vi.advanceTimersByTimeAsync(10000);

    // Should not have created a new WebSocket
    expect(getMockWs()).toBe(wsBeforeDisconnect);
  });

  it("resets backoff counter after successful reconnect", async () => {
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 10,
    });

    client.on("error", () => {});

    await completeHandshake(client);

    // 1st close -> delay 1s, attempt counter becomes 1
    getMockWs().simulateClose();
    await vi.advanceTimersByTimeAsync(1000);

    // Reconnect attempt 1 fails
    getMockWs().simulateClose();
    await vi.advanceTimersByTimeAsync(2000);

    // Reconnect attempt 2 - this time complete the handshake
    const ws3 = getMockWs();
    ws3.simulateOpen();
    ws3.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "test-nonce", ts: Date.now() },
    });
    const req = JSON.parse(ws3.sent[ws3.sent.length - 1]);
    ws3.simulateMessage({
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      },
    });

    // Now close again - backoff should be reset, so delay = 1s (not 8s)
    ws3.simulateClose();

    // At 999ms nothing yet
    await vi.advanceTimersByTimeAsync(999);
    expect(getMockWs()).toBe(ws3);

    // At 1000ms reconnect should trigger (proving backoff was reset to 1s)
    await vi.advanceTimersByTimeAsync(1);
    expect(getMockWs()).not.toBe(ws3);
  });
});
