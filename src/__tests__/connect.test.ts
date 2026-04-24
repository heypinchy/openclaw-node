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

  it("sends the persisted deviceToken (instead of options.token) when the identity file has one", async () => {
    // Pre-populate the identity file with a deviceToken (as if a previous
    // hello-ok had persisted it). This simulates an already-paired device.
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity, saveDeviceToken } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    saveDeviceToken(identityPath, "persisted-device-token");

    // Fresh client with the same identity path + different bootstrap token
    await client.disconnect();
    const paired = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap-token-should-not-be-used",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });

    const connectPromise = paired.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-pair", ts: 1700000000000 },
    });

    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(connectReq.params.auth.token).toBe("persisted-device-token");

    // Finish handshake to let the test clean up without dangling timers.
    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3, policy: { tickIntervalMs: 15000 } },
    });
    await connectPromise;
    await paired.disconnect();
  });

  it("falls back to options.token when the identity file has no deviceToken", async () => {
    // Default client (no deviceToken persisted) — covered by existing tests,
    // but make the intent explicit so a future refactor can't accidentally
    // invert the preference order.
    const connectPromise = client.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-fresh", ts: 1700000000000 },
    });

    const connectReq = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(connectReq.params.auth.token).toBe("test-token");

    ws.simulateMessage({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3, policy: { tickIntervalMs: 15000 } },
    });
    await connectPromise;
  });

  it("persists deviceToken from hello-ok.auth to the identity file", async () => {
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity } = await import("../device");

    await client.disconnect();
    const fresh = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });
    // No deviceToken in the identity file yet.
    expect(loadOrCreateDeviceIdentity(identityPath).deviceToken).toBeUndefined();

    const connectPromise = fresh.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    const req = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
        auth: {
          deviceToken: "issued-by-gateway",
          role: "operator",
          scopes: ["operator.admin"],
          issuedAtMs: 1700000000000,
        },
      },
    });
    await connectPromise;

    expect(loadOrCreateDeviceIdentity(identityPath).deviceToken).toBe("issued-by-gateway");
    await fresh.disconnect();
  });

  it("updates the persisted deviceToken when the gateway rotates it", async () => {
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity, saveDeviceToken } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    saveDeviceToken(identityPath, "old-device-token");

    await client.disconnect();
    const c = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });

    const connectPromise = c.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    const req = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
        auth: {
          deviceToken: "rotated-device-token",
          role: "operator",
          scopes: ["operator.admin"],
        },
      },
    });
    await connectPromise;

    expect(loadOrCreateDeviceIdentity(identityPath).deviceToken).toBe("rotated-device-token");
    await c.disconnect();
  });

  it("does not crash when hello-ok has no auth block", async () => {
    // Older Gateway versions (pre-deviceToken) omit auth. Must still connect.
    const connectPromise = client.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    const req = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
        // no auth field
      },
    });
    await expect(connectPromise).resolves.toBeDefined();
  });

  it("clears the persisted deviceToken when the connect attempt closes before hello-ok", async () => {
    // Simulates the real failure mode: OpenClaw rejects a stale deviceToken
    // with [ws] code=1008, closing the socket before sending hello-ok.
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity, saveDeviceToken } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    saveDeviceToken(identityPath, "stale-token");

    await client.disconnect();
    const c = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });
    c.on("error", () => {
      // swallow so EventEmitter doesn't throw
    });

    const connectPromise = c.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    // Gateway closes instead of sending hello-ok (auth rejected)
    ws.simulateClose();

    // Let async handlers run
    await connectPromise.catch(() => undefined);

    expect(loadOrCreateDeviceIdentity(identityPath).deviceToken).toBeUndefined();
    await c.disconnect();
  });

  it("falls back to options.token on the next connect after a deviceToken rejection", async () => {
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity, saveDeviceToken } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    saveDeviceToken(identityPath, "stale-token");

    await client.disconnect();
    const c = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });
    c.on("error", () => undefined);

    // First connect attempt — persisted token, gateway closes
    const first = c.connect();
    const ws1 = getMockWs();
    ws1.simulateOpen();
    ws1.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    const firstReq = JSON.parse(ws1.sent[ws1.sent.length - 1]);
    expect(firstReq.params.auth.token).toBe("stale-token");
    ws1.simulateClose();
    await first.catch(() => undefined);

    // Second connect — should now use bootstrap
    const second = c.connect();
    const ws2 = getMockWs();
    ws2.simulateOpen();
    ws2.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "m", ts: 2 },
    });
    const secondReq = JSON.parse(ws2.sent[ws2.sent.length - 1]);
    expect(secondReq.params.auth.token).toBe("bootstrap");

    // Complete handshake to release the promise
    ws2.simulateMessage({
      type: "res",
      id: secondReq.id,
      ok: true,
      payload: { type: "hello-ok", protocol: 3, policy: { tickIntervalMs: 15000 } },
    });
    await second;
    await c.disconnect();
  });

  it("does NOT clear the deviceToken when a successful connect later disconnects", async () => {
    // Regression: network blip after a successful handshake must not wipe credentials.
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity, saveDeviceToken } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    saveDeviceToken(identityPath, "valid-token");

    await client.disconnect();
    const c = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });

    const connectPromise = c.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "n", ts: 1 },
    });
    const req = JSON.parse(ws.sent[ws.sent.length - 1]);
    ws.simulateMessage({
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
        auth: { deviceToken: "valid-token", role: "operator", scopes: ["operator.admin"] },
      },
    });
    await connectPromise;

    // Now simulate a network blip
    ws.simulateClose();

    expect(loadOrCreateDeviceIdentity(identityPath).deviceToken).toBe("valid-token");
    await c.disconnect();
  });

  it("does not touch the identity file when connect fails without a persisted deviceToken", async () => {
    // Safety: we must not delete fields we weren't using.
    const identityPath = path.join(tmpDir, "device-identity.json");
    const { loadOrCreateDeviceIdentity } = await import("../device");
    loadOrCreateDeviceIdentity(identityPath);
    const before = fs.readFileSync(identityPath, "utf8");

    await client.disconnect();
    const c = new OpenClawClient({
      url: "ws://localhost:18789",
      token: "bootstrap",
      deviceIdentityPath: identityPath,
      clientId: "my-client",
      autoReconnect: false,
    });
    c.on("error", () => undefined);

    const p = c.connect();
    const ws = getMockWs();
    ws.simulateOpen();
    ws.simulateClose();
    await p.catch(() => undefined);

    const after = fs.readFileSync(identityPath, "utf8");
    expect(after).toBe(before);
    await c.disconnect();
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
