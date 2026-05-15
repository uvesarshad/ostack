import { describe, it, expect } from "vitest";
import {
  extractAsks,
  stripAsks,
  formatToolInput,
  formatToolInputForLog,
  truncate,
  truncateForLog,
  isLocalOrCliProvider,
  formatProviderError,
} from "../bar-chat";

describe("extractAsks", () => {
  it("returns empty when no ASK tags are present", () => {
    expect(extractAsks("plain answer")).toEqual([]);
  });

  it("extracts a single question", () => {
    expect(extractAsks("plan goes here. <ASK>Which year?</ASK>"))
      .toEqual(["Which year?"]);
  });

  it("extracts multiple questions in order", () => {
    const text = "thoughts. <ASK>Q1?</ASK> more text <ASK>Q2?</ASK>";
    expect(extractAsks(text)).toEqual(["Q1?", "Q2?"]);
  });

  it("trims whitespace inside the tag", () => {
    expect(extractAsks("<ASK>   spaced   </ASK>")).toEqual(["spaced"]);
  });

  it("skips empty ASK tags", () => {
    expect(extractAsks("noise <ASK></ASK> <ASK>real?</ASK>")).toEqual(["real?"]);
  });

  it("handles multi-line ASK content", () => {
    const text = "<ASK>line one\nline two</ASK>";
    expect(extractAsks(text)).toEqual(["line one\nline two"]);
  });

  it("is idempotent across calls (regex lastIndex reset)", () => {
    const text = "<ASK>A</ASK><ASK>B</ASK>";
    expect(extractAsks(text)).toEqual(["A", "B"]);
    expect(extractAsks(text)).toEqual(["A", "B"]); // would fail without lastIndex reset
  });
});

describe("stripAsks", () => {
  it("returns text unchanged when no tags", () => {
    expect(stripAsks("hello")).toBe("hello");
  });

  it("removes ASK blocks", () => {
    expect(stripAsks("before <ASK>q?</ASK> after")).toBe("before  after");
  });

  it("trims final result", () => {
    expect(stripAsks("<ASK>q?</ASK>")).toBe("");
    expect(stripAsks("   <ASK>q?</ASK>   ")).toBe("");
  });

  it("preserves non-ASK content with multiple tags", () => {
    expect(stripAsks("a <ASK>1</ASK> b <ASK>2</ASK> c")).toBe("a  b  c");
  });
});

describe("formatToolInput", () => {
  it("returns empty string for empty input", () => {
    expect(formatToolInput({})).toBe("");
  });

  it("formats single string value", () => {
    expect(formatToolInput({ path: "x.md" })).toBe("path=x.md");
  });

  it("joins multiple keys with comma", () => {
    expect(formatToolInput({ path: "x.md", content: "hi" }))
      .toMatch(/path=x\.md.*content=hi/);
  });

  it("truncates long string values to 60 chars", () => {
    const long = "a".repeat(100);
    const out = formatToolInput({ note: long });
    expect(out.length).toBeLessThan(80);
    expect(out).toMatch(/…$/);
  });

  it("JSON-stringifies non-string values", () => {
    expect(formatToolInput({ count: 42, deep: { a: 1 } }))
      .toBe('count=42, deep={"a":1}');
  });
});

describe("formatToolInputForLog", () => {
  it("uses tighter 40-char truncation than display formatter", () => {
    const long = "x".repeat(100);
    const out = formatToolInputForLog({ note: long });
    expect(out.length).toBeLessThan(60);
    expect(out).toMatch(/…$/);
  });

  it("handles non-string values", () => {
    expect(formatToolInputForLog({ n: 7 })).toBe("n=7");
  });
});

describe("truncate / truncateForLog", () => {
  it("truncate returns shorter strings unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("truncate replaces the tail with ellipsis at the cap", () => {
    expect(truncate("12345678901234567890", 10)).toBe("123456789…");
    expect(truncate("12345678901234567890", 10).length).toBe(10);
  });

  it("truncateForLog returns shorter strings unchanged (uses <=)", () => {
    expect(truncateForLog("exact", 5)).toBe("exact");
  });

  it("truncateForLog replaces the tail at length > n", () => {
    expect(truncateForLog("123456", 5)).toBe("1234…");
  });
});

describe("isLocalOrCliProvider", () => {
  it("returns true for ollama and CLI kinds", () => {
    expect(isLocalOrCliProvider("ollama")).toBe(true);
    expect(isLocalOrCliProvider("claude-cli")).toBe(true);
    expect(isLocalOrCliProvider("codex-cli")).toBe(true);
    expect(isLocalOrCliProvider("gemini-cli")).toBe(true);
  });

  it("returns false for hosted API providers", () => {
    expect(isLocalOrCliProvider("claude")).toBe(false);
    expect(isLocalOrCliProvider("openai")).toBe(false);
    expect(isLocalOrCliProvider("gemini")).toBe(false);
    expect(isLocalOrCliProvider("grok")).toBe(false);
  });

  it("returns false for unknown values", () => {
    expect(isLocalOrCliProvider("")).toBe(false);
    expect(isLocalOrCliProvider("anything-else")).toBe(false);
  });
});

describe("formatProviderError", () => {
  it("returns timeout message for AbortError", () => {
    expect(formatProviderError({ name: "AbortError" }, "claude"))
      .toBe("Timed out after 120s.");
  });

  it("returns timeout message when message === 'timeout'", () => {
    expect(formatProviderError({ message: "timeout" }, "openai"))
      .toBe("Timed out after 120s.");
  });

  it("special-cases 401 as invalid API key", () => {
    expect(formatProviderError({ status: 401 }, "claude"))
      .toMatch(/[Ii]nvalid API key/);
  });

  it("special-cases status 0 as unreachable", () => {
    expect(formatProviderError({ status: 0, body: "ECONNREFUSED" }, "ollama"))
      .toContain("Cannot reach ollama");
  });

  it("renders other 4xx/5xx with body", () => {
    expect(formatProviderError({ status: 503, body: "service down" }, "gemini"))
      .toBe("Provider error 503: service down");
  });

  it("falls back to message or generic when status missing", () => {
    expect(formatProviderError({ message: "weirdo" }, "claude")).toBe("weirdo");
    expect(formatProviderError({}, "claude")).toBe("Could not reach claude.");
  });
});
