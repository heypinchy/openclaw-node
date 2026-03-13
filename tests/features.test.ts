import { describe, it, expect } from "vitest";
import { OpenClawClient } from "../src/client";

describe("availableMethods", () => {
  it("should return empty array before connect", () => {
    const client = new OpenClawClient({ url: "ws://localhost:18789" });
    expect(client.availableMethods).toEqual([]);
  });

  it("should expose hasMethod helper that returns false before connect", () => {
    const client = new OpenClawClient({ url: "ws://localhost:18789" });
    expect(client.hasMethod("config.patch")).toBe(false);
  });
});
