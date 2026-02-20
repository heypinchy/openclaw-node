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
  error?: { code: string; message: string };
}

export interface ProtocolEvent {
  type: "event";
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
  stateVersion?: number;
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
    version: string;
    platform: string;
    mode: string;
  };
  role: ClientRole;
  scopes: string[];
  caps: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  auth: AuthParams;
  locale: string;
  userAgent: string;
  device?: DeviceIdentity;
}

export interface ConnectChallenge {
  nonce: string;
  ts: number;
}

export interface HelloOk {
  type: "hello-ok";
  protocol: number;
  policy: {
    tickIntervalMs: number;
  };
  auth?: {
    deviceToken: string;
    role: ClientRole;
    scopes: string[];
  };
}

// --- Content Parts (multimodal) ---

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

// --- Chat ---

export interface ChatMessage {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  error?: string;
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

// --- Client Events ---

export type ClientEventMap = {
  connected: HelloOk;
  disconnected: { reason: string; code?: number };
  error: Error;
  event: ProtocolEvent;
  "protocol:event": ProtocolEvent;
  "protocol:response": ProtocolResponse;
};
