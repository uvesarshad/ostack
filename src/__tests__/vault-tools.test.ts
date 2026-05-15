import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { executeVaultTool, VAULT_TOOLS, resolveTools } from "../tools/vault-tools";

function makeApp(): App {
  return new App();
}

describe("VAULT_TOOLS — schema", () => {
  it("exposes the six built-in tools", () => {
    expect(Object.keys(VAULT_TOOLS).sort()).toEqual(
      ["append_note", "get_active_note", "list_notes", "read_note", "search_vault", "write_note"]
    );
  });

  it("each tool has a name, description, and JSON schema with required[]", () => {
    for (const t of Object.values(VAULT_TOOLS)) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.input_schema.type).toBe("object");
      expect(Array.isArray(t.input_schema.required)).toBe(true);
    }
  });
});

describe("resolveTools", () => {
  it("returns all tools when allow-list is null", () => {
    expect(resolveTools(null).length).toBe(6);
  });

  it("returns all tools when allow-list is empty", () => {
    expect(resolveTools([]).length).toBe(6);
  });

  it("filters by name", () => {
    const tools = resolveTools(["read_note", "search_vault"]);
    expect(tools.map((t) => t.name).sort()).toEqual(["read_note", "search_vault"]);
  });

  it("drops unknown names silently", () => {
    const tools = resolveTools(["read_note", "made_up_tool"]);
    expect(tools.map((t) => t.name)).toEqual(["read_note"]);
  });
});

describe("executeVaultTool — read_note", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("returns file contents when the note exists", async () => {
    const file = new TFile("Notes/idea.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("hello world");

    const result = await executeVaultTool(app, "read_note", { path: "Notes/idea.md" });
    expect(result).toBe("hello world");
    expect(app.vault.read).toHaveBeenCalledWith(file);
  });

  it("returns an ERROR when the note doesn't exist", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
    const result = await executeVaultTool(app, "read_note", { path: "missing.md" });
    expect(result).toMatch(/^ERROR:/);
  });
});

describe("executeVaultTool — write_note (writes enabled)", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("creates a new note when the file doesn't exist", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
    const result = await executeVaultTool(app, "write_note", { path: "draft.md", content: "hi" }, { allowWrites: true });
    expect(app.vault.create).toHaveBeenCalledWith("draft.md", "hi");
    expect(result).toMatch(/^created /);
  });

  it("overwrites an existing note", async () => {
    const file = new TFile("draft.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    const result = await executeVaultTool(app, "write_note", { path: "draft.md", content: "new" }, { allowWrites: true });
    expect(app.vault.modify).toHaveBeenCalledWith(file, "new");
    expect(result).toMatch(/^wrote /);
  });

  it("creates parent folders before writing", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockImplementation((p: string) => {
      // Folder check returns non-TFolder; file check returns null
      if (p === "Inbox") return null;
      return null;
    });
    await executeVaultTool(app, "write_note", { path: "Inbox/x.md", content: "y" }, { allowWrites: true });
    expect(app.vault.adapter.mkdir).toHaveBeenCalledWith("Inbox");
  });
});

