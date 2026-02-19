import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  ConnectionState,
  ProtocolRequest,
  ProtocolResponse,
  ProtocolEvent,
  ProtocolMessage,
  ConnectChallenge,
  HelloOk,
} from "../types";

describe("Protocol types", () => {
  describe("ConnectionState", () => {
    it("accepts valid connection states", () => {
      const states: ConnectionState[] = [
        "disconnected",
        "connecting",
        "challenging",
        "authenticating",
        "connected",
      ];
      expect(states).toHaveLength(5);
    });

    it("has the correct type shape", () => {
      expectTypeOf<ConnectionState>().toEqualTypeOf<
        | "disconnected"
        | "connecting"
        | "challenging"
        | "authenticating"
        | "connected"
      >();
    });
  });

  describe("ProtocolRequest", () => {
    it("has required fields: type, id, method", () => {
      const req: ProtocolRequest = {
        type: "req",
        id: "123",
        method: "health",
      };
      expect(req.type).toBe("req");
      expect(req.id).toBe("123");
      expect(req.method).toBe("health");
    });

    it("accepts optional params", () => {
      const req: ProtocolRequest = {
        type: "req",
        id: "123",
        method: "chat.send",
        params: { message: "hello" },
      };
      expect(req.params).toEqual({ message: "hello" });
    });
  });

  describe("ProtocolResponse", () => {
    it("has required fields: type, id, ok", () => {
      const res: ProtocolResponse = {
        type: "res",
        id: "123",
        ok: true,
      };
      expect(res.type).toBe("res");
      expect(res.id).toBe("123");
      expect(res.ok).toBe(true);
    });

    it("can include payload on success", () => {
      const res: ProtocolResponse = {
        type: "res",
        id: "123",
        ok: true,
        payload: { data: "result" },
      };
      expect(res.payload).toEqual({ data: "result" });
    });

    it("can include error on failure", () => {
      const res: ProtocolResponse = {
        type: "res",
        id: "123",
        ok: false,
        error: { code: "NOT_FOUND", message: "Resource not found" },
      };
      expect(res.error?.code).toBe("NOT_FOUND");
      expect(res.error?.message).toBe("Resource not found");
    });
  });

  describe("ProtocolEvent", () => {
    it("has required fields: type, event", () => {
      const evt: ProtocolEvent = {
        type: "event",
        event: "connect.challenge",
      };
      expect(evt.type).toBe("event");
      expect(evt.event).toBe("connect.challenge");
    });

    it("can include payload and sequence metadata", () => {
      const evt: ProtocolEvent = {
        type: "event",
        event: "chat.chunk",
        payload: { text: "hello" },
        seq: 1,
        stateVersion: 42,
      };
      expect(evt.payload).toEqual({ text: "hello" });
      expect(evt.seq).toBe(1);
      expect(evt.stateVersion).toBe(42);
    });
  });

  describe("ProtocolMessage union discrimination", () => {
    it("narrows to ProtocolRequest when type is 'req'", () => {
      const msg: ProtocolMessage = {
        type: "req",
        id: "1",
        method: "health",
      };

      if (msg.type === "req") {
        expectTypeOf(msg).toEqualTypeOf<ProtocolRequest>();
        expect(msg.method).toBe("health");
      }
    });

    it("narrows to ProtocolResponse when type is 'res'", () => {
      const msg: ProtocolMessage = {
        type: "res",
        id: "1",
        ok: true,
      };

      if (msg.type === "res") {
        expectTypeOf(msg).toEqualTypeOf<ProtocolResponse>();
        expect(msg.ok).toBe(true);
      }
    });

    it("narrows to ProtocolEvent when type is 'event'", () => {
      const msg: ProtocolMessage = {
        type: "event",
        event: "connect.challenge",
      };

      if (msg.type === "event") {
        expectTypeOf(msg).toEqualTypeOf<ProtocolEvent>();
        expect(msg.event).toBe("connect.challenge");
      }
    });

    it("covers all three variants in a switch statement", () => {
      const messages: ProtocolMessage[] = [
        { type: "req", id: "1", method: "health" },
        { type: "res", id: "2", ok: true },
        { type: "event", event: "tick" },
      ];

      const types = messages.map((msg) => {
        switch (msg.type) {
          case "req":
            return "request";
          case "res":
            return "response";
          case "event":
            return "event";
        }
      });

      expect(types).toEqual(["request", "response", "event"]);
    });
  });

  describe("ConnectChallenge", () => {
    it("has nonce and ts fields", () => {
      const challenge: ConnectChallenge = {
        nonce: "abc123",
        ts: 1700000000000,
      };
      expect(challenge.nonce).toBe("abc123");
      expect(challenge.ts).toBe(1700000000000);
    });
  });

  describe("HelloOk", () => {
    it("has required fields: type, protocol, policy", () => {
      const hello: HelloOk = {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
      };
      expect(hello.type).toBe("hello-ok");
      expect(hello.protocol).toBe(3);
      expect(hello.policy.tickIntervalMs).toBe(15000);
    });

    it("can include optional auth info", () => {
      const hello: HelloOk = {
        type: "hello-ok",
        protocol: 3,
        policy: { tickIntervalMs: 15000 },
        auth: {
          deviceToken: "token-123",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        },
      };
      expect(hello.auth?.deviceToken).toBe("token-123");
      expect(hello.auth?.role).toBe("operator");
      expect(hello.auth?.scopes).toEqual(["operator.read", "operator.write"]);
    });
  });
});
