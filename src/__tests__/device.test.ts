import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  generateDeviceIdentity,
  loadOrCreateDeviceIdentity,
  buildSignedDevice,
  saveDeviceToken,
  clearDeviceToken,
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
      const sig = Buffer.from(device.signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64");

      // Decode base64url public key to raw bytes
      const pubKeyRaw = Buffer.from(
        device.publicKey!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      );

      // Create SPKI-wrapped public key for Ed25519
      const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
      const key = crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, pubKeyRaw]),
        type: "spki",
        format: "der",
      });

      const isValid = crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);
      expect(isValid).toBe(true);
    });
  });

  describe("deviceToken persistence", () => {
    it("loadOrCreateDeviceIdentity returns deviceToken when the file has one", () => {
      const filePath = path.join(tmpDir, "identity.json");
      const first = loadOrCreateDeviceIdentity(filePath);
      expect(first.deviceToken).toBeUndefined();

      // Simulate a previously-persisted deviceToken (e.g. after a hello-ok)
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      raw.deviceToken = "persisted-device-token";
      fs.writeFileSync(filePath, JSON.stringify(raw));

      const reloaded = loadOrCreateDeviceIdentity(filePath);
      expect(reloaded.deviceToken).toBe("persisted-device-token");
      expect(reloaded.deviceId).toBe(first.deviceId);
      expect(reloaded.privateKeyPem).toBe(first.privateKeyPem);
    });

    it("saveDeviceToken writes the token to the identity file without touching the keypair", () => {
      const filePath = path.join(tmpDir, "identity.json");
      const identity = loadOrCreateDeviceIdentity(filePath);

      saveDeviceToken(filePath, "fresh-device-token");

      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(raw.deviceToken).toBe("fresh-device-token");
      expect(raw.deviceId).toBe(identity.deviceId);
      expect(raw.publicKeyPem).toBe(identity.publicKeyPem);
      expect(raw.privateKeyPem).toBe(identity.privateKeyPem);
      expect(raw.version).toBe(1);
      // createdAtMs from the original write is preserved
      expect(typeof raw.createdAtMs).toBe("number");
    });

    it("saveDeviceToken refuses to create an identity file from scratch", () => {
      // Safety net: the caller must have called loadOrCreateDeviceIdentity first,
      // so we never end up with a file that has a token but no keypair.
      const filePath = path.join(tmpDir, "nonexistent.json");
      expect(() => saveDeviceToken(filePath, "token")).toThrow();
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("saveDeviceToken writes atomically (no truncated file on crash)", () => {
      // Proxy: after a successful write, there must be no leftover .tmp files
      // in the parent directory.
      const filePath = path.join(tmpDir, "identity.json");
      loadOrCreateDeviceIdentity(filePath);
      saveDeviceToken(filePath, "atomic-token");

      const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
    });

    it("clearDeviceToken removes the token field while preserving the keypair", () => {
      const filePath = path.join(tmpDir, "identity.json");
      const identity = loadOrCreateDeviceIdentity(filePath);
      saveDeviceToken(filePath, "will-be-cleared");

      clearDeviceToken(filePath);

      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(raw).not.toHaveProperty("deviceToken");
      expect(raw.deviceId).toBe(identity.deviceId);
      expect(raw.privateKeyPem).toBe(identity.privateKeyPem);
    });

    it("clearDeviceToken is a no-op when the file has no token", () => {
      const filePath = path.join(tmpDir, "identity.json");
      loadOrCreateDeviceIdentity(filePath);
      const beforeHash = fs.readFileSync(filePath, "utf8");

      clearDeviceToken(filePath);

      const afterHash = fs.readFileSync(filePath, "utf8");
      expect(afterHash).toBe(beforeHash);
    });

    it("clearDeviceToken is a no-op when the file does not exist", () => {
      const filePath = path.join(tmpDir, "nonexistent.json");
      expect(() => clearDeviceToken(filePath)).not.toThrow();
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
