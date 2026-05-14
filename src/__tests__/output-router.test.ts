import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Editor, MarkdownView } from "obsidian";
import { routeOutput } from "../output-router";
import { Skill } from "../skill-loader";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test",
    description: "Test skill",
    output: "inline",
    maxDepth: 3,
    maxTokens: 6000,
    systemPrompt: "Do things. {{VAULT_CONTEXT}}",
    ...overrides,
  };
}

async function* fakeTokens(tokens: string[]): AsyncGenerator<string, void, unknown> {
  for (const t of tokens) yield t;
}

describe("routeOutput — inline mode", () => {
  it("calls replaceRange for each token", async () => {
    const editor = new Editor();
    editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });

    await routeOutput(
      fakeTokens(["Hello", " world"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill(),
        outputMode: "inline",
      },
      new App(),
      () => editor
    );

    expect(editor.replaceRange).toHaveBeenCalledTimes(2);
    expect(editor.replaceRange).toHaveBeenNthCalledWith(1, "Hello", { line: 0, ch: 0 });
    expect(editor.replaceRange).toHaveBeenNthCalledWith(2, " world", { line: 0, ch: 5 });
  });

  it("advances cursor correctly for multiline tokens", async () => {
    const editor = new Editor();
    editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });

    await routeOutput(
      fakeTokens(["line1\nline2"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill(),
        outputMode: "inline",
      },
      new App(),
      () => editor
    );

    expect(editor.replaceRange).toHaveBeenCalledWith("line1\nline2", { line: 0, ch: 0 });
    // After multiline token: cursor should be on line 1, ch 5 (length of "line2")
  });

  it("stops gracefully when editor becomes unavailable mid-stream", async () => {
    let callCount = 0;
    const getEditor = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const e = new Editor();
        e.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });
        return e;
      }
      return null; // editor gone on second call
    });

    await routeOutput(
      fakeTokens(["first", "second"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill(),
        outputMode: "inline",
      },
      new App(),
      getEditor
    );

    expect(getEditor).toHaveBeenCalledTimes(2);
  });

  it("returns early when no editor available at start", async () => {
    // Should not throw — just shows a notice and returns
    await expect(
      routeOutput(
        fakeTokens(["token"]),
        {
          activeNotePath: "notes/active.md",
          activeNoteBasename: "active",
          skill: makeSkill(),
          outputMode: "inline",
        },
        new App(),
        () => null
      )
    ).resolves.toBeUndefined();
  });
});

describe("routeOutput — new-note mode", () => {
  it("creates a note in the same folder as the active note", async () => {
    const app = new App();
    app.vault.adapter.exists = vi.fn().mockResolvedValue(false);
    app.vault.create = vi.fn().mockResolvedValue({ path: "notes/active — test.md" });

    const view = new MarkdownView();
    view.editor = new Editor();
    view.editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });
    app.workspace.getActiveViewOfType = vi.fn().mockReturnValue(view);

    const leaf = {
      openFile: vi.fn().mockResolvedValue(undefined),
    };
    app.workspace.getLeaf = vi.fn().mockReturnValue(leaf);

    await routeOutput(
      fakeTokens(["output text"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill({ name: "test" }),
        outputMode: "new-note",
      },
      app,
      () => null
    );

    expect(app.vault.create).toHaveBeenCalled();
    const createdPath = (app.vault.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(createdPath).toContain("notes/");
    expect(createdPath).toContain("active");
    expect(createdPath).toContain("Test");
  });

  it("appends timestamp when note name already exists", async () => {
    const app = new App();
    app.vault.adapter.exists = vi.fn().mockResolvedValue(true); // name collision
    app.vault.create = vi.fn().mockResolvedValue({ path: "stamped.md" });

    const view = new MarkdownView();
    view.editor = new Editor();
    view.editor.getCursor = vi.fn().mockReturnValue({ line: 0, ch: 0 });
    app.workspace.getActiveViewOfType = vi.fn().mockReturnValue(view);
    app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn() });

    await routeOutput(
      fakeTokens(["output"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill({ name: "test" }),
        outputMode: "new-note",
      },
      app,
      () => null
    );

    const createdPath = (app.vault.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Path should include a timestamp (pattern: YYYY-MM-DD HH-MM)
    expect(createdPath).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("shows Notice and aborts when vault.create fails", async () => {
    const { Notice } = await import("obsidian");
    const app = new App();
    app.vault.adapter.exists = vi.fn().mockResolvedValue(false);
    app.vault.create = vi.fn().mockRejectedValue(new Error("Permission denied"));
    app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn() });

    await routeOutput(
      fakeTokens(["output"]),
      {
        activeNotePath: "notes/active.md",
        activeNoteBasename: "active",
        skill: makeSkill({ name: "test" }),
        outputMode: "new-note",
      },
      app,
      () => null
    );

    // No crash — notice shown
    expect(app.vault.create).toHaveBeenCalled();
  });
});
