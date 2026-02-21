import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Insecure transport warning", () => {
  beforeEach(() => {
    installMockWebSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when using ws:// URL with a token", () => {
    const warnSpy = vi.spyOn(process, "emitWarning");

    new OpenClawClient({
      url: "ws://localhost:18789",
      token: "secret-token",
      autoReconnect: false,
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure ws://"),
      "InsecureTransportWarning",
    );
  });

  it("does not warn when using wss:// URL with a token", () => {
    const warnSpy = vi.spyOn(process, "emitWarning");

    new OpenClawClient({
      url: "wss://gateway.example.com",
      token: "secret-token",
      autoReconnect: false,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when using ws:// URL without a token", () => {
    const warnSpy = vi.spyOn(process, "emitWarning");

    new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: false,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("Message size limit", () => {
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

  it("rejects messages exceeding maxMessageSize", async () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    const oversizedPayload = "x".repeat(6 * 1024 * 1024); // 6MB > default 5MB
    ws.simulateRawMessage(oversizedPayload);

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("exceeds limit");
  });

  it("accepts messages within maxMessageSize", async () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    // Send a normal-sized valid protocol message
    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { text: "hello" },
    });

    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("allows custom maxMessageSize via options", async () => {
    await client.disconnect();

    const smallClient = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: false,
      maxMessageSize: 1024,
    });
    await completeHandshake(smallClient);

    const errorHandler = vi.fn();
    smallClient.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateRawMessage("x".repeat(1025));

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("exceeds limit");

    await smallClient.disconnect();
  });
});

describe("Protocol message validation", () => {
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

  it("rejects messages with invalid type field", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({ type: "invalid", data: "foo" });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("Invalid protocol message");
  });

  it("rejects messages missing required type field", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({ foo: "bar" });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("Invalid protocol message");
  });

  it("rejects res messages missing id field", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({ type: "res", ok: true, payload: {} });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("Invalid protocol message");
  });

  it("rejects event messages missing event field", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({ type: "event", payload: {} });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].message).toContain("Invalid protocol message");
  });

  it("accepts valid event messages", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { text: "hello" },
    });

    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("accepts valid res messages", () => {
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const ws = getMockWs();
    ws.simulateMessage({
      type: "res",
      id: "some-id",
      ok: true,
      payload: {},
    });

    expect(errorHandler).not.toHaveBeenCalled();
  });
});
