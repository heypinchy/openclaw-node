import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface DeviceIdentityData {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface BuildSignedDeviceParams {
  identity: DeviceIdentityData;
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string;
}

export interface SignedDevice {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  // Ed25519 SPKI = 12-byte prefix + 32-byte raw key
  return Buffer.from(spki).subarray(ED25519_SPKI_PREFIX.length);
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateDeviceIdentity(): DeviceIdentityData {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const raw = derivePublicKeyRaw(publicKeyPem);
  const deviceId = crypto.createHash("sha256").update(raw).digest("hex");

  return { deviceId, publicKeyPem, privateKeyPem };
}

export function loadOrCreateDeviceIdentity(filePath: string): DeviceIdentityData {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // Fall through to create new identity
  }

  const identity = generateDeviceIdentity();

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };

  fs.writeFileSync(filePath, JSON.stringify(stored, null, 2) + "\n", {
    mode: 0o600,
  });

  return identity;
}

export function buildSignedDevice(params: BuildSignedDeviceParams): SignedDevice {
  const { identity, nonce, clientId, clientMode, role, scopes, token } = params;
  const signedAt = Date.now();

  const payload = [
    "v2",
    identity.deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(","),
    String(signedAt),
    token ?? "",
    nonce,
  ].join("|");

  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);

  const publicKeyRaw = derivePublicKeyRaw(identity.publicKeyPem);

  return {
    id: identity.deviceId,
    publicKey: base64UrlEncode(publicKeyRaw),
    signature: base64UrlEncode(signature),
    signedAt,
    nonce,
  };
}