describe("executeVaultTool — write gate", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("refuses write_note by default (allowWrites omitted)", async () => {
    const result = await executeVaultTool(app, "write_note", { path: "draft.md", content: "x" });
    expect(result).toMatch(/^ERROR: agent file writes are disabled/);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it("refuses write_note when allowWrites is false", async () => {
    const result = await executeVaultTool(app, "write_note", { path: "draft.md", content: "x" }, { allowWrites: false });
    expect(result).toMatch(/^ERROR: agent file writes are disabled/);
  });

  it("refuses append_note by default", async () => {
    const result = await executeVaultTool(app, "append_note", { path: "log.md", content: "x" });
    expect(result).toMatch(/^ERROR: agent file writes are disabled/);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it("still permits read tools when writes are denied", async () => {
    const file = new TFile("a.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("hello");
    const result = await executeVaultTool(app, "read_note", { path: "a.md" }, { allowWrites: false });
    expect(result).toBe("hello");
  });
});

describe("executeVaultTool — append_note (writes enabled)", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("appends a newline when the existing file doesn't end with one", async () => {
    const file = new TFile("log.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("first line");
    await executeVaultTool(app, "append_note", { path: "log.md", content: "second" }, { allowWrites: true });
    expect(app.vault.modify).toHaveBeenCalledWith(file, "first line\nsecond");
  });

  it("does not add an extra newline when the file already ends with one", async () => {
    const file = new TFile("log.md");
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("first line\n");
    await executeVaultTool(app, "append_note", { path: "log.md", content: "second" }, { allowWrites: true });
    expect(app.vault.modify).toHaveBeenCalledWith(file, "first line\nsecond");
  });

  it("creates the note if it doesn't exist", async () => {
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
    await executeVaultTool(app, "append_note", { path: "new.md", content: "x" }, { allowWrites: true });
    expect(app.vault.create).toHaveBeenCalledWith("new.md", "x");
  });
});

describe("executeVaultTool — list_notes", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("lists all markdown files when no folder is specified", async () => {
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
      new TFile("a.md"),
      new TFile("Inbox/b.md"),
    ]);
    const result = await executeVaultTool(app, "list_notes", {});
    expect(result).toContain("a.md");
    expect(result).toContain("Inbox/b.md");
  });

  it("filters by folder prefix", async () => {
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
      new TFile("a.md"),
      new TFile("Inbox/b.md"),
      new TFile("Inbox/c.md"),
    ]);
    const result = await executeVaultTool(app, "list_notes", { folder: "Inbox" });
    expect(result).not.toContain("a.md");
    expect(result).toContain("Inbox/b.md");
    expect(result).toContain("Inbox/c.md");
  });

  it("truncates very long lists with a count", async () => {
    const many = Array.from({ length: 250 }, (_, i) => new TFile(`n${i}.md`));
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue(many);
    const result = await executeVaultTool(app, "list_notes", {});
    expect(result).toMatch(/50 more truncated/);
  });
});

describe("executeVaultTool — search_vault", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("returns matching files with a snippet", async () => {
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
      new TFile("a.md"),
      new TFile("b.md"),
    ]);
    app.vault.cachedRead = vi.fn()
      .mockResolvedValueOnce("nothing here")
      .mockResolvedValueOnce("here is the needle in a haystack");
    const result = await executeVaultTool(app, "search_vault", { query: "needle" });
    expect(result).toContain("b.md");
    expect(result).toContain("needle");
    expect(result).not.toContain("a.md");
  });

  it("is case-insensitive", async () => {
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([new TFile("a.md")]);
    app.vault.cachedRead = vi.fn().mockResolvedValue("HELLO WORLD");
    const result = await executeVaultTool(app, "search_vault", { query: "hello" });
    expect(result).toContain("a.md");
  });

  it("returns 'no matches' when nothing found", async () => {
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([new TFile("a.md")]);
    app.vault.cachedRead = vi.fn().mockResolvedValue("zzzzz");
    const result = await executeVaultTool(app, "search_vault", { query: "needle" });
    expect(result).toMatch(/^no matches/);
  });
});

describe("executeVaultTool — get_active_note", () => {
  let app: App;
  beforeEach(() => { app = makeApp(); });

  it("returns 'no active note' when none is open", async () => {
    app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
    const result = await executeVaultTool(app, "get_active_note", {});
    expect(result).toBe("no active note");
  });

  it("returns the path and contents of the active note", async () => {
    const file = new TFile("active.md");
    app.workspace.getActiveFile = vi.fn().mockReturnValue(file);
    app.vault.read = vi.fn().mockResolvedValue("body content");
    const result = await executeVaultTool(app, "get_active_note", {});
    expect(result).toContain("path: active.md");
    expect(result).toContain("body content");
  });
});

describe("executeVaultTool — unknown tool", () => {
  it("returns an ERROR for an unrecognized tool name", async () => {
    const app = makeApp();
    const result = await executeVaultTool(app, "drop_database", {});
    expect(result).toMatch(/^ERROR: unknown tool/);
  });
});

// Suppress unused-import warning when TFolder isn't reached at runtime
void TFolder;
