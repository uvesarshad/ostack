import { describe, it, expect } from "vitest";
import { isSafeSkillName } from "../import-skill-modal";

describe("isSafeSkillName", () => {
  it("accepts plain names", () => {
    expect(isSafeSkillName("research")).toBe(true);
    expect(isSafeSkillName("vault-agent")).toBe(true);
    expect(isSafeSkillName("Plan_2")).toBe(true);
    expect(isSafeSkillName("a")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isSafeSkillName("..")).toBe(false);
    expect(isSafeSkillName(".")).toBe(false);
    expect(isSafeSkillName("../../etc/passwd")).toBe(false);
    expect(isSafeSkillName("../skill")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isSafeSkillName("foo/bar")).toBe(false);
    expect(isSafeSkillName("foo\\bar")).toBe(false);
    expect(isSafeSkillName("a/b/c")).toBe(false);
  });

  it("rejects shell metacharacters and spaces", () => {
    expect(isSafeSkillName("foo bar")).toBe(false);
    expect(isSafeSkillName("foo;rm -rf")).toBe(false);
    expect(isSafeSkillName("foo&bar")).toBe(false);
    expect(isSafeSkillName("foo|bar")).toBe(false);
    expect(isSafeSkillName("foo$bar")).toBe(false);
  });

  it("rejects names that start with non-alphanumeric", () => {
    expect(isSafeSkillName("-foo")).toBe(false);
    expect(isSafeSkillName("_foo")).toBe(false);
  });

  it("rejects empty and overlong names", () => {
    expect(isSafeSkillName("")).toBe(false);
    expect(isSafeSkillName("a".repeat(41))).toBe(false);
    expect(isSafeSkillName("a".repeat(40))).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isSafeSkillName(null as unknown as string)).toBe(false);
    expect(isSafeSkillName(undefined as unknown as string)).toBe(false);
    expect(isSafeSkillName(42 as unknown as string)).toBe(false);
  });
});
