import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSKILL } from "../skill-loader";

const VALID_SKILL_MD = `---
name: my-skill
description: Does something useful
output: inline
max_depth: 2
max_tokens: 4000
---

You are an expert. Here is context:

{{VAULT_CONTEXT}}

Do the thing.`;

describe("parseSKILL", () => {
  it("parses a valid SKILL.md correctly", () => {
    const skill = parseSKILL(VALID_SKILL_MD, "test/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.description).toBe("Does something useful");
    expect(skill!.output).toBe("inline");
    expect(skill!.maxDepth).toBe(2);
    expect(skill!.maxTokens).toBe(4000);
    expect(skill!.systemPrompt).toContain("{{VAULT_CONTEXT}}");
  });

  it("defaults output to undefined when not specified (global setting is fallback)", () => {
    const content = `---\nname: test\ndescription: test desc\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill!.output).toBeUndefined();
  });

  it("defaults maxDepth to 3 when not specified", () => {
    const content = `---\nname: test\ndescription: test desc\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill!.maxDepth).toBe(3);
  });

  it("returns null for malformed frontmatter and logs warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const skill = parseSKILL("no frontmatter here", "test/SKILL.md");
    expect(skill).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("malformed SKILL.md frontmatter"));
    warnSpy.mockRestore();
  });

  it("returns null when name is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const content = `---\ndescription: no name\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing required fields"));
    warnSpy.mockRestore();
  });

  it("returns null when description is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const content = `---\nname: test\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing required fields"));
    warnSpy.mockRestore();
  });

  it("sets maxTokens to null when not specified", () => {
    const content = `---\nname: test\ndescription: desc\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill!.maxTokens).toBeNull();
  });

  it("sets output to new-note when specified", () => {
    const content = `---\nname: test\ndescription: desc\noutput: new-note\n---\nBody`;
    const skill = parseSKILL(content, "test/SKILL.md");
    expect(skill!.output).toBe("new-note");
  });

  it("preserves the system prompt body", () => {
    const skill = parseSKILL(VALID_SKILL_MD, "test/SKILL.md");
    expect(skill!.systemPrompt).toContain("You are an expert.");
    expect(skill!.systemPrompt).toContain("Do the thing.");
  });
});
