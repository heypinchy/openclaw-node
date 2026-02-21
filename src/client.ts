import { EventEmitter } from "events";
import {
  isValidProtocolMessage,
  type ChatAttachment,
  type ClientRole,
  type ConnectParams,
  type HelloOk,
  type ProtocolEvent,
  type ProtocolMessage,
  type ProtocolResponse,
} from "./types";
import {
  loadOrCreateDeviceIdentity,
  buildSignedDevice,
  type DeviceIdentityData,
} from "./device";

// Use Node.js built-in WebSocket (22+) or fall back to `ws`
const getWebSocket = (): typeof WebSocket => {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ws");
  } catch {
    throw new Error(
      "No WebSocket implementation found. Use Node.js 22+ or install the `ws` package."
    );
  }
};

export interface OpenClawClientOptions {
  /** Gateway WebSocket URL (ws:// or wss://) */
  url: string;
  /** Gateway auth token */
  token?: string;
  /** Path to device identity file (default: ~/.openclaw/device-identity.json) */
  deviceIdentityPath?: string;
  /** Connection role (default: "operator") */
  role?: ClientRole;
  /** Requested scopes (default: operator read+write) */
  scopes?: string[];
  /** Client identifier string */
  clientId?: string;
  /** Client version string */
  clientVersion?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Base reconnect interval in ms (default: 1000) */
  reconnectIntervalMs?: number;
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Maximum incoming message size in bytes (default: 5 * 1024 * 1024) */
  maxMessageSize?: number;
}

export interface ChatOptions {
  sessionKey?: string;
  agentId?: string;
  attachments?: ChatAttachment[];
  thinking?: string;
  deliver?: boolean;
  channel?: string;
  extraSystemPrompt?: string;
  label?: string;
  timeout?: number;
}

export interface ChatChunk {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  text: string;
}

