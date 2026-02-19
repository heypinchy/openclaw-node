import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import {
  installMockWebSocket,
  getMockWs,
  completeHandshake,
} from "./helpers/mock-ws";

describe("Chat streaming", () => {
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

  it("sends agent request with message content", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    // Start chat (don't await -- it's an async generator)
    const gen = client.chat("Hello");
    // Pull one iteration to trigger the send
    const iterPromise = gen.next();

    // Check the sent message
    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent");
    expect(sentMsg.params.message).toBe("Hello");

    // Clean up: send done response so the generator finishes
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: {},
    });

    await iterPromise;
    // Drain the generator
    for await (const _ of gen) {
      // just consume
    }
  });

  it("yields streamed text chunks from agent.chunk events", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: string[] = [];
    const gen = client.chat("Hello");

    // Start consuming in background
    const consumePromise = (async () => {
      for await (const chunk of gen) {
        if (chunk.type === "text") {
          chunks.push(chunk.text);
        }
      }
    })();

    // Wait a tick for the generator to start
    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Send streaming chunks with matching runId
    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { runId: requestId, text: "Hello" },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { runId: requestId, text: " world" },
    });

    // Send done signal
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: {},
    });

    await consumePromise;

    expect(chunks).toEqual(["Hello", " world"]);
  });

  it("chatSync returns complete concatenated text", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const resultPromise = client.chatSync("Hello");

    // Wait a tick for the request to be sent
    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Send streaming chunks
    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { runId: requestId, text: "The " },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { runId: requestId, text: "answer " },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent.chunk",
      payload: { runId: requestId, text: "is 42." },
    });

    // Send done signal
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: {},
    });

    const result = await resultPromise;
    expect(result).toBe("The answer is 42.");
  });

  it("passes agentId in request params when provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("Hello", { agentId: "agent-123" });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.agentId).toBe("agent-123");

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: {},
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });
});
