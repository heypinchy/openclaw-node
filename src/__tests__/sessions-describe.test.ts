import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import type { SessionDescribeResult } from "../types";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("sessions.describe", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sessions-describe-test-"));
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

  it("sends sessions.describe with key and no agentId when omitted", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const describePromise = client.sessions.describe("agent:agt-1:direct:usr-1");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("sessions.describe");
    expect(sentMsg.params).toEqual({ key: "agent:agt-1:direct:usr-1" });
    expect("agentId" in sentMsg.params).toBe(false);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { key: "agent:agt-1:direct:usr-1", exists: true },
    });

    await describePromise;
  });

  it("includes agentId when given", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const describePromise = client.sessions.describe("agent:agt-1:direct:usr-1", {
      agentId: "agt-1",
    });

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.method).toBe("sessions.describe");
    expect(sentMsg.params).toEqual({ key: "agent:agt-1:direct:usr-1", agentId: "agt-1" });

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { key: "agent:agt-1:direct:usr-1", exists: true },
    });

    await describePromise;
  });

  it("resolves to the response payload typed as SessionDescribeResult", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const describePromise = client.sessions.describe("agent:agt-1:direct:usr-1");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const payload: SessionDescribeResult = {
      key: "agent:agt-1:direct:usr-1",
      exists: true,
      status: "processing",
      activeRunId: "run-1",
      lastActivityAt: 1718539200000,
    };

    ws.simulateMessage({ type: "res", id: sentMsg.id, ok: true, payload });

    const result = await describePromise;
    expect(result).toEqual(payload);
    expect(result.exists).toBe(true);
    expect(result.activeRunId).toBe("run-1");
  });

  it("resolves a not-found session", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const describePromise = client.sessions.describe("agent:gone:direct:usr-1");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { exists: false },
    });

    const result = await describePromise;
    expect(result.exists).toBe(false);
  });
});
