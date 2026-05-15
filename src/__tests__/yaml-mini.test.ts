import { describe, it, expect } from "vitest";
import { parseYamlFrontmatter } from "../yaml-mini";

describe("parseYamlFrontmatter", () => {
  it("parses plain key: value pairs", () => {
    expect(parseYamlFrontmatter("name: research\ndesc: a brief")).toEqual({
      name: "research",
      desc: "a brief",
    });
  });

  it("preserves colons inside values", () => {
    expect(parseYamlFrontmatter(`title: "hello: world"`)).toEqual({
      title: "hello: world",
    });
  });

  it("handles double-quoted values with escapes", () => {
    expect(parseYamlFrontmatter(`x: "she said \\"hi\\""`)).toEqual({
      x: 'she said "hi"',
    });
  });

  it("handles single-quoted values with doubled-quote escape", () => {
    expect(parseYamlFrontmatter(`x: 'it''s fine'`)).toEqual({
      x: "it's fine",
    });
  });

  it("skips blank lines and # comments", () => {
    const yaml = `# preamble\nname: x\n\n# mid comment\ndesc: y`;
    expect(parseYamlFrontmatter(yaml)).toEqual({ name: "x", desc: "y" });
  });

  it("strips trailing inline comments", () => {
    expect(parseYamlFrontmatter(`name: x  # explain`)).toEqual({ name: "x" });
  });

  it("does not treat # inside quotes as a comment", () => {
    expect(parseYamlFrontmatter(`tag: "#focus"`)).toEqual({ tag: "#focus" });
  });

  it("rejects duplicate keys (ambiguous)", () => {
    expect(parseYamlFrontmatter("a: 1\na: 2")).toBeNull();
  });

  it("rejects keys with invalid characters", () => {
    expect(parseYamlFrontmatter("bad key: x")).toBeNull();
    expect(parseYamlFrontmatter("123key: x")).toBeNull();
  });

  it("rejects lines without a key colon", () => {
    expect(parseYamlFrontmatter("just text")).toBeNull();
  });

  it("rejects malformed quoted strings", () => {
    expect(parseYamlFrontmatter(`x: "unterminated`)).toBeNull();
  });

  it("preserves bracket-list values as raw strings (caller parses)", () => {
    expect(parseYamlFrontmatter("tools: [a, b, c]")).toEqual({
      tools: "[a, b, c]",
    });
  });

  it("supports hyphens and underscores in keys", () => {
    expect(parseYamlFrontmatter("max-rounds: 10\nauto_insert: true")).toEqual({
      "max-rounds": "10",
      auto_insert: "true",
    });
  });

  it("treats empty values as empty string", () => {
    expect(parseYamlFrontmatter("flag:")).toEqual({ flag: "" });
  });
});
