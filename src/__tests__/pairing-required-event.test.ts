import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("pairingRequired event", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pairing-test-"));
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "test-token",
      deviceIdentityPath: path.join(tmpDir, "device-identity.json"),
      autoReconnect: false,
    });
    await completeHandshake(client);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await client.disconnect();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits pairingRequired with parsed requestId+reason on close 1008 with full pairing reason", () => {
    const pairingHandler = vi.fn();
    client.on("pairingRequired", pairingHandler);

    getMockWs().simulateClose(1008, "pairing required: scope-upgrade (requestId: req-abc-123)");

    expect(pairingHandler).toHaveBeenCalledOnce();
    expect(pairingHandler).toHaveBeenCalledWith({
      requestId: "req-abc-123",
      reason: "scope-upgrade",
      raw: "pairing required: scope-upgrade (requestId: req-abc-123)",
    });
  });

  it("emits pairingRequired without requestId+reason when close reason is bare 'pairing required'", () => {
    const pairingHandler = vi.fn();
    client.on("pairingRequired", pairingHandler);

    getMockWs().simulateClose(1008, "pairing required");

    expect(pairingHandler).toHaveBeenCalledOnce();
    expect(pairingHandler).toHaveBeenCalledWith({
      requestId: undefined,
      reason: undefined,
      raw: "pairing required",
    });
  });

  it("does NOT emit pairingRequired for non-pairing close reasons", async () => {
    const pairingHandler = vi.fn();
    client.on("pairingRequired", pairingHandler);

    // Code 1006, non-pairing reason — must NOT emit pairingRequired
    getMockWs().simulateClose(1006, "abnormal closure");
    expect(pairingHandler).not.toHaveBeenCalled();

    // Reset: reconnect client so we can fire a second close
    await client.disconnect();
    await completeHandshake(client);
    client.on("pairingRequired", pairingHandler);

    // Code 1008, non-pairing reason — must NOT emit pairingRequired
    getMockWs().simulateClose(1008, "auth failed");
    expect(pairingHandler).not.toHaveBeenCalled();
  });

  it("still emits disconnected alongside pairingRequired", () => {
    const pairingHandler = vi.fn();
    const disconnectedHandler = vi.fn();
    client.on("pairingRequired", pairingHandler);
    client.on("disconnected", disconnectedHandler);

    getMockWs().simulateClose(1008, "pairing required (requestId: r1)");

    expect(pairingHandler).toHaveBeenCalledOnce();
    expect(disconnectedHandler).toHaveBeenCalledOnce();
  });
});
