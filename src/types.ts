/**
 * OpenClaw Gateway WebSocket Protocol Types
 *
 * Based on the Gateway protocol v3 specification.
 * See: https://docs.openclaw.ai
 */

// --- Connection State ---

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "challenging"
  | "authenticating"
  | "connected";

// --- Roles & Auth ---

export type ClientRole = "operator" | "node";

export interface DeviceIdentity {
  id: string;
  publicKey?: string;
  signature?: string;
  signedAt?: number;
  nonce?: string;
}

export interface AuthParams {
  token?: string;
  deviceToken?: string;
  password?: string;
}

// --- Protocol Framing ---

export interface ProtocolRequest {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ProtocolResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

export interface ProtocolEvent {
  type: "event";
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
  stateVersion?: unknown;
}

export type ProtocolMessage = ProtocolRequest | ProtocolResponse | ProtocolEvent;

export function isValidProtocolMessage(msg: unknown): msg is ProtocolMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;

  if (obj.type === "req") {
    return typeof obj.id === "string" && typeof obj.method === "string";
  }
  if (obj.type === "res") {
    return typeof obj.id === "string" && typeof obj.ok === "boolean";
  }
  if (obj.type === "event") {
    return typeof obj.event === "string";
  }
  return false;
}

// --- Connect ---

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
    deviceFamily?: string;
    modelIdentifier?: string;
    mode: string;
    instanceId?: string;
  };
  role?: ClientRole;
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  auth?: AuthParams;
  locale?: string;
  userAgent?: string;
  device?: DeviceIdentity;
}

export interface ConnectChallenge {
  nonce: string;
  ts: number;
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server?: {
    version: string;
    commit?: string;
    host?: string;
    connId: string;
  };
  features?: {
    methods: string[];
    events: string[];
  };
  snapshot?: Record<string, unknown>;
  canvasHostUrl?: string;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

// --- Chat Attachments ---

export interface ChatAttachment {
  /** Optional type hint (e.g. "image") */
  type?: string;
  /** MIME type (e.g. "image/png") */
  mimeType?: string;
  /** File name */
  fileName?: string;
  /** Base64-encoded content */
  content: string;
}

// --- Sessions ---

export interface Session {
  sessionKey: string;
  kind?: string;
  agentId?: string;
  createdAt?: string;
  lastMessageAt?: string;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

// --- Config ---

export interface ConfigGetResult {
  config: Record<string, unknown>;
  hash: string;
}

// --- Client Events ---

export type ClientEventMap = {
  connected: HelloOk;
  disconnected: { reason: string; code?: number };
  error: Error;
  event: ProtocolEvent;
  pairingRequired: PairingRequiredEvent;
  "protocol:event": ProtocolEvent;
  "protocol:response": ProtocolResponse;
};

/**
 * Emitted when the gateway closes the WebSocket with a pairing-required
 * reason (close code 1008, reason starts with "pairing required").
 *
 * In OpenClaw 4.29+, non-loopback peers (e.g. Pinchy connecting from a
 * Docker container IP) cannot pair silently — the gateway queues a pair
 * request and closes the WS with this reason. An external approval path
 * (e.g. `openclaw devices approve <requestId>` from inside the gateway
 * container) must drive the request to "approved" before the next
 * reconnect attempt will succeed.
 */
export interface PairingRequiredEvent {
  /** Pairing request ID, if present in the close reason. */
  requestId?: string;
  /** OC pairing reason ("not-paired", "scope-upgrade", "role-upgrade", "metadata-upgrade") if parsed. */
  reason?: string;
  /** The raw close reason string, for diagnostics. */
  raw: string;
}
