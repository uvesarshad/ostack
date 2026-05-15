import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, TFile } from "obsidian";
import { runClaudeAgent, AgentEvent } from "../agent-loop";
import { ClaudeProvider, ClaudeStreamEvent } from "../providers/claude";

// Build an async generator that emits a scripted sequence of stream events,
// then add a return value to satisfy AsyncGenerator typing.
function scripted(events: ClaudeStreamEvent[]): AsyncGenerator<ClaudeStreamEvent> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runClaudeAgent — basic flow", () => {
  let app: App;
  beforeEach(() => { app = new App(); });

  it("yields text deltas and finishes when stop_reason is end_turn", async () => {
    vi.spyOn(ClaudeProvider.prototype, "streamWithTools").mockImplementation(() =>
      scripted([
        { type: "text", text: "Hello " },
        { type: "text", text: "world." },
        { type: "stop", stopReason: "end_turn" },
      ])
    );

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "claude-sonnet-4-6",
      systemPrompt: "sys",
      userMessage: "hi",
      allowedTools: null,
    }));

    const texts = events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text);
    expect(texts.join("")).toBe("Hello world.");
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  });

  it("executes a tool when the model returns tool_use, then continues to final text", async () => {
    const file = new TFile("x.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("file body");

    // Two rounds: first asks for read_note, second returns final text
    const spy = vi.spyOn(ClaudeProvider.prototype, "streamWithTools");
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "tool_use", id: "tu_1", name: "read_note", input: { path: "x.md" } },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "text", text: "I read x.md: file body" },
        { type: "stop", stopReason: "end_turn" },
      ])
    );

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "claude-sonnet-4-6",
      systemPrompt: "sys",
      userMessage: "read x.md",
      allowedTools: ["read_note"],
    }));

    const calls = events.filter((e) => e.type === "tool_call");
    expect(calls.length).toBe(1);
    expect((calls[0] as { name: string }).name).toBe("read_note");

    const results = events.filter((e) => e.type === "tool_result");
    expect(results.length).toBe(1);
    expect((results[0] as { output: string; isError: boolean }).output).toBe("file body");
    expect((results[0] as { output: string; isError: boolean }).isError).toBe(false);

    const texts = events.filter((e) => e.type === "text_delta");
    expect(texts.map((e) => (e as { text: string }).text).join("")).toBe("I read x.md: file body");

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("marks tool results as errors when the tool returns ERROR:", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

    const spy = vi.spyOn(ClaudeProvider.prototype, "streamWithTools");
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "tool_use", id: "tu_1", name: "read_note", input: { path: "missing.md" } },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "text", text: "I couldn't find it." },
        { type: "stop", stopReason: "end_turn" },
      ])
    );

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
    }));

    const result = events.find((e) => e.type === "tool_result") as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/^ERROR:/);
  });

  it("respects the loop guard and emits an error after too many rounds", async () => {
    // Provider always asks for another tool call, never finishing
    vi.spyOn(ClaudeProvider.prototype, "streamWithTools").mockImplementation(() =>
      scripted([
        { type: "tool_use", id: "tu_x", name: "get_active_note", input: {} },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
    }));

    const lastEvt = events[events.length - 1];
    expect(lastEvt.type).toBe("error");
    expect((lastEvt as { message: string }).message).toMatch(/gave up after \d+ tool rounds/);
  });

  it("respects per-skill maxRounds override", async () => {
    vi.spyOn(ClaudeProvider.prototype, "streamWithTools").mockImplementation(() =>
      scripted([
        { type: "tool_use", id: "tu_x", name: "get_active_note", input: {} },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
      maxRounds: 3,
    }));

    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBe(3);
    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    expect((last as { message: string }).message).toMatch(/after 3 tool rounds/);
  });

  it("caps maxRounds to the hard ceiling even if frontmatter requests more", async () => {
    let callCount = 0;
    vi.spyOn(ClaudeProvider.prototype, "streamWithTools").mockImplementation(() => {
      callCount++;
      return scripted([
        { type: "tool_use", id: `tu_${callCount}`, name: "get_active_note", input: {} },
        { type: "stop", stopReason: "tool_use" },
      ]);
    });
    app.workspace.getActiveFile = vi.fn().mockReturnValue(null);

    await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
      maxRounds: 9999,
    }));

    // HARD_MAX_TOOL_ROUNDS is 40
    expect(callCount).toBe(40);
  });

  it("emits an error event when the provider throws", async () => {
    vi.spyOn(ClaudeProvider.prototype, "streamWithTools").mockImplementation(() => {
      throw { status: 401, body: "unauthorized" };
    });

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
    }));

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
    expect((events[0] as { message: string }).message).toContain("unauthorized");
  });

  it("refuses write_note when allowWrites is omitted (default off)", async () => {
    const spy = vi.spyOn(ClaudeProvider.prototype, "streamWithTools");
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "tool_use", id: "tu_w", name: "write_note", input: { path: "out.md", content: "hi" } },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "text", text: "Writes are off — here's the proposed content instead." },
        { type: "stop", stopReason: "end_turn" },
      ])
    );

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
      // allowWrites intentionally omitted
    }));

    const result = events.find((e) => e.type === "tool_result") as { isError: boolean; output: string };
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/agent file writes are disabled/);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it("permits write_note when allowWrites is true", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

    const spy = vi.spyOn(ClaudeProvider.prototype, "streamWithTools");
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "tool_use", id: "tu_w", name: "write_note", input: { path: "out.md", content: "hi" } },
        { type: "stop", stopReason: "tool_use" },
      ])
    );
    spy.mockImplementationOnce(() =>
      scripted([
        { type: "text", text: "Wrote out.md." },
        { type: "stop", stopReason: "end_turn" },
      ])
    );

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
      allowWrites: true,
    }));

    const result = events.find((e) => e.type === "tool_result") as { isError: boolean; output: string };
    expect(result.isError).toBe(false);
    expect(app.vault.create).toHaveBeenCalledWith("out.md", "hi");
  });

  it("stops early when the abort signal is triggered before the first round", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await drain(runClaudeAgent({
      app,
      apiKey: "sk",
      model: "m",
      systemPrompt: "sys",
      userMessage: "go",
      allowedTools: null,
      signal: controller.signal,
    }));

    expect(events.length).toBe(0);
  });
});
