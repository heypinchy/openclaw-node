import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import type { AgentWaitResult } from "../types";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("agentWait", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-wait-test-"));
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

  it("sends agent.wait with runId and timeoutMs when timeoutMs is given", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const waitPromise = client.agentWait("run-123", { timeoutMs: 5000 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent.wait");
    expect(sentMsg.params).toEqual({ runId: "run-123", timeoutMs: 5000 });

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "pending" },
    });

    await waitPromise;
  });

  it("sends params without timeoutMs when omitted", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const waitPromise = client.agentWait("run-456");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent.wait");
    expect(sentMsg.params).toEqual({ runId: "run-456" });
    expect("timeoutMs" in sentMsg.params).toBe(false);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "pending" },
    });

    await waitPromise;
  });

  it("resolves to the response payload typed as AgentWaitResult", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const waitPromise = client.agentWait("run-789", { timeoutMs: 1000 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const payload: AgentWaitResult = {
      status: "pending",
      runId: "run-789",
      livenessState: "working",
      endedAt: undefined,
    };

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload,
    });

    const result = await waitPromise;
    expect(result).toEqual(payload);
    expect(result.status).toBe("pending");
    expect(result.livenessState).toBe("working");
  });

  it("resolves a terminal run with endedAt and stopReason", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const waitPromise = client.agentWait("run-done", { timeoutMs: 1000 });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const payload: AgentWaitResult = {
      status: "ok",
      runId: "run-done",
      endedAt: 1718539200000,
      stopReason: "completed",
      yielded: false,
      providerStarted: true,
    };

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload,
    });

    const result = await waitPromise;
    expect(result).toEqual(payload);
    expect(result.status).toBe("ok");
    expect(result.endedAt).toBe(1718539200000);
    expect(result.stopReason).toBe("completed");
  });
});
