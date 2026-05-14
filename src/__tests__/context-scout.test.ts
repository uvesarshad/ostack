import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, TFile } from "obsidian";
import { applyScoutResults, scoutContext } from "../context-scout";
import { VaultContext, ScoredFile } from "../context-builder";
import { DEFAULT_SETTINGS } from "../settings";

function makeVaultCtx(): VaultContext {
  const fileA = new TFile("notes/a.md");
  const fileB = new TFile("notes/b.md");
  return {
    activeNote: { path: "notes/active.md", content: "Active content" },
    linkedNotes: [
      { path: "notes/a.md", content: "Content A", score: 0.8, depth: 1 },
      { path: "notes/b.md", content: "Content B", score: 0.3, depth: 2 },
    ],
    tokenCount: 100,
    candidates: [
      { file: fileA, score: 0.8, depth: 1 },
      { file: fileB, score: 0.3, depth: 2 },
    ],
  };
}

describe("scoutContext", () => {
  it("returns null on empty candidates", async () => {
    const ctx = makeVaultCtx();
    ctx.candidates = [];
    const result = await scoutContext([], ctx, new App(), DEFAULT_SETTINGS);
    expect(result).toBeNull();
  });

  it("returns null when provider throws (fallback to metadata scoring)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const ctx = makeVaultCtx();
    const result = await scoutContext(ctx.candidates, ctx, new App(), {
      ...DEFAULT_SETTINGS,
      provider: "claude",
      apiKey: "test-key",
      scoutEnabled: true,
    });

    // Provider threw → scoutContext returns null (caller falls back to metadata scoring)
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("applyScoutResults", () => {
  it("updates scores and adds annotations from scout results", () => {
    const ctx = makeVaultCtx();
    const scoutResults = [
      { path: "notes/a.md", score: 0.95, annotation: "highly relevant" },
      { path: "notes/b.md", score: 0.1, annotation: "low relevance" },
    ];

    const updated = applyScoutResults(ctx, scoutResults);
    const noteA = updated.linkedNotes.find((n) => n.path === "notes/a.md");
    const noteB = updated.linkedNotes.find((n) => n.path === "notes/b.md");

    expect(noteA!.score).toBe(0.95);
    expect(noteA!.annotation).toContain("highly relevant");
    expect(noteA!.summaryOnly).toBe(false);

    expect(noteB!.score).toBe(0.1);
    expect(noteB!.summaryOnly).toBe(true);
  });

  it("sorts updated notes by score descending", () => {
    const ctx = makeVaultCtx();
    const scoutResults = [
      { path: "notes/a.md", score: 0.2, annotation: "low" },
      { path: "notes/b.md", score: 0.9, annotation: "high" },
    ];

    const updated = applyScoutResults(ctx, scoutResults);
    expect(updated.linkedNotes[0].score).toBeGreaterThan(updated.linkedNotes[1].score);
  });

  it("leaves notes without scout results unchanged", () => {
    const ctx = makeVaultCtx();
    const scoutResults = [
      { path: "notes/a.md", score: 0.7, annotation: "ok" },
    ];

    const updated = applyScoutResults(ctx, scoutResults);
    const noteB = updated.linkedNotes.find((n) => n.path === "notes/b.md");
    expect(noteB!.annotation).toBeUndefined();
    expect(noteB!.summaryOnly).toBeUndefined();
  });
});
