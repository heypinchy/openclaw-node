import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenClawClient, type ChatChunk } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("continueLastTurn", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-continue-test-"));
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      deviceIdentityPath: path.join(tmpDir, "device-identity.json"),
      autoReconnect: false,
    });
    await completeHandshake(client);
  });

  afterEach(async () => {
    await client.disconnect();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sends agent request without a message field", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.continueLastTurn({ sessionKey: "test:2" });
    const iterPromise = gen.next();

    // The WS message must NOT include a `message` field (no new user message)
    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent");
    expect(sentMsg.params.sessionKey).toBe("test:2");
    expect(sentMsg.params.message).toBeUndefined();

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });

  it("streams assistant response chunks", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: ChatChunk[] = [];
    const gen = client.continueLastTurn({ sessionKey: "test:2" });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Gateway streams the assistant response
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Hello there!", delta: "Hello there!" },
      },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks[0].text).toBe("Hello there!");
  });

  it("yields done chunk at the end of the stream", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: ChatChunk[] = [];
    const gen = client.continueLastTurn({ sessionKey: "test:2" });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
  });

  it("yields error chunk when Gateway responds with an error", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: ChatChunk[] = [];
    const gen = client.continueLastTurn({ sessionKey: "test:2" });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: false,
      error: { code: "session_not_found", message: "Session not found" },
    });

    await consumePromise;

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.text).toBe("Session not found");
  });

  it("does not emit userMessagePersisted chunk (no user message is sent)", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: ChatChunk[] = [];
    const gen = client.continueLastTurn({ sessionKey: "test:2" });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    expect(chunks.some((c) => c.type === "userMessagePersisted")).toBe(false);
  });

  it("includes idempotencyKey in the request params", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.continueLastTurn({ sessionKey: "test:2" });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.idempotencyKey).toBeDefined();
    expect(typeof sentMsg.params.idempotencyKey).toBe("string");

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });
});
