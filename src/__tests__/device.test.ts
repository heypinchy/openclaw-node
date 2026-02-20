import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  generateDeviceIdentity,
  loadOrCreateDeviceIdentity,
  buildSignedDevice,
} from "../device";

describe("Device Identity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-device-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateDeviceIdentity", () => {
    it("should generate a valid Ed25519 identity", () => {
      const identity = generateDeviceIdentity();

      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(identity.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    });

    it("should generate unique identities each time", () => {
      const a = generateDeviceIdentity();
      const b = generateDeviceIdentity();

      expect(a.deviceId).not.toBe(b.deviceId);
    });
  });

  describe("loadOrCreateDeviceIdentity", () => {
    it("should create a new identity file when none exists", () => {
      const filePath = path.join(tmpDir, "identity.json");

      const identity = loadOrCreateDeviceIdentity(filePath);

      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("should load an existing identity file", () => {
      const filePath = path.join(tmpDir, "identity.json");

      const first = loadOrCreateDeviceIdentity(filePath);
      const second = loadOrCreateDeviceIdentity(filePath);

      expect(second.deviceId).toBe(first.deviceId);
      expect(second.publicKeyPem).toBe(first.publicKeyPem);
    });

    it("should create parent directories if they don't exist", () => {
      const filePath = path.join(tmpDir, "nested", "dir", "identity.json");

      const identity = loadOrCreateDeviceIdentity(filePath);

      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("buildSignedDevice", () => {
    it("should build a signed device identity for the connect request", () => {
      const identity = generateDeviceIdentity();
      const nonce = "test-nonce-123";

      const device = buildSignedDevice({
        identity,
        nonce,
        clientId: "gateway-client",
        clientMode: "backend",
        role: "operator",
        scopes: ["operator.admin"],
        token: "some-token",
      });

      expect(device.id).toBe(identity.deviceId);
      expect(device.publicKey).toBeDefined();
      expect(device.signature).toBeDefined();
      expect(typeof device.signedAt).toBe("number");
      expect(device.nonce).toBe(nonce);
    });

    it("should produce a signature that can be verified", async () => {
      const crypto = await import("crypto");
      const identity = generateDeviceIdentity();
      const nonce = "verify-nonce";

      const device = buildSignedDevice({
        identity,
        nonce,
        clientId: "gateway-client",
        clientMode: "backend",
        role: "operator",
        scopes: ["operator.admin"],
        token: "test-token",
      });

      // Reconstruct the payload the same way OpenClaw does
      const payload = [
        "v2",
        identity.deviceId,
        "gateway-client",
        "backend",
        "operator",
        "operator.admin",
        String(device.signedAt),
        "test-token",
        nonce,
      ].join("|");

      // Decode base64url signature
      const sig = Buffer.from(
        device.signature!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      );

      // Decode base64url public key to raw bytes
      const pubKeyRaw = Buffer.from(
        device.publicKey!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      );

      // Create SPKI-wrapped public key for Ed25519
      const ED25519_SPKI_PREFIX = Buffer.from(
        "302a300506032b6570032100",
        "hex"
      );
      const key = crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, pubKeyRaw]),
        type: "spki",
        format: "der",
      });

      const isValid = crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);
      expect(isValid).toBe(true);
    });
  });
});
