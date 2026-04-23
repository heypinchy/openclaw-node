import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenClawClient } from "../client";
import {
  installMockWebSocket,
  getMockWs,
  completeHandshake,
} from "./helpers/mock-ws";

describe("userMessagePersisted chunk", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-persist-test-"),
    );
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

  it("emits userMessagePersisted chunk after accepted response, before first text chunk", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; clientMessageId?: string; sessionKey?: string; persistedAt?: number }[] = [];

    const gen = client.chat("hi", {
      sessionKey: "test:1",
      clientMessageId: "abc-123",
    });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Gateway sends accepted (user message persisted)
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Wait a tick so the userMessagePersisted chunk can be queued
    await new Promise((r) => setTimeout(r, 0));

    // Gateway streams assistant text
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Hello!", delta: "Hello!" },
      },
    });

    // Gateway sends final ok
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const persistIdx = chunks.findIndex((c) => c.type === "userMessagePersisted");
    const firstTextIdx = chunks.findIndex((c) => c.type === "text");

    expect(persistIdx).toBeGreaterThanOrEqual(0);
    expect(firstTextIdx).toBeGreaterThan(persistIdx);

    const persistChunk = chunks[persistIdx];
    expect(persistChunk.clientMessageId).toBe("abc-123");
    expect(persistChunk.sessionKey).toBe("test:1");
    expect(typeof persistChunk.persistedAt).toBe("number");
  });

  it("omits userMessagePersisted chunk when clientMessageId is not provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string }[] = [];

    const gen = client.chat("hi", { sessionKey: "test:2" });

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
      payload: { runId: requestId, status: "accepted" },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    expect(chunks.some((c) => c.type === "userMessagePersisted")).toBe(false);
  });

  it("passes clientMessageId through in the request params", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("hi", {
      sessionKey: "test:3",
      clientMessageId: "msg-xyz",
    });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.clientMessageId).toBeUndefined(); // not forwarded to OpenClaw

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
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