const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = ["operator.read", "operator.write"];

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<
    Pick<
      OpenClawClientOptions,
      | "url"
      | "role"
      | "scopes"
      | "autoReconnect"
      | "reconnectIntervalMs"
      | "maxReconnectAttempts"
      | "maxMessageSize"
    >
  > &
    OpenClawClientOptions;

  private pendingRequests = new Map<
    string,
    { resolve: (value: ProtocolResponse) => void; reject: (error: Error) => void }
  >();

  private _activeChats = new Map<string, () => void>();

  private reconnectAttempts = 0;
  private _isConnected = false;
  private _shouldReconnect = true;
  private deviceIdentity: DeviceIdentityData | null = null;

  constructor(options: OpenClawClientOptions) {
    super();
    this.options = {
      role: "operator",
      scopes: DEFAULT_SCOPES,
      autoReconnect: true,
      reconnectIntervalMs: 1000,
      maxReconnectAttempts: 10,
      maxMessageSize: 5 * 1024 * 1024,
      ...options,
    };

    if (this.options.token && this.options.url.startsWith("ws://")) {
      process.emitWarning(
        "Connecting with authentication token over insecure ws:// transport. " +
          "Use wss:// in production to prevent token interception.",
        "InsecureTransportWarning"
      );
    }

    this.deviceIdentity = loadOrCreateDeviceIdentity(
      this.options.deviceIdentityPath ||
        `${process.env.HOME || "/tmp"}/.openclaw/device-identity.json`
    );
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to the OpenClaw Gateway and complete the handshake.
   */
  async connect(): Promise<HelloOk> {
    this._shouldReconnect = true;
    const WS = getWebSocket();

    return new Promise<HelloOk>((resolve, reject) => {
      try {
        this.ws = new WS(this.options.url) as unknown as WebSocket;
      } catch (err) {
        reject(err);
        return;
      }

      const onOpen = () => {
        // Wait for challenge event, then send connect request
      };

      const onMessage = (event: MessageEvent | { data: string }) => {
        const data =
          typeof event === "object" && "data" in event
            ? String(event.data)
            : String(event);
        if (data.length > this.options.maxMessageSize) {
          this.emit(
            "error",
            new Error(
              `Message size ${data.length} exceeds limit of ${this.options.maxMessageSize} bytes`
            )
          );
          return;
        }
        try {
          const parsed: unknown = JSON.parse(data);
          if (!isValidProtocolMessage(parsed)) {
            this.emit(
              "error",
              new Error(
                `Invalid protocol message: unexpected type "${(parsed as Record<string, unknown>)?.type}"`
              )
            );
            return;
          }
          this.handleMessage(parsed, resolve);
        } catch {
          // Ignore unparseable messages
        }
      };

      const onError = (err: Event | Error) => {
        const error = err instanceof Error ? err : new Error("WebSocket connection failed");
        this.emit("error", error);
        reject(error);
        // Node.js built-in WebSocket does not fire "close" after connection error,
        // so trigger reconnect directly from the error handler as well.
        this._isConnected = false;
        this.maybeReconnect();
      };

      const onClose = () => {
        this._isConnected = false;
        this.emit("disconnected", { reason: "closed" });
        this.maybeReconnect();
      };

      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("message", onMessage as never);
      this.ws.addEventListener("error", onError as never);
      this.ws.addEventListener("close", onClose);
    });
  }

  /**
   * Gracefully disconnect from the Gateway.
   */
  async disconnect(): Promise<void> {
    this._shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
  }

  /**
   * Send a chat message and return an async iterator of response chunks.
   */
  async *chat(message: string, options?: ChatOptions): AsyncGenerator<ChatChunk> {
    const id = this.generateId();

    this.send({
      type: "req",
      id,
      method: "agent",
      params: {
        message,
        sessionKey: options?.sessionKey,
        agentId: options?.agentId,
        ...(options?.attachments && { attachments: options.attachments }),
        ...(options?.thinking !== undefined && { thinking: options.thinking }),
        ...(options?.deliver !== undefined && { deliver: options.deliver }),
        ...(options?.channel !== undefined && { channel: options.channel }),
        ...(options?.extraSystemPrompt !== undefined && { extraSystemPrompt: options.extraSystemPrompt }),
        ...(options?.label !== undefined && { label: options.label }),
        ...(options?.timeout !== undefined && { timeout: options.timeout }),
        idempotencyKey: id,
      },
    });

    // Collect streaming chunks until done.
    // OpenClaw sends cumulative text in "agent" events (stream: "assistant"),
    // so we track the previous length and yield only the new portion.
    const chunks: ChatChunk[] = [];
    let done = false;
    let resolveChunk: (() => void) | null = null;
    let cumulativeLength = 0;

    // Register in _activeChats so chatAbort() can terminate this generator
    const abortKey = options?.sessionKey || id;
    this._activeChats.set(abortKey, () => {
      done = true;
      resolveChunk?.();
    });

    const onMessage = (msg: ProtocolMessage) => {
      if (msg.type === "event") {
        const event = msg as ProtocolEvent;
        if (
          event.event === "agent" &&
          event.payload &&
          (event.payload as Record<string, unknown>).runId === id &&
          (event.payload as Record<string, unknown>).stream === "assistant"
        ) {
          const data = (event.payload as Record<string, unknown>).data as
            | Record<string, unknown>
            | undefined;
          const text = data?.text as string | undefined;
          if (text && text.length > cumulativeLength) {
            const newText = text.slice(cumulativeLength);
            cumulativeLength = text.length;
            chunks.push({ type: "text", text: newText });
            resolveChunk?.();
          }
        }
      }
      if (
        msg.type === "res" &&
        (msg as ProtocolResponse).id === id
      ) {
        const res = msg as ProtocolResponse;
        const payload = res.payload as
          | Record<string, unknown>
          | undefined;
        // Ignore "accepted" responses; only terminate on final "ok" response
        if (payload?.status === "accepted") {
          return;
        }
        // Propagate error responses as error chunks
        if (!res.ok && res.error?.message) {
          chunks.push({ type: "error", text: res.error.message });
        }
        done = true;
        resolveChunk?.();
      }
    };

    this.on("_raw", onMessage);

    try {
      while (!done) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          await new Promise<void>((r) => {
            resolveChunk = r;
          });
        }
      }
      // Yield remaining chunks
      while (chunks.length > 0) {
        yield chunks.shift()!;
      }
      yield { type: "done", text: "" };
    } finally {
      this.off("_raw", onMessage);
      this._activeChats.delete(abortKey);
    }
  }

  /**
   * Send a chat message and return the complete response.
   */
  async chatSync(message: string, options?: ChatOptions): Promise<string> {
    let result = "";
    for await (const chunk of this.chat(message, options)) {
      if (chunk.type === "text") {
        result += chunk.text;
      }
    }
    return result;
  }

  /**
   * Abort a running chat in the given session.
   */
  async chatAbort(sessionKey: string, runId?: string): Promise<Record<string, unknown> | undefined> {
    // Terminate the local generator immediately so it doesn't hang
    this._activeChats.get(sessionKey)?.();

    const params: Record<string, unknown> = { sessionKey };
    if (runId !== undefined) {
      params.runId = runId;
    }
    const res = await this.request("chat.abort", params);
    return res.payload;
  }

  /**
   * Check the health of the Gateway connection.
   * Uses a 5-second timeout (shorter than the default 30s for requests).
   */
  async health(): Promise<Record<string, unknown>> {
    const id = this.generateId();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Health check timed out"));
      }, 5000);
      this.pendingRequests.set(id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res.payload as Record<string, unknown>);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
      this.send({ type: "req", id, method: "health", params: {} });
    });
  }

  /**
   * Session management helpers.
   */
  readonly sessions = {
    list: async (options?: { limit?: number; kinds?: string[] }) => {
      const res = await this.request("sessions.list", options || {});
      return res.payload;
    },
    history: async (sessionKey: string, options?: { limit?: number }) => {
      const res = await this.request("chat.history", {
        sessionKey,
        ...options,
      });
      return res.payload;
    },
    send: async (sessionKey: string, message: string) => {
      const res = await this.request("chat.send", {
        sessionKey,
        message,
      });
      return res.payload;
    },
    delete: async (key: string, options?: { deleteTranscript?: boolean }) => {
      const res = await this.request("sessions.delete", {
        key,
        ...options,
      });
      return res.payload;
    },
    reset: async (key: string, options?: { reason?: "new" | "reset" }) => {
      const res = await this.request("sessions.reset", {
        key,
        ...options,
      });
      return res.payload;
    },
    compact: async (key: string, options?: { maxLines?: number }) => {
      const res = await this.request("sessions.compact", {
        key,
        ...options,
      });
      return res.payload;
    },
  };

  /**
   * Send a raw protocol request and wait for the response.
   */
  async request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<ProtocolResponse> {
    const id = this.generateId();

    return new Promise<ProtocolResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.send({ type: "req", id, method, params });
    });
  }

  // --- Internal ---

  private handleMessage(
    msg: ProtocolMessage,
    connectResolve?: (value: HelloOk) => void
  ): void {
    this.emit("_raw", msg);

    if (msg.type === "event") {
      const event = msg as ProtocolEvent;

      // Handle connect challenge
      if (event.event === "connect.challenge" && event.payload) {
        this.sendConnectRequest(event.payload as { nonce: string; ts: number });
        return;
      }

      this.emit("event", event);
      this.emit("protocol:event", event);
      return;
    }

    if (msg.type === "res") {
      const res = msg as ProtocolResponse;

      // Handle connect response
      if (res.ok && res.payload && (res.payload as unknown as HelloOk).type === "hello-ok") {
        this._isConnected = true;
        this.reconnectAttempts = 0;
        const helloOk = res.payload as unknown as HelloOk;
        this.emit("connected", helloOk);
        connectResolve?.(helloOk);
        return;
      }

      // Handle pending request responses
      const pending = this.pendingRequests.get(res.id);
      if (pending) {
        this.pendingRequests.delete(res.id);
        if (res.ok) {
          pending.resolve(res);
        } else {
          pending.reject(
            new Error(res.error?.message || `Request failed: ${res.id}`)
          );
        }
      }

      this.emit("protocol:response", res);
    }
  }

  private sendConnectRequest(challenge: { nonce: string; ts: number }): void {
    const clientId = this.options.clientId || "gateway-client";
    const role = this.options.role || "operator";
    const scopes = this.options.scopes || DEFAULT_SCOPES;

    const device = this.deviceIdentity
      ? buildSignedDevice({
          identity: this.deviceIdentity,
          nonce: challenge.nonce,
          clientId,
          clientMode: "backend",
          role,
          scopes,
          token: this.options.token,
        })
      : undefined;

    const params: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: clientId,
        version: this.options.clientVersion || "0.1.0",
        platform: process.platform,
        mode: "backend",
      },
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      auth: {
        token: this.options.token,
      },
      locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
      userAgent: `openclaw-node/0.1.0`,
      ...(device && { device }),
    };

    this.send({
      type: "req",
      id: this.generateId(),
      method: "connect",
      params: params as unknown as Record<string, unknown>,
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to OpenClaw Gateway");
    }
    this.ws.send(JSON.stringify(msg));
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private maybeReconnect(): void {
    if (!this._shouldReconnect || !this.options.autoReconnect) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    const delay = Math.min(
      this.options.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;

    setTimeout(() => {
      this.connect().catch((err) => {
        this.emit("error", err);
      });
    }, delay);
  }
}
