import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../src/client";

describe("availableMethods", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-features-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty array before connect", () => {
    const client = new OpenClawClient({
      url: "ws://localhost:18789",
      deviceIdentityPath: path.join(tmpDir, "device-identity.json"),
    });
    expect(client.availableMethods).toEqual([]);
  });

  it("should expose hasMethod helper that returns false before connect", () => {
    const client = new OpenClawClient({
      url: "ws://localhost:18789",
      deviceIdentityPath: path.join(tmpDir, "device-identity-2.json"),
    });
    expect(client.hasMethod("config.patch")).toBe(false);
  });
});
