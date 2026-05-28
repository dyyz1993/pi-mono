import { describe, it, expect } from "vitest";
import { matchesCondition, groupMatches } from "./index.js";

describe("matchesCondition", () => {
  const event = (toolName: string) => ({ toolName });

  // --- Expression path: toolName == 'xxx' ---

  it("matches toolName == 'write' with single quotes", () => {
    expect(matchesCondition("toolName == 'write'", event("write"))).toBe(true);
    expect(matchesCondition("toolName == 'write'", event("read"))).toBe(false);
  });

  it('matches toolName == "write" with double quotes', () => {
    expect(matchesCondition('toolName == "write"', event("write"))).toBe(true);
    expect(matchesCondition('toolName == "write"', event("read"))).toBe(false);
  });

  it("matches toolName === 'xxx' (triple equals)", () => {
    expect(matchesCondition("toolName === 'write'", event("write"))).toBe(true);
    expect(matchesCondition("toolName === 'write'", event("Read"))).toBe(false);
  });

  it("is case-insensitive on toolName keyword", () => {
    expect(matchesCondition("toolname == 'write'", event("write"))).toBe(true);
    expect(matchesCondition("TOOLNAME == 'write'", event("write"))).toBe(true);
  });

  it("handles whitespace around operator", () => {
    expect(matchesCondition("toolName=='write'", event("write"))).toBe(true);
    expect(matchesCondition("toolName   ==   'write'", event("write"))).toBe(true);
  });

  it("does case-insensitive tool name comparison", () => {
    expect(matchesCondition("toolName == 'Write'", event("write"))).toBe(true);
    expect(matchesCondition("toolName == 'WRITE'", event("write"))).toBe(true);
    expect(matchesCondition("toolName == 'write'", event("WRITE"))).toBe(true);
  });

  // --- Fast path: pipe-separated names ---

  it("matches simple pipe-separated tool names", () => {
    expect(matchesCondition("write|read", event("write"))).toBe(true);
    expect(matchesCondition("write|read", event("read"))).toBe(true);
    expect(matchesCondition("write|read", event("bash"))).toBe(false);
  });

  it("matches single tool name", () => {
    expect(matchesCondition("write", event("write"))).toBe(true);
    expect(matchesCondition("write", event("read"))).toBe(false);
  });

  it("trims whitespace in pipe-separated names", () => {
    expect(matchesCondition("write | read", event("write"))).toBe(true);
    expect(matchesCondition("write | read", event("read"))).toBe(true);
  });

  // --- Regex path ---

  it("matches regex patterns", () => {
    expect(matchesCondition("^wr.*", event("write"))).toBe(true);
    expect(matchesCondition("^wr.*", event("read"))).toBe(false);
  });

  it("returns false for invalid regex", () => {
    expect(matchesCondition("[invalid", event("write"))).toBe(false);
  });

  // --- Edge cases ---

  it("returns true for undefined condition", () => {
    expect(matchesCondition(undefined, event("write"))).toBe(true);
  });

  it("returns true for empty string condition", () => {
    expect(matchesCondition("", event("write"))).toBe(true);
  });
});

describe("groupMatches", () => {
  it("returns true for undefined matcher", () => {
    expect(groupMatches(undefined, "write")).toBe(true);
  });

  it("returns true for empty string matcher", () => {
    expect(groupMatches("", "write")).toBe(true);
  });

  it("returns true for wildcard matcher", () => {
    expect(groupMatches("*", "write")).toBe(true);
  });

  it("delegates expression matching to matchesCondition", () => {
    expect(groupMatches("toolName == 'write'", "write")).toBe(true);
    expect(groupMatches("toolName == 'write'", "read")).toBe(false);
  });

  it("delegates simple name matching to matchesCondition", () => {
    expect(groupMatches("write|read", "write")).toBe(true);
    expect(groupMatches("write|read", "bash")).toBe(false);
  });
});
