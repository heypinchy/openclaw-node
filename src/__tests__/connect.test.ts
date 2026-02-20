import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs } from "./helpers/mock-ws";

describe("Connect/handshake", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(() => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-connect-test-"));
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "test-token",
      deviceIdentityPath: path.join(tmpDir, "device-identity.json"),
      clientId: "my-client",
      clientVersion: "1.2.3",
      autoReconnect: false,
    });
  });

  afterEach(async () => {
    await client.disconnect();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("completes the full handshake: challenge -> connect -> hello-ok", async () => {
    const connectPromise = client.connect();
    const ws = getMockWs();

    // Step 1: WebSocket opens
    ws.simulateOpen();

    // Step 2: Server sends challenge event
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-abc", ts: 1700000000000 },
    });

    // Step 3: Client should have sent a connect request
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(connectReq.type).toBe("req");
    expect(connectReq.method).toBe("connect");

    // Step 4: Server responds with hello-ok
    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      },
    });

    // Step 5: connect() resolves with HelloOk
    const helloOk = await connectPromise;
    expect(helloOk).toEqual({
      type: "hello-ok",
      protocol: 3,
      policy: { tickIntervalMs: 15000 },
    });
  });

  it("emits 'connected' event on successful handshake", async () => {
    const connectedHandler = vi.fn();
    client.on("connected", connectedHandler);

    const connectPromise = client.connect();
    const ws = getMockWs();

    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-abc", ts: 1700000000000 },
    });

    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      },
    });

    await connectPromise;

    expect(connectedHandler).toHaveBeenCalledOnce();
    expect(connectedHandler).toHaveBeenCalledWith({
      type: "hello-ok",
      protocol: 3,
      policy: { tickIntervalMs: 15000 },
    });
  });

  it("rejects the connect promise on WebSocket error", async () => {
    // Attach an error listener to prevent EventEmitter from throwing
    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const connectPromise = client.connect();
    const ws = getMockWs();

    ws.simulateError(new Error("Connection refused"));

    await expect(connectPromise).rejects.toThrow("Connection refused");
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("includes client metadata in the connect request", async () => {
    const connectPromise = client.connect();
    const ws = getMockWs();

    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-xyz", ts: 1700000000000 },
    });

    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    const params = connectReq.params;

    // Verify client metadata
    expect(params.client.id).toBe("my-client");
    expect(params.client.version).toBe("1.2.3");

    // Verify signed device identity is included
    expect(params.device).toBeDefined();
    expect(params.device.id).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(params.device.publicKey).toBeDefined();
    expect(params.device.signature).toBeDefined();
    expect(typeof params.device.signedAt).toBe("number");
    expect(params.device.nonce).toBe("nonce-xyz");

    // Verify auth token
    expect(params.auth.token).toBe("test-token");

    // Clean up: complete the handshake
    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      },
    });
    await connectPromise;
  });

  it("sets isConnected to false after disconnect()", async () => {
    // First connect
    const connectPromise = client.connect();
    const ws = getMockWs();

    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-abc", ts: 1700000000000 },
    });

    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      },
    });

    await connectPromise;
    expect(client.isConnected).toBe(true);

    // Now disconnect
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });
});
