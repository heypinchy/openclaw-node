# openclaw-node

A Node.js client for the [OpenClaw](https://github.com/openclaw/openclaw) Gateway WebSocket protocol.

Connect to an OpenClaw Gateway, send messages, manage sessions, and receive streaming responses — all from Node.js.

## Why?

OpenClaw is a powerful AI agent platform, but there's no official Node.js client for its WebSocket API. If you want to build a web UI, a backend integration, or any custom tooling on top of OpenClaw, you need to implement the protocol yourself.

This package does that for you.

## Installation

```bash
npm install openclaw-node
```

## Quick Start

```typescript
import { OpenClawClient } from "openclaw-node";

const client = new OpenClawClient({
  url: "ws://localhost:18789",
  token: process.env.OPENCLAW_GATEWAY_TOKEN,
});

await client.connect();

// Send a message and stream the response
const stream = client.chat("What's the weather like?");

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}

await client.disconnect();
```

## Features

- **Full protocol support** — Implements the OpenClaw Gateway WebSocket protocol (v3)
- **Streaming responses** — AsyncIterator-based streaming for real-time output
- **Session management** — Create, list, and interact with agent sessions
- **TypeScript-first** — Full type definitions for all protocol messages
- **Authentication** — Gateway token and device token support
- **Auto-reconnect** — Configurable reconnection with exponential backoff
- **Event system** — Subscribe to gateway events (exec approvals, presence, etc.)
- **Zero dependencies** — Uses Node.js built-in `WebSocket` (Node 22+) or optional `ws` fallback

## API

### `OpenClawClient`

```typescript
const client = new OpenClawClient({
  // Required
  url: string;              // Gateway WebSocket URL (ws:// or wss://)

  // Optional
  token?: string;           // Gateway auth token
  deviceId?: string;        // Stable device identifier
  role?: "operator" | "node"; // Connection role (default: "operator")
  scopes?: string[];        // Requested scopes
  autoReconnect?: boolean;  // Auto-reconnect on disconnect (default: true)
  reconnectIntervalMs?: number; // Base reconnect interval (default: 1000)
  maxReconnectAttempts?: number; // Max reconnect attempts (default: 10)
});
```

### Connection

```typescript
await client.connect();       // Connect and complete handshake
await client.disconnect();    // Gracefully disconnect
client.isConnected;           // Connection state
```

### Chat

```typescript
// Stream a response
const stream = client.chat(message, { sessionKey?, agentId? });
for await (const chunk of stream) {
  // chunk.type: "text" | "tool_use" | "tool_result" | "done"
  // chunk.text: string
}

// Send without streaming (returns full response)
const response = await client.chatSync(message, { sessionKey?, agentId? });
```

### Sessions

```typescript
const sessions = await client.sessions.list({ limit?, kinds? });
const history = await client.sessions.history(sessionKey, { limit? });
await client.sessions.send(sessionKey, message);
```

### Events

```typescript
client.on("event", (event) => {
  // Handle gateway events
});

client.on("connected", () => { /* ... */ });
client.on("disconnected", (reason) => { /* ... */ });
client.on("error", (error) => { /* ... */ });
```

### Low-level

```typescript
// Send raw protocol requests
const response = await client.request(method, params);

// Subscribe to raw protocol events
client.on("protocol:event", (event) => { /* ... */ });
```

## Protocol Details

This client implements the [OpenClaw Gateway WebSocket protocol](https://docs.openclaw.ai), including:

- **Handshake**: Challenge-response authentication with nonce signing
- **Framing**: Request/Response/Event message types with idempotency keys
- **Roles**: Operator (control plane) and Node (capability host) modes
- **Streaming**: Real-time text chunks from agent responses

## Built for Pinchy

This client was extracted from [Pinchy](https://github.com/heypinchy/pinchy), an open-source web UI for OpenClaw with multi-user support. It works great standalone — use it to build your own OpenClaw integrations.

## Requirements

- Node.js 22+ (uses built-in `WebSocket`) or Node.js 18+ with `ws` package
- OpenClaw Gateway running and accessible

## Contributing

Contributions welcome! Please read our [contributing guidelines](CONTRIBUTING.md) before submitting a PR.

## License

[MIT](LICENSE) — use it however you want.

## Links

- [Pinchy](https://heypinchy.com) — Open-source web UI for OpenClaw
- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent platform
- [OpenClaw Gateway Protocol Docs](https://docs.openclaw.ai)
