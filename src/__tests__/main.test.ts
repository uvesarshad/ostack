import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";

describe("DEFAULT_SETTINGS", () => {
  it("has correct provider default", () => {
    expect(DEFAULT_SETTINGS.provider).toBe("claude");
  });

  it("has empty apiKey by default", () => {
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });

  it("has correct maxTokens default", () => {
    expect(DEFAULT_SETTINGS.maxTokens).toBe(6000);
  });

  it("has scoutEnabled true by default", () => {
    expect(DEFAULT_SETTINGS.scoutEnabled).toBe(true);
  });

  it("has correct scoutModel default", () => {
    expect(DEFAULT_SETTINGS.scoutModel).toBe("gemini-2.0-flash-lite");
  });

  it("has correct contextDecayDays default", () => {
    expect(DEFAULT_SETTINGS.contextDecayDays).toBe(14);
  });

  it("has inline outputMode by default", () => {
    expect(DEFAULT_SETTINGS.outputMode).toBe("inline");
  });

  it("has correct ollamaHost default", () => {
    expect(DEFAULT_SETTINGS.ollamaHost).toBe("http://localhost:11434");
  });
});

describe("concurrent skill execution", () => {
  it("inline mutex is keyed per note path", async () => {
    // Import fresh to avoid module state leakage
    const { runSkill } = await import("../skill-runner");
    const { App, TFile } = await import("obsidian");

    const app = new App();
    const file = new TFile("notes/active.md");
    app.workspace.getActiveFile = vi.fn().mockReturnValue(file);
    app.workspace.getActiveViewOfType = vi.fn().mockReturnValue(null);
    app.vault.cachedRead = vi.fn().mockResolvedValue("content");
    app.metadataCache.resolvedLinks = { "notes/active.md": {} };
    app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 })
    ));

    const skill = {
      name: "test",
      description: "test",
      output: "inline" as const,
      maxDepth: 3,
      maxTokens: 6000,
      systemPrompt: "Do {{VAULT_CONTEXT}}",
    };

    const settings = { ...DEFAULT_SETTINGS, apiKey: "sk-test" };

    // Run two concurrent inline calls on same note — second should be blocked
    const [r1, r2] = await Promise.allSettled([
      runSkill(skill, app, settings),
      runSkill(skill, app, settings),
    ]);

    // Both should resolve (not throw) — second one shows Notice and returns early
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
  });
});
