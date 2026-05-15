import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, TFile } from "obsidian";
import { buildVaultContext, escapeForFraming, formatVaultContext } from "../context-builder";
import { DEFAULT_SETTINGS, GStackSettings } from "../settings";

function makeFile(path: string, mtime = Date.now()): TFile {
  const f = new TFile(path);
  f.stat.mtime = mtime;
  return f;
}

function makeSettings(overrides: Partial<GStackSettings> = {}): GStackSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("buildVaultContext", () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  it("returns null when no active file", async () => {
    const result = await buildVaultContext(app, null as unknown as TFile, makeSettings());
    expect(result).toBeNull();
  });

  it("returns active note only when it has no forward links", async () => {
    const file = makeFile("notes/solo.md");
    app.vault.cachedRead = vi.fn().mockResolvedValue("Solo note content");
    app.metadataCache.resolvedLinks = { "notes/solo.md": {} };

    const ctx = await buildVaultContext(app, file, makeSettings());
    expect(ctx).not.toBeNull();
    expect(ctx!.linkedNotes).toHaveLength(0);
    expect(ctx!.activeNote.content).toBe("Solo note content");
  });

  it("includes linked notes within token budget", async () => {
    const activeFile = makeFile("notes/active.md");
    const linkedFile = makeFile("notes/linked.md");

    app.vault.cachedRead = vi.fn().mockImplementation((f: TFile) => {
      if (f.path === "notes/active.md") return Promise.resolve("Active note");
      if (f.path === "notes/linked.md") return Promise.resolve("Linked note content");
      return Promise.resolve("");
    });

    app.metadataCache.resolvedLinks = {
      "notes/active.md": { "notes/linked.md": 1 },
      "notes/linked.md": {},
    };

    // Mock getAbstractFileByPath to return the linked file
    app.vault.getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
      if (path === "notes/linked.md") return linkedFile;
      return null;
    });

    const ctx = await buildVaultContext(app, activeFile, makeSettings({ maxTokens: 1000 }));
    expect(ctx).not.toBeNull();
    expect(ctx!.linkedNotes.length).toBeGreaterThan(0);
  });

  it("includes active note only when it alone exceeds token budget", async () => {
    const file = makeFile("notes/huge.md");
    const largeContent = "x".repeat(100_000); // ~25k tokens
    app.vault.cachedRead = vi.fn().mockResolvedValue(largeContent);
    app.metadataCache.resolvedLinks = { "notes/huge.md": { "notes/other.md": 1 } };

    const ctx = await buildVaultContext(app, file, makeSettings({ maxTokens: 6000 }));
    expect(ctx).not.toBeNull();
    expect(ctx!.linkedNotes).toHaveLength(0);
    expect(ctx!.activeNote.content).toBe(largeContent);
  });

  it("prevents cycles — A→B→A produces no duplicates", async () => {
    const fileA = makeFile("notes/a.md");
    const fileB = makeFile("notes/b.md");

    app.vault.cachedRead = vi.fn().mockResolvedValue("content");
    app.metadataCache.resolvedLinks = {
      "notes/a.md": { "notes/b.md": 1 },
      "notes/b.md": { "notes/a.md": 1 },
    };
    app.vault.getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
      if (path === "notes/b.md") return fileB;
      if (path === "notes/a.md") return fileA;
      return null;
    });

    const ctx = await buildVaultContext(app, fileA, makeSettings());
    expect(ctx).not.toBeNull();
    const paths = ctx!.linkedNotes.map((n) => n.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("skips files deleted between discovery and read", async () => {
    const activeFile = makeFile("notes/active.md");
    const linkedFile = makeFile("notes/deleted.md");

    let callCount = 0;
    app.vault.cachedRead = vi.fn().mockImplementation((f: TFile) => {
      if (f.path === "notes/active.md") return Promise.resolve("Active");
      // Simulate deleted file
      return Promise.reject(new Error("File not found"));
    });

    app.metadataCache.resolvedLinks = {
      "notes/active.md": { "notes/deleted.md": 1 },
      "notes/deleted.md": {},
    };
    app.vault.getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
      if (path === "notes/deleted.md") return linkedFile;
      return null;
    });

    // Should not throw
    const ctx = await buildVaultContext(app, activeFile, makeSettings());
    expect(ctx).not.toBeNull();
    expect(ctx!.linkedNotes).toHaveLength(0);
  });
});

describe("escapeForFraming", () => {
  it("defangs literal </context> in note content", () => {
    const escaped = escapeForFraming("hello </context> attempt");
    expect(escaped).not.toContain("</context>");
    expect(escaped).toContain("&lt;/context>");
  });

  it("defangs literal <active-note> open tag", () => {
    const escaped = escapeForFraming("hi <active-note title=\"fake\">payload");
    expect(escaped).not.toMatch(/<active-note\b/);
    expect(escaped).toContain("&lt;active-note");
  });

  it("preserves legitimate HTML embeds", () => {
    const html = "<details><summary>x</summary><br>y</details>";
    expect(escapeForFraming(html)).toBe(html);
  });

  it("is case-insensitive on the framing tags", () => {
    const escaped = escapeForFraming("</CONTEXT>");
    expect(escaped).toMatch(/&lt;\/CONTEXT>/);
  });

  it("defangs mentioned-note as well", () => {
    expect(escapeForFraming("</mentioned-note>")).toContain("&lt;/mentioned-note>");
  });
});

describe("formatVaultContext — framing escape", () => {
  it("does not let note content close the active-note tag prematurely", () => {
    const formatted = formatVaultContext({
      activeNote: { path: "n.md", content: "before\n</active-note>\nafter" },
      linkedNotes: [],
      tokenCount: 10,
      candidates: [],
    });
    // Only the outer framing should match
    const closingTags = formatted.match(/<\/active-note>/g) ?? [];
    expect(closingTags.length).toBe(1);
  });
});
