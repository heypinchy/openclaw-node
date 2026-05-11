import { vi } from "vitest";

export class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  sent: string[] = [];

  addEventListener(event: string, cb: (...args: unknown[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeEventListener(event: string, cb: (...args: unknown[]) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(data: object) {
    for (const cb of this.listeners["message"] || []) {
      cb({ data: JSON.stringify(data) });
    }
  }

  simulateRawMessage(raw: string) {
    for (const cb of this.listeners["message"] || []) {
      cb({ data: raw });
    }
  }

  simulateOpen() {
    for (const cb of this.listeners["open"] || []) cb();
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    for (const cb of this.listeners["close"] || []) cb({ code, reason });
  }

  simulateError(err: Error) {
    for (const cb of this.listeners["error"] || []) cb(err);
  }
}

let _mockWs: MockWebSocket;

export function getMockWs(): MockWebSocket {
  return _mockWs;
}

export function installMockWebSocket() {
  vi.stubGlobal(
    "WebSocket",
    class extends MockWebSocket {
      constructor() {
        super();
        setMockWs(this);
      }
    },
  );
}

function setMockWs(ws: MockWebSocket) {
  _mockWs = ws;
}

export async function completeHandshake(client: {
  connect: () => Promise<unknown>;
}): Promise<void> {
  const connectPromise = client.connect();
  const ws = getMockWs();
  ws.simulateOpen();
  ws.simulateMessage({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "test-nonce", ts: Date.now() },
  });
  const req = JSON.parse(ws.sent[ws.sent.length - 1]);
  ws.simulateMessage({
    type: "res",
    id: req.id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 3,
      policy: { tickIntervalMs: 15000, maxPayload: 25000000, maxBufferedBytes: 50000000 },
    },
  });
  await connectPromise;
}
