import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import type { ProtocolEvent } from "../types";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

const KEY = "agent:agt-1:direct:usr-1";

describe("sessions.subscribeMessages", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-session-sub-test-"));
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

  /** Subscribe and resolve the subscribe response; returns the handle + captured events. */
  async function subscribe(opts?: { agentId?: string }) {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;
    const events: ProtocolEvent[] = [];
    const subPromise = client.sessions.subscribeMessages(KEY, (e) => events.push(e), opts);

    const subReq = JSON.parse(ws.sent[sentBefore]);
    ws.simulateMessage({ type: "res", id: subReq.id, ok: true, payload: { subscribed: true, key: KEY } });
    const handle = await subPromise;
    return { ws, events, handle, subReq };
  }

  it("sends sessions.messages.subscribe with the key (no agentId when omitted)", async () => {
    const { subReq } = await subscribe();
    expect(subReq.type).toBe("req");
    expect(subReq.method).toBe("sessions.messages.subscribe");
    expect(subReq.params).toEqual({ key: KEY });
    expect("agentId" in subReq.params).toBe(false);
  });

  it("includes agentId when given", async () => {
    const { subReq } = await subscribe({ agentId: "agt-1" });
    expect(subReq.params).toEqual({ key: KEY, agentId: "agt-1" });
  });

  it("delivers session.message snapshot events for the subscribed session", async () => {
    const { ws, events } = await subscribe();
    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { role: "assistant", content: "hi" }, messageSeq: 3 },
    });
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("session.message");
    expect((events[0].payload as { messageSeq?: number }).messageSeq).toBe(3);
  });

  it("delivers word-for-word agent deltas for the subscribed session", async () => {
    const { ws, events } = await subscribe();
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { sessionKey: KEY, runId: "run-1", stream: "assistant", data: { delta: "Hel", text: "Hel" } },
    });
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("agent");
    expect((events[0].payload as { data?: { delta?: string } }).data?.delta).toBe("Hel");
  });

  it("ignores events for a different session", async () => {
    const { ws, events } = await subscribe();
    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: "agent:other:direct:usr-9", message: {} },
    });
    expect(events).toHaveLength(0);
  });

  it("unsubscribe sends sessions.messages.unsubscribe and stops delivering events", async () => {
    const { ws, events, handle } = await subscribe();

    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "first" } },
    });
    expect(events).toHaveLength(1);

    const sentBefore = ws.sent.length;
    const unsubPromise = handle.unsubscribe();
    const unsubReq = JSON.parse(ws.sent[sentBefore]);
    expect(unsubReq.method).toBe("sessions.messages.unsubscribe");
    expect(unsubReq.params).toEqual({ key: KEY });
    ws.simulateMessage({ type: "res", id: unsubReq.id, ok: true, payload: { subscribed: false } });
    await unsubPromise;

    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "after-unsub" } },
    });
    expect(events).toHaveLength(1);
  });

  it("delivers events tagged with the Gateway's canonical key", async () => {
    const canonical = "agent:agt-1:direct:usr-1#canonical";
    const ws = getMockWs();
    const sentBefore = ws.sent.length;
    const events: ProtocolEvent[] = [];
    const subPromise = client.sessions.subscribeMessages(KEY, (e) => events.push(e));

    const subReq = JSON.parse(ws.sent[sentBefore]);
    // Gateway echoes a DIFFERENT canonical key than the caller supplied.
    ws.simulateMessage({
      type: "res",
      id: subReq.id,
      ok: true,
      payload: { subscribed: true, key: canonical },
    });
    await subPromise;

    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { sessionKey: canonical, runId: "r1", stream: "assistant", data: { delta: "hi" } },
    });
    expect(events).toHaveLength(1);
    expect((events[0].payload as { sessionKey?: string }).sessionKey).toBe(canonical);
  });

  it("isolates concurrent subscriptions to different sessions", async () => {
    const keyB = "agent:agt-2:direct:usr-2";
    const ws = getMockWs();

    const aEvents: ProtocolEvent[] = [];
    let s = ws.sent.length;
    const subA = client.sessions.subscribeMessages(KEY, (e) => aEvents.push(e));
    const aReq = JSON.parse(ws.sent[s]);
    ws.simulateMessage({ type: "res", id: aReq.id, ok: true, payload: { subscribed: true, key: KEY } });
    await subA;

    const bEvents: ProtocolEvent[] = [];
    s = ws.sent.length;
    const subB = client.sessions.subscribeMessages(keyB, (e) => bEvents.push(e));
    const bReq = JSON.parse(ws.sent[s]);
    ws.simulateMessage({ type: "res", id: bReq.id, ok: true, payload: { subscribed: true, key: keyB } });
    const handleB = await subB;

    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "for A" } },
    });
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);

    // Unsubscribing B must not affect A.
    s = ws.sent.length;
    const unsubP = handleB.unsubscribe();
    const unsubReq = JSON.parse(ws.sent[s]);
    ws.simulateMessage({ type: "res", id: unsubReq.id, ok: true, payload: { subscribed: false } });
    await unsubP;

    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "for A again" } },
    });
    expect(aEvents).toHaveLength(2);
    expect(bEvents).toHaveLength(0);
  });

  it("removes the listener if the subscribe request rejects", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;
    const events: ProtocolEvent[] = [];
    const subPromise = client.sessions.subscribeMessages(KEY, (e) => events.push(e));

    const subReq = JSON.parse(ws.sent[sentBefore]);
    ws.simulateMessage({
      type: "res",
      id: subReq.id,
      ok: false,
      error: { message: "subscribe denied" },
    });
    await expect(subPromise).rejects.toThrow("subscribe denied");

    // Listener must have been removed — a matching event is ignored.
    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "should be ignored" } },
    });
    expect(events).toHaveLength(0);
  });

  it("unsubscribe never throws even when the unsubscribe RPC fails", async () => {
    // Same catch path as a send on an already-closed socket during teardown.
    const { ws, events, handle } = await subscribe();

    const sentBefore = ws.sent.length;
    const unsubPromise = handle.unsubscribe();
    const unsubReq = JSON.parse(ws.sent[sentBefore]);
    ws.simulateMessage({
      type: "res",
      id: unsubReq.id,
      ok: false,
      error: { message: "unsubscribe failed" },
    });
    await expect(unsubPromise).resolves.toBeUndefined();

    // Listener is still removed despite the failed RPC.
    ws.simulateMessage({
      type: "event",
      event: "session.message",
      payload: { sessionKey: KEY, message: { content: "after-failed-unsub" } },
    });
    expect(events).toHaveLength(0);
  });
});
