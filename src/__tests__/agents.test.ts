import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Agent helpers", () => {
  let client: OpenClawClient;
  let tmpDir: string;

  beforeEach(async () => {
    installMockWebSocket();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agents-test-"));
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

  it("agents.list sends agents.list method and returns the runtime agent list", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const listPromise = client.agents.list();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agents.list");
    // agents.list takes no required params
    expect(sentMsg.params).toEqual({});

    // Shape mirrors OC 2026.5.28 listAgentsForGateway(): a header plus an
    // `agents` array of entries each carrying at least an `id`.
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: {
        defaultId: "smithers",
        mainKey: "smithers",
        scope: "per-sender",
        agents: [
          { id: "smithers", name: "Smithers" },
          { id: "odoo-operator", name: "Odoo Operator" },
        ],
      },
    });

    const result = await listPromise;
    expect(result.defaultId).toBe("smithers");
    expect(result.agents.map((a) => a.id)).toEqual(["smithers", "odoo-operator"]);
  });

  it("agents.list rejects when the Gateway returns an error", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const listPromise = client.agents.list();
    const sentMsg = JSON.parse(ws.sent[sentBefore]);

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    });

    await expect(listPromise).rejects.toThrow(/boom/);
  });
});
