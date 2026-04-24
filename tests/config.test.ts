import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../src/client";

// We test the config namespace by spying on the `request` method
// to avoid needing a real WebSocket connection.

describe("config namespace", () => {
  let client: OpenClawClient;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-config-test-"));
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      deviceIdentityPath: path.join(tmpDir, "device-identity.json"),
    });
    requestSpy = vi.spyOn(client, "request").mockResolvedValue({
      type: "res",
      id: "test-id",
      ok: true,
      payload: { config: { agents: {} }, hash: "abc123" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("config.get", () => {
    it("calls the config.get RPC method", async () => {
      await client.config.get();
      expect(requestSpy).toHaveBeenCalledWith("config.get", {});
    });

    it("returns the response payload", async () => {
      const result = await client.config.get();
      expect(result).toEqual({ config: { agents: {} }, hash: "abc123" });
    });
  });

  describe("config.patch", () => {
    it("passes raw and baseHash correctly", async () => {
      const raw = '{"agents": {"new-agent": {}}}';
      const baseHash = "abc123";

      await client.config.patch(raw, baseHash);

      expect(requestSpy).toHaveBeenCalledWith("config.patch", {
        raw,
        baseHash,
      });
    });

    it("passes optional parameters when provided", async () => {
      const raw = '{"agents": {}}';
      const baseHash = "def456";

      await client.config.patch(raw, baseHash, {
        sessionKey: "session-1",
        note: "test change",
        restartDelayMs: 500,
      });

      expect(requestSpy).toHaveBeenCalledWith("config.patch", {
        raw,
        baseHash,
        sessionKey: "session-1",
        note: "test change",
        restartDelayMs: 500,
      });
    });

    it("returns the response payload", async () => {
      const result = await client.config.patch("{}", "hash");
      expect(result).toEqual({ config: { agents: {} }, hash: "abc123" });
    });
  });

  describe("config.apply", () => {
    it("works without baseHash", async () => {
      const raw = '{"agents": {}}';

      await client.config.apply(raw);

      expect(requestSpy).toHaveBeenCalledWith("config.apply", {
        raw,
      });
    });

    it("passes baseHash when provided", async () => {
      const raw = '{"agents": {}}';
      const baseHash = "xyz789";

      await client.config.apply(raw, baseHash);

      expect(requestSpy).toHaveBeenCalledWith("config.apply", {
        raw,
        baseHash,
      });
    });

    it("passes optional parameters when provided", async () => {
      const raw = '{"agents": {}}';

      await client.config.apply(raw, undefined, {
        sessionKey: "session-2",
        note: "full apply",
        restartDelayMs: 1000,
      });

      expect(requestSpy).toHaveBeenCalledWith("config.apply", {
        raw,
        sessionKey: "session-2",
        note: "full apply",
        restartDelayMs: 1000,
      });
    });

    it("returns the response payload", async () => {
      const result = await client.config.apply("{}");
      expect(result).toEqual({ config: { agents: {} }, hash: "abc123" });
    });
  });
});
