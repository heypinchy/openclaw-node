import { describe, it, expect } from "vitest";
import { toolResultText } from "../client";

describe("toolResultText", () => {
  it("returns a string payload as-is", () => {
    expect(toolResultText("plain output")).toBe("plain output");
  });

  it("joins the text items of a toTranscriptToolResult content array (literal quotes preserved)", () => {
    const payload = {
      content: [
        {
          type: "text",
          text: 'saved <pinchy:file name="x.pdf" mime="application/pdf" zone="uploads" />',
        },
      ],
    };
    expect(toolResultText(payload)).toBe(
      'saved <pinchy:file name="x.pdf" mime="application/pdf" zone="uploads" />',
    );
  });

  it("joins multiple text items with newlines and ignores non-text items", () => {
    const payload = {
      content: [
        { type: "text", text: "line 1" },
        { type: "image", url: "http://example/img.png" },
        { type: "text", text: "line 2" },
      ],
    };
    expect(toolResultText(payload)).toBe("line 1\nline 2");
  });

  it("falls back to JSON for an object without a usable content array", () => {
    expect(toolResultText({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("stringifies null/undefined to an empty JSON string", () => {
    expect(toolResultText(undefined)).toBe('""');
    expect(toolResultText(null)).toBe('""');
  });
});
