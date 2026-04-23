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

  it("resets the cumulative-text watermark across multi-turn streams (e.g. after tool use)", async () => {
    // Repro for the bug where text from a second agent turn was silently
    // truncated by the watermark left over from the previous turn. OpenClaw
    // emits assistant text per-turn (not stream-wide cumulative), so when a
    // new turn starts at length 0, the client must reset its watermark.
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Tell me something with tools");

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

    // Turn 1 — assistant says it will look something up. 67 chars.
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Ich werde die Dokumentation zu Knowledge Base Agents konsultieren." },
      },
    });

    // Tool round-trip between the turns.
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "tool", data: { phase: "start", tool: "docs_read" } },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "tool",
        data: { phase: "end", tool: "docs_read", output: "..." },
      },
    });

    // Turn 2 — finale answer, length-wise SHORTER at first than turn 1's
    // total length (this is what tripped the old watermark). The full final
    // text is longer than turn 1, but the early frames are not.
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Guten Tag!" },
      },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Guten Tag! Hier ist eine umfassende Erklärung." },
      },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const concatenatedText = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // The full text from BOTH turns must be present — none of turn 2 may be
    // silently truncated by a leftover watermark.
    expect(concatenatedText).toContain(
      "Ich werde die Dokumentation zu Knowledge Base Agents konsultieren.",
    );
    expect(concatenatedText).toContain("Guten Tag! Hier ist eine umfassende Erklärung.");

    // The cumulative-length fallback path must also emit a boundary 'done'
    // so downstream consumers can split the two turns into separate
    // assistant messages (parity with the preferred `delta` path).
    const turn1Text = chunks.findIndex(
      (c) => c.type === "text" && c.text.includes("Knowledge Base Agents konsultieren"),
    );
    const turn2Text = chunks.findIndex((c) => c.type === "text" && c.text.includes("Guten Tag"));
    expect(turn1Text).toBeGreaterThanOrEqual(0);
    expect(turn2Text).toBeGreaterThan(turn1Text);
    const between = chunks.slice(turn1Text + 1, turn2Text);
    expect(between.some((c) => c.type === "done")).toBe(true);
  });

  it("emits a 'done' chunk between turns so downstream consumers can separate assistant messages", async () => {
    // OpenClaw sends one final `res` per whole stream, not per turn.
    // Turn boundaries are only visible in the event sequence (a new
    // assistant event where `delta === text` after we've already seen
    // content). The client should emit a `done` chunk at each such
    // boundary so Pinchy's router can rotate messageIds and the browser
    // can render two separate bubbles — matching what OpenClaw persists.
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Tell me about X");

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

    // Turn 1 — assistant announces tool use, entire text in one event
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Let me look that up.", delta: "Let me look that up." },
      },
    });

    // Turn 2 starts — OpenClaw's per-turn accumulator restarts, so delta
    // equals text again. The client must notice and emit a done marker
    // between the two text chunks.
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Here is the answer.", delta: "Here is the answer." },
      },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    // Expected sequence: text(turn1), done(between), text(turn2), done(final)
    const seq = chunks.map((c) => c.type);
    expect(seq).toEqual(["text", "done", "text", "done"]);
    expect(chunks[0].text).toBe("Let me look that up.");
    expect(chunks[2].text).toBe("Here is the answer.");
  });

  it("does not emit a spurious 'done' between the first token and subsequent tokens of the same turn", async () => {
    // Regression: on providers that stream token-by-token, the first
    // event of a turn has delta === text (because text starts at length
    // equal to the delta). That must NOT be interpreted as a turn
    // boundary — the boundary check also requires cumulativeLength > 0
    // (meaning we've already seen text from a previous turn).
    const ws = getMockWs();
    const sentBefore = ws.sent.length;

    const chunks: { type: string; text: string }[] = [];
    const gen = client.chat("Hi");

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

    // Token-by-token streaming for a single turn
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hel", delta: "Hel" } },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hello", delta: "lo" } },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "assistant", data: { text: "Hello!", delta: "!" } },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    // Only the final done marker — no interstitial done in the middle
    // of a single turn.
    const doneBeforeFinal = chunks.slice(0, -1).filter((c) => c.type === "done");
    expect(doneBeforeFinal).toHaveLength(0);
    // All text should still be there
    const joined = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(joined).toBe("Hello!");
  });

  it("uses the OpenClaw-provided 'delta' field when present, instead of computing it from cumulative text", async () => {
    // Modern OpenClaw releases include `delta` on every assistant event:
    // the just-added slice. Using it directly avoids any cumulative-text
    // arithmetic and is robust across turn boundaries.
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

    // Turn 1 with explicit deltas
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "I will look this up.", delta: "I will look this up." },
      },
    });

    // Tool round-trip
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: { runId: requestId, stream: "tool", data: { phase: "start", tool: "lookup" } },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "tool",
        data: { phase: "end", tool: "lookup", output: "x" },
      },
    });

    // Turn 2 streamed token-by-token via delta (text restarts at 0 on
    // OpenClaw's side, but the delta carries the truth and we don't care
    // about the cumulative length any more).
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Hi", delta: "Hi" },
      },
    });
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "assistant",
        data: { text: "Hi there", delta: " there" },
      },
    });

    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const textOnly = chunks.filter((c) => c.type === "text").map((c) => c.text);
    expect(textOnly).toEqual(["I will look this up.", "Hi", " there"]);
  });

  it("yields {type: 'error'} when Gateway sends lifecycle.phase=error", async () => {
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

    // OpenClaw's embedded runner emits provider failures as lifecycle events
    ws.simulateMessage({
      type: "event",
      event: "agent",
      payload: {
        runId: requestId,
        stream: "lifecycle",
        data: {
          phase: "error",
          error: "HTTP 401 authentication_error: invalid x-api-key",
          livenessState: "blocked",
          endedAt: Date.now(),
        },
      },
    });

    // Followed by the normal ok response (run completed, just with error state)
    ws.simulateMessage({
      type: "res",
      id: requestId,
      ok: true,
      payload: { runId: requestId, status: "ok", result: { payloads: [] } },
    });

    await consumePromise;

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.text).toBe("HTTP 401 authentication_error: invalid x-api-key");
  });
});
