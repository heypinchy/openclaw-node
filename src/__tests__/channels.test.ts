import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Channel status helpers", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channels-test-"));
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

  it("channels.status sends channels.status method", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const statusPromise = client.channels.status();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("channels.status");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { telegram: { connected: true }, slack: { connected: false } },
    });

    const result = await statusPromise;
    expect(result).toEqual({ telegram: { connected: true }, slack: { connected: false } });
  });
});

describe("Pairing helpers", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pairing-test-"));
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

  it("pairing.list sends pairing.list method with channel parameter", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const listPromise = client.pairing.list("telegram");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("pairing.list");
    expect(sentMsg.params.channel).toBe("telegram");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { requests: [] },
    });

    const result = await listPromise;
    expect(result).toEqual({ requests: [] });
  });

  it("pairing.approve sends pairing.approve method with channel and code", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const approvePromise = client.pairing.approve("telegram", "ABC123");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("pairing.approve");
    expect(sentMsg.params.channel).toBe("telegram");
    expect(sentMsg.params.code).toBe("ABC123");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "approved" },
    });

    const result = await approvePromise;
    expect(result).toEqual({ status: "approved" });
  });
});
