# openclaw-node

A Node.js client for [OpenClaw](https://github.com/openclaw/openclaw) — connect your app to AI agents in a few lines of code.

## What is OpenClaw?

OpenClaw is an open-source AI agent platform. You run a **Gateway** (a local server) that manages AI agents — think of them as persistent AI assistants that can use tools, remember context, and connect to services like Slack, Telegram, or your own app.

This package lets you talk to those agents from Node.js.

## Prerequisites

Before using this client, you need a running OpenClaw Gateway:

```bash
# Install OpenClaw
npm install -g openclaw

# Start the gateway
openclaw gateway start
```

The gateway runs on `ws://localhost:18789` by default. If you've set an auth token (via `OPENCLAW_GATEWAY_TOKEN`), you'll need it for the client too.

→ [Full OpenClaw setup guide](https://docs.openclaw.ai)

## Installation

```bash
npm install openclaw-node
```

> **Node.js 22+** works out of the box (built-in WebSocket). For Node.js 20–21, also install `ws`:
> ```bash
> npm install openclaw-node ws
> ```

## Quick Start

```typescript
import { OpenClawClient } from "openclaw-node";

const client = new OpenClawClient({
  url: "ws://localhost:18789",
  // Only needed if your gateway has a token set:
  // token: process.env.OPENCLAW_GATEWAY_TOKEN,
});

await client.connect();

// Send a message and stream the response
const stream = client.chat("What's the weather like in Vienna?");

for await (const chunk of stream) {
  if (chunk.type === "text") {
    process.stdout.write(chunk.text);
    // Prints token by token: "The current weather in Vienna is..."
  }
}
// Final chunk has type "done"

await client.disconnect();
```

### Get a complete response (no streaming)

```typescript
const response = await client.chatSync("Summarize my last 3 meetings");
console.log(response);
// "Here's a summary of your recent meetings: ..."
```

## Core Concepts

**Gateway** — The local server that runs your agents. This client connects to it via WebSocket. Default address: `ws://localhost:18789`.

**Agent** — A configured AI assistant with its own personality, tools, and memory. The gateway can run multiple agents. Each has an `agentId`.

**Session** — A conversation thread with an agent. Sessions persist across connections, so you can pick up where you left off. Each session has a `sessionKey`.

**Token** — An optional auth string that protects your gateway from unauthorized access. Set it via `OPENCLAW_GATEWAY_TOKEN` on the gateway, then pass the same value to this client.

## API Reference

### Constructor

```typescript
const client = new OpenClawClient({
  url: "ws://localhost:18789",  // Gateway address (required)
  token: "my-secret-token",     // Auth token (optional, must match gateway)
  autoReconnect: true,          // Reconnect on disconnect (default: true)
  maxReconnectAttempts: 10,     // Give up after N retries (default: 10)
});
```

### Connecting

```typescript
await client.connect();    // Connect and authenticate
await client.disconnect(); // Gracefully close

client.isConnected;        // true/false
```

The client handles all protocol details (challenge-response handshake, authentication, keepalive) automatically.

### Chat — Streaming

```typescript
const stream = client.chat("Your message here", {
  sessionKey: "optional-session-id",  // Continue a specific conversation
  agentId: "optional-agent-id",       // Talk to a specific agent
});

for await (const chunk of stream) {
  switch (chunk.type) {
    case "text":
      process.stdout.write(chunk.text);  // Partial response text
      break;
    case "tool_use":
      console.log(`\n🔧 Using tool: ${chunk.text}`);
      break;
    case "tool_result":
      console.log(`✅ Tool result: ${chunk.text}`);
      break;
    case "done":
      console.log("\n--- Response complete ---");
      break;
  }
}
```

### Chat — Complete Response

```typescript
const reply = await client.chatSync("What's on my calendar today?");
// Returns the full response as a string
```

### Sessions

Sessions are conversation threads. They persist on the gateway, so you can resume them later.

```typescript
// List all sessions
const sessions = await client.sessions.list({ limit: 10 });

// Get message history for a session
const history = await client.sessions.history("session-key-here", {
  limit: 20,
});

// Send a message into an existing session
await client.sessions.send("session-key-here", "Follow up on yesterday's task");
```

### Configuration

Read and update the Gateway configuration at runtime without restarting.

```typescript
// Get the current config and its hash (for optimistic locking)
const result = await client.config.get();
console.log(result.config); // full config object
console.log(result.hash);   // use this as baseHash for patch/apply

// Patch config (JSON merge patch: objects merge, null deletes, arrays replace)
await client.config.patch(
  JSON.stringify({ channels: { telegram: { enabled: true } } }),
  result.hash,
  { note: "Enable Telegram channel" },
);

// Replace the full config
await client.config.apply(JSON.stringify(fullConfig), result.hash);
```

Both `patch` and `apply` accept optional parameters:
- `sessionKey` — associate the change with a session
- `note` — human-readable description of the change
- `restartDelayMs` — delay before the Gateway restarts affected services

### Channels

Check the status of configured channels (Telegram, Slack, WhatsApp, etc.):

```typescript
const status = await client.channels.status();
console.log(status);
// { telegram: { connected: true }, slack: { connected: false } }
```

### Pairing

Manage channel pairing requests (e.g., approve Telegram users who want to link their account):

```typescript
// List pending pairing requests for a channel
const pending = await client.pairing.list("telegram");

// Approve a pairing request
await client.pairing.approve("telegram", "ABC123");
```

> **Note:** Pairing RPC methods are inferred from CLI behavior and may not be available on all Gateway versions. Use `client.request()` with error handling, or check availability before calling.

### Events

```typescript
// Connection lifecycle
client.on("connected", (info) => console.log("Connected to gateway"));
client.on("disconnected", ({ reason }) => console.log("Disconnected:", reason));
client.on("error", (err) => console.error("Error:", err));

// Gateway events (exec approvals, presence changes, etc.)
client.on("event", (event) => {
  console.log("Gateway event:", event.event, event.payload);
});
```

### Low-Level Protocol Access

For advanced use cases, you can send raw protocol requests:

```typescript
const response = await client.request("status", {});
console.log(response.payload);
```

## Examples

### Express API with AI backend

```typescript
import express from "express";
import { OpenClawClient } from "openclaw-node";

const app = express();
const client = new OpenClawClient({ url: "ws://localhost:18789" });

await client.connect();

app.post("/api/ask", express.json(), async (req, res) => {
  const answer = await client.chatSync(req.body.question);
  res.json({ answer });
});

app.listen(3000);
```

### CLI chatbot

```typescript
import readline from "readline";
import { OpenClawClient } from "openclaw-node";

const client = new OpenClawClient({ url: "ws://localhost:18789" });
await client.connect();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on("line", async (input) => {
  for await (const chunk of client.chat(input)) {
    if (chunk.type === "text") process.stdout.write(chunk.text);
  }
  console.log();
});
```

## Compatibility

| openclaw-node | Gateway Protocol | OpenClaw Gateway | What's new                   |
|---------------|-----------------|------------------|------------------------------|
| 0.2.x         | v3              | 0.x (current)    | Tool event streaming         |
| 0.1.x         | v3              | 0.x              | Initial release              |

If the OpenClaw Gateway bumps its protocol version, you'll need a matching openclaw-node release. Check this table to find the right version.

## Features

- **Streaming** — AsyncIterator-based, get responses token by token
- **Tool events** — See which tools agents use and what they return (`tool_use` / `tool_result` chunks)
- **Auto-reconnect** — Exponential backoff, configurable retries
- **TypeScript-first** — Full type definitions for all protocol messages
- **Zero config** — Handles the full WebSocket protocol (handshake, auth, keepalive) for you
- **Lightweight** — Zero required dependencies on Node.js 22+

## Built for Pinchy

This client was extracted from [Pinchy](https://github.com/heypinchy/pinchy), an open-source web UI for OpenClaw with multi-user support, agent permissions, and a dashboard. It works great standalone — use it to build your own OpenClaw integrations.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent platform
- [Pinchy](https://heypinchy.com) — Open-source web UI for OpenClaw
- [OpenClaw Docs](https://docs.openclaw.ai) — Gateway setup and configuration
