import { describe, it, expect, vi } from "vitest";
import { App, TFile } from "obsidian";
import { resolveMentions } from "../mention-resolver";

function setupVault(app: App, files: Array<{ path: string; content: string }>): void {
  const tfiles = files.map((f) => {
    const tf = new TFile(f.path);
    // ensure mock has the basename helper our resolver checks
    return Object.assign(tf, { _content: f.content });
  });
  app.vault.getFiles = vi.fn().mockReturnValue(tfiles);
  app.vault.cachedRead = vi.fn().mockImplementation((f: TFile & { _content?: string }) =>
    Promise.resolve(f._content ?? "")
  );
}

describe("resolveMentions", () => {
  it("returns empty string when no mentions are present", async () => {
    const app = new App();
    setupVault(app, [{ path: "a.md", content: "alpha" }]);
    const out = await resolveMentions("just a plain message", app);
    expect(out).toBe("");
  });

  it("inlines the content of a referenced note", async () => {
    const app = new App();
    setupVault(app, [{ path: "Ideas.md", content: "brainstorm body" }]);
    const out = await resolveMentions("see [[Ideas]] for context", app);
    expect(out).toContain('<mentioned-note title="Ideas">');
    expect(out).toContain("brainstorm body");
    expect(out).toContain("</mentioned-note>");
  });

  it("handles [[Note|alias]] syntax by resolving on the left side", async () => {
    const app = new App();
    setupVault(app, [{ path: "Plan.md", content: "plan body" }]);
    const out = await resolveMentions("see [[Plan|the plan]] for details", app);
    expect(out).toContain("plan body");
  });

  it("is case-insensitive on basename", async () => {
    const app = new App();
    setupVault(app, [{ path: "MyNote.md", content: "x" }]);
    const out = await resolveMentions("hey [[mynote]]", app);
    expect(out).toContain("x");
  });

  it("dedupes repeated mentions of the same note", async () => {
    const app = new App();
    setupVault(app, [{ path: "Once.md", content: "ONLY" }]);
    const out = await resolveMentions("[[Once]] and [[Once]] again", app);
    const occurrences = out.split("ONLY").length - 1;
    expect(occurrences).toBe(1);
  });

  it("silently skips mentions that don't resolve", async () => {
    const app = new App();
    setupVault(app, [{ path: "Real.md", content: "real" }]);
    const out = await resolveMentions("[[NotInVault]] and [[Real]]", app);
    expect(out).toContain("real");
    expect(out).not.toContain("NotInVault");
  });

  it("ignores non-md mentions (extension filter)", async () => {
    const app = new App();
    const pdf = new TFile("doc.pdf");
    // override extension on the TFile mock
    Object.defineProperty(pdf, "extension", { value: "pdf" });
    app.vault.getFiles = vi.fn().mockReturnValue([pdf]);
    const out = await resolveMentions("[[doc]]", app);
    expect(out).toBe("");
  });
});
