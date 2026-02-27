import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../client";
import { installMockWebSocket, getMockWs, completeHandshake } from "./helpers/mock-ws";

describe("Chat streaming", () => {
  let client: OpenClawClient;

  beforeEach(async () => {
    installMockWebSocket();
    client = new OpenClawClient({
      url: "ws://localhost:18789",
      autoReconnect: false,
    });
    await completeHandshake(client);
  });

  afterEach(async () => {
    await client.disconnect();
    vi.restoreAllMocks();
  });

  it("sends agent request with message content", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    // Start chat (don't await -- it's an async generator)
    const gen = client.chat("Hello");
    // Pull one iteration to trigger the send
    const iterPromise = gen.next();

    // Check the sent message
    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent");
    expect(sentMsg.params.message).toBe("Hello");

    // Clean up: send accepted then ok response so the generator finishes
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    // Drain the generator
    for await (const _ of gen) {
      // just consume
    }
  });

  it("yields incremental text from cumulative agent events", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: string[] = [];
    const gen = client.chat("Hello");

    // Start consuming in background
    const consumePromise = (async () => {
      for await (const chunk of gen) {
        if (chunk.type === "text") {
          chunks.push(chunk.text);
        }
      }
    })();

    // Wait a tick for the generator to start
    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // OpenClaw first sends accepted response
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // OpenClaw streams cumulative agent events
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hello" } },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hello world" } },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hello world!" } },
    });

    // Send lifecycle end
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "lifecycle", data: { phase: "end" } },
    });

    // Send final ok response
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [{ text: "Hello world!" }] } },
    });

    await consumePromise;

    // Should yield incremental chunks (not cumulative)
    expect(chunks).toEqual(["Hello", " world", "!"]);
  });

  it("does not terminate on accepted response, only on ok response", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: string[] = [];
    let streamDone = false;
    const gen = client.chat("Hello");

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        if (chunk.type === "text") {
          chunks.push(chunk.text);
        }
      }
      streamDone = true;
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Send accepted response - should NOT terminate the stream
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(streamDone).toBe(false);

    // Send a text chunk
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hi" } },
    });

    // Send ok response - should terminate
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [{ text: "Hi" }] } },
    });

    await consumePromise;
    expect(streamDone).toBe(true);
    expect(chunks).toEqual(["Hi"]);
  });

  it("chatSync returns complete concatenated text", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const resultPromise = client.chatSync("Hello");

    // Wait a tick for the request to be sent
    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Send accepted
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Send cumulative agent events
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "The " } },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "The answer " } },
    });

    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "The answer is 42." } },
    });

    // Send ok response
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: {
        runId: requestId,
        status: "ok",
        result: { payloads: [{ text: "The answer is 42." }] },
      },
    });

    const result = await resultPromise;
    expect(result).toBe("The answer is 42.");
  });

  it("passes agentId in request params when provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("Hello", { agentId: "agent-123" });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.agentId).toBe("agent-123");

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });

  it("ignores agent events from unrelated runs", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: string[] = [];
    const gen = client.chat("Hello");

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        if (chunk.type === "text") {
          chunks.push(chunk.text);
        }
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Event from a different run - should be ignored
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: "other-run", stream: "assistant", data: { text: "Wrong" } },
    });

    // Event from our run
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Right" } },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [{ text: "Right" }] } },
    });

    await consumePromise;
    expect(chunks).toEqual(["Right"]);
  });

  it("sends attachments in request params when provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("What is in this image?", {
      attachments: [{ mimeType: "image/png", content: "abc123base64data" }],
    });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("agent");
    expect(sentMsg.params.message).toBe("What is in this image?");
    expect(sentMsg.params.attachments).toEqual([
      { mimeType: "image/png", content: "abc123base64data" },
    ]);

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });

  it("passes optional ChatOptions fields in request params", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("Hello", {
      sessionKey: "sess-1",
      agentId: "agent-1",
      thinking: "medium",
      deliver: false,
      channel: "slack",
      extraSystemPrompt: "Be concise.",
      label: "test-label",
      timeout: 30000,
    });
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.sessionKey).toBe("sess-1");
    expect(sentMsg.params.agentId).toBe("agent-1");
    expect(sentMsg.params.thinking).toBe("medium");
    expect(sentMsg.params.deliver).toBe(false);
    expect(sentMsg.params.channel).toBe("slack");
    expect(sentMsg.params.extraSystemPrompt).toBe("Be concise.");
    expect(sentMsg.params.label).toBe("test-label");
    expect(sentMsg.params.timeout).toBe(30000);

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });

  it("omits attachments from params when not provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const gen = client.chat("Hello plain");
    const iterPromise = gen.next();

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.params.message).toBe("Hello plain");
    expect(sentMsg.params.attachments).toBeUndefined();

    // Clean up
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "accepted" },
    });
    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { runId: sentMsg.id, status: "ok", result: { payloads: [] } },
    });

    await iterPromise;
    for await (const _ of gen) {
      // consume
    }
  });

  it("abort sends chat.abort request with sessionKey", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const abortPromise = client.chatAbort("sess-key-1");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.type).toBe("req");
    expect(sentMsg.method).toBe("chat.abort");
    expect(sentMsg.params.sessionKey).toBe("sess-key-1");
    expect(sentMsg.params.runId).toBeUndefined();

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    const result = await abortPromise;
    expect(result).toEqual({ status: "ok" });
  });

  it("abort includes runId when provided", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const abortPromise = client.chatAbort("sess-key-1", "run-123");

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    expect(sentMsg.method).toBe("chat.abort");
    expect(sentMsg.params.sessionKey).toBe("sess-key-1");
    expect(sentMsg.params.runId).toBe("run-123");

    ws.simulateMessage({
      type: "res",
      id: sentMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    await abortPromise;
  });

  it("chatAbort terminates the active chat generator", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const sessionKey = "abort-test-session";
    const chunks: { type: string; text: string }[] = [];
    let generatorDone = false;

    const gen = client.chat("Tell me a long story", { sessionKey });

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
      generatorDone = true;
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // Send accepted response
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Stream some text
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Once upon" } },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(generatorDone).toBe(false);

    // Now abort — this should terminate the generator locally
    const abortSentBefore = ws.sent.length;
    const abortPromise = client.chatAbort(sessionKey);

    // Respond to the abort request
    const abortMsg = JSON.parse(ws.sent[abortSentBefore]);
    ws.simulateMessage({
      type: "res",
      id: abortMsg.id,
      ok: true,
      payload: { status: "ok" },
    });

    await abortPromise;
    await consumePromise;

    expect(generatorDone).toBe(true);
    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
  });

  it("yields error chunk when response has ok: false", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Hello");

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    // OpenClaw responds with error
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: false,
      error: { code: "overloaded", message: "AI service temporarily overloaded" },
    });

    await consumePromise;

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.text).toBe("AI service temporarily overloaded");
  });

  it("yields tool_use chunk when agent uses a tool", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Search for cats");

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Gateway sends tool execution start event
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "tool",
        data: { phase: "start", tool: "search_web", input: { query: "cats" } },
      },
    });

    // Gateway sends tool execution end event
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "tool",
        data: { phase: "end", tool: "search_web", output: "Found 10 results" },
      },
    });

    // Assistant responds with text
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Here are the results." } },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const toolUse = chunks.find((c) => c.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse!.text).toBe("search_web");

    const toolResult = chunks.find((c) => c.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.text).toBe("search_web: Found 10 results");

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBeGreaterThan(0);
  });

  it("ignores tool events from unrelated runs", async () => {
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Hello");

    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    const sentMsg = JSON.parse(ws.sent[sentBefore]);
    const requestId = sentMsg.id;

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "accepted" },
    });

    // Tool event from a different run — should be ignored
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: "other-run",
        stream: "tool",
        data: { phase: "start", tool: "dangerous_tool", input: {} },
      },
    });

    // Finish our run
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const toolChunks = chunks.filter((c) => c.type === "tool_use" || c.type === "tool_result");
    expect(toolChunks).toHaveLength(0);
  });
});
