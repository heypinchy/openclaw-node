import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OpenClawClient } from "../client";
import type { ChatChunk } from "../client";
import type { HelloOk } from "../types";

const GATEWAY_URL = process.env.OPENCLAW_URL || "ws://localhost:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || "dashboard-hook-2026";
const shouldRun = process.env.OPENCLAW_INTEGRATION === "1";

describe.skipIf(!shouldRun)("Integration: OpenClaw Gateway", () => {
  let client: OpenClawClient;
  let helloOk: HelloOk;
  const testSessions: string[] = [];

  beforeAll(async () => {
    client = new OpenClawClient({
      url: GATEWAY_URL,
      token: GATEWAY_TOKEN,
      autoReconnect: false,
      scopes: ["operator.read", "operator.write", "operator.admin"],
    });
    helloOk = await client.connect();
  }, 15_000);

  afterAll(async () => {
    // Clean up all test sessions
    for (const key of testSessions) {
      try {
        await client.sessions.delete(key, { deleteTranscript: true });
      } catch {
        // Ignore — session may already be deleted
      }
    }
    await client.disconnect();
  });

  it("connects and receives HelloOk", () => {
    expect(client.isConnected).toBe(true);
    expect(helloOk.type).toBe("hello-ok");
    expect(helloOk.protocol).toBe(3);
  });

  it("health check returns successfully", async () => {
    const result = await client.health();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  }, 10_000);

  it("sessions.list returns without error", async () => {
    const result = (await client.sessions.list()) as {
      sessions?: unknown[];
    };
    expect(result).toBeDefined();
    expect(Array.isArray(result.sessions)).toBe(true);
  }, 10_000);

  it("chat streams text chunks and a done chunk", async () => {
    const sessionKey = "integration-test-stream";
    testSessions.push(sessionKey);

    const chunks: ChatChunk[] = [];
    for await (const chunk of client.chat("Say just the word hello and nothing else", {
      sessionKey,
    })) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === "text");
    const doneChunks = chunks.filter((c) => c.type === "done");

    expect(textChunks.length).toBeGreaterThanOrEqual(1);
    expect(doneChunks).toHaveLength(1);

    const fullText = textChunks.map((c) => c.text).join("");
    expect(fullText.length).toBeGreaterThan(0);
  }, 60_000);

  it("chatSync returns a non-empty string", async () => {
    const sessionKey = "integration-test-sync";
    testSessions.push(sessionKey);

    const result = await client.chatSync("Say just the word hi and nothing else", { sessionKey });

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);

  it("sessions.history returns expected structure", async () => {
    // Use a session that was created by the chat tests above
    const sessionKey = "integration-test-sync";

    const result = (await client.sessions.history(sessionKey)) as {
      sessionKey?: string;
      messages?: unknown[];
    };

    expect(result).toBeDefined();
    expect(result.sessionKey).toBe(sessionKey);
    expect(Array.isArray(result.messages)).toBe(true);
    // Note: Gateway may return empty messages for sessions created via the
    // `agent` method, even though transcript files exist on disk. The
    // important thing is that the call succeeds and returns the right shape.
  }, 15_000);

  it("sessions.reset completes without error", async () => {
    const sessionKey = "integration-test-sync";

    const result = (await client.sessions.reset(sessionKey)) as {
      ok?: boolean;
    };

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  }, 15_000);

  it("sessions.delete removes the session", async () => {
    const sessionKey = "integration-test-stream";

    const result = (await client.sessions.delete(sessionKey, {
      deleteTranscript: true,
    })) as { ok?: boolean; deleted?: boolean };

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(true);

    // Remove from cleanup list since we just deleted it
    const idx = testSessions.indexOf(sessionKey);
    if (idx !== -1) testSessions.splice(idx, 1);
  }, 15_000);

  it("chatAbort terminates an active chat generator", async () => {
    const sessionKey = "integration-test-abort";
    testSessions.push(sessionKey);

    const chunks: ChatChunk[] = [];
    let generatorDone = false;

    // Start a chat that should produce a long response
    const gen = client.chat(
      "Write a very long essay about the history of computing. Make it at least 500 words.",
      { sessionKey },
    );

    // Consume in background
    const consumePromise = (async () => {
      for await (const chunk of gen) {
        chunks.push(chunk);
      }
      generatorDone = true;
    })();

    // Wait for at least one text chunk to arrive
    const startTime = Date.now();
    while (chunks.filter((c) => c.type === "text").length === 0) {
      if (Date.now() - startTime > 30_000) {
        throw new Error("Timed out waiting for first text chunk");
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // Now abort
    await client.chatAbort(sessionKey);

    // Generator should terminate within 5 seconds
    const abortStart = Date.now();
    while (!generatorDone) {
      if (Date.now() - abortStart > 5_000) {
        throw new Error("Generator did not terminate within 5s after chatAbort");
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    await consumePromise;
    expect(generatorDone).toBe(true);

    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
  }, 60_000);

  it("chat with agentId option", async () => {
    const sessionKey = "integration-test-agentid";
    testSessions.push(sessionKey);

    const result = await client.chatSync("Say just the word test", {
      sessionKey,
      agentId: "main",
    });

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 60_000);

  it("chat with extraSystemPrompt option", async () => {
    const sessionKey = "integration-test-systemprompt";
    testSessions.push(sessionKey);

    const result = await client.chatSync("What is 2+2?", {
      sessionKey,
      extraSystemPrompt: "Always respond with just the number, nothing else",
    });

    expect(result).toContain("4");
  }, 60_000);

  it("connect with invalid token times out or is rejected", async () => {
    const badClient = new OpenClawClient({
      url: GATEWAY_URL,
      token: "invalid-token-12345",
      autoReconnect: false,
    });

    // Suppress unhandled error events
    badClient.on("error", () => {});

    // Gateway may silently drop the connection or never complete the
    // handshake when the token is invalid. Race with a timeout.
    const result = await Promise.race([
      badClient.connect().then(
        () => "connected" as const,
        () => "rejected" as const,
      ),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000)),
    ]);

    // Either the gateway rejects (good) or hangs (also expected).
    // It should NOT successfully complete a hello-ok handshake.
    expect(["rejected", "timeout"]).toContain(result);

    await badClient.disconnect();
  }, 10_000);

  it("connect to unreachable gateway is rejected", async () => {
    const badClient = new OpenClawClient({
      url: "ws://localhost:19999",
      autoReconnect: false,
    });

    // Suppress unhandled error events from the EventEmitter
    badClient.on("error", () => {});

    await expect(badClient.connect()).rejects.toThrow();
  }, 15_000);

  it("sessions.list with limit returns at most N sessions", async () => {
    const result = (await client.sessions.list({ limit: 2 })) as {
      sessions?: unknown[];
    };

    expect(result).toBeDefined();
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(result.sessions!.length).toBeLessThanOrEqual(2);
  }, 10_000);
});
