import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

// Regression test for the dispatch-probe E2E flake root cause
// (heypinchy/pinchy#464): when the OpenClaw Gateway restarts (e.g. its
// first-time secrets-bootstrap restart), the WebSocket closes while Pinchy has
// a `config.get`/`config.apply` request in flight. Previously those requests
// were NOT rejected on close — they stalled for the full 30 s request timeout,
// and across a storm of config pushes the stalls compounded so a freshly
// created agent's config never applied within Pinchy's retry budget. The
// dispatch then kept hitting `unknown agent id`.
//
// Pending requests MUST reject immediately when the connection drops, with a
// message Pinchy's reconnect/retry logic recognizes as a disconnect, so it can
// back off and retry the moment the Gateway is back instead of stalling 30 s.

describe("pending request rejection on disconnect", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pending-reject-test-"));
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

  it("rejects an in-flight request promptly when the WebSocket closes (no 30s timeout stall)", async () => {
    const ws = getMockWs();
    // Request sent, response never arrives — it sits in pendingRequests.
    const inflight = client.request("config.get");

    // Gateway restarts: the socket closes before the response.
    ws.simulateClose();

    // Must reject now, with a phrase Pinchy's WS_DISCONNECTED handler matches
    // ("Not connected to OpenClaw Gateway") — not hang until the 30 s timeout.
    await expect(inflight).rejects.toThrow(/Not connected to OpenClaw Gateway/i);
  });

  it("rejects ALL in-flight requests on close, not just one", async () => {
    const ws = getMockWs();
    const a = client.request("config.get");
    const b = client.request("agents.list");

    ws.simulateClose();

    await expect(a).rejects.toThrow(/Not connected to OpenClaw Gateway/i);
    await expect(b).rejects.toThrow(/Not connected to OpenClaw Gateway/i);
  });
});
