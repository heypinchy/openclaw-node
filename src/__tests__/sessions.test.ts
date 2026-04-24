import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Session helpers", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-test-"));
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

  it("sessions.list sends sessions.list method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const listPromise = client.sessions.list({ limit: 10 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("sessions.list");
    expect(sentMsg.params.limit).toBe(10);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { sessions: [] },
    });

    const result = await listPromise;
    expect(result).toEqual({ sessions: [] });
  });

  it("sessions.history sends chat.history method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const historyPromise = client.sessions.history("my-session-key");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("chat.history");
    expect(sentMsg.params.sessionKey).toBe("my-session-key");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { messages: [] },
    });

    const result = await historyPromise;
    expect(result).toEqual({ messages: [] });
  });

  it("sessions.history passes limit option", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const historyPromise = client.sessions.history("key-1", { limit: 50 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.method).toBe("chat.history");
    expect(sentMsg.params.sessionKey).toBe("key-1");
    expect(sentMsg.params.limit).toBe(50);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { messages: [] },
    });

    await historyPromise;
  });

  it("sessions.delete sends sessions.delete method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const deletePromise = client.sessions.delete("my-session-key");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("sessions.delete");
    expect(sentMsg.params.key).toBe("my-session-key");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const result = await deletePromise;
    expect(result).toEqual({ status: "ok" });
  });

  it("sessions.delete passes deleteTranscript option", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const deletePromise = client.sessions.delete("key-1", { deleteTranscript: true });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.method).toBe("sessions.delete");
    expect(sentMsg.params.key).toBe("key-1");
    expect(sentMsg.params.deleteTranscript).toBe(true);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    await deletePromise;
  });

  it("sessions.reset sends sessions.reset method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const resetPromise = client.sessions.reset("my-session-key");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("sessions.reset");
    expect(sentMsg.params.key).toBe("my-session-key");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const result = await resetPromise;
    expect(result).toEqual({ status: "ok" });
  });

  it("sessions.compact sends sessions.compact method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const compactPromise = client.sessions.compact("my-session-key", { maxLines: 100 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("sessions.compact");
    expect(sentMsg.params.key).toBe("my-session-key");
    expect(sentMsg.params.maxLines).toBe(100);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const result = await compactPromise;
    expect(result).toEqual({ status: "ok" });
  });

  it("sessions.send sends chat.send method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const sendPromise = client.sessions.send("my-session-key", "Hello!");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("chat.send");
    expect(sentMsg.params.sessionKey).toBe("my-session-key");
    expect(sentMsg.params.message).toBe("Hello!");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const result = await sendPromise;
    expect(result).toEqual({ status: "ok" });
  });
});
