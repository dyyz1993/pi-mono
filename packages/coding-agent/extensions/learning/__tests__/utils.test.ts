import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import {
  findExistingMemoryContext,
  messageText,
  parseFrontmatter,
  stripMarkdownCodeBlock,
  truncateEntrypoint,
  buildFrontmatter,
} from "../utils.ts";

describe("messageText", () => {
  it("returns empty for messages without content", () => {
    const msg = { role: "user" } as AgentMessage;
    expect(messageText(msg)).toBe("");
  });

  it("returns string content directly", () => {
    const msg = { role: "user", content: "hello" } as unknown as AgentMessage;
    expect(messageText(msg)).toBe("hello");
  });

  it("extracts text parts from array content", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "second" },
      ],
    } as unknown as AgentMessage;
    expect(messageText(msg)).toBe("first\nsecond");
  });

  it("returns empty when no text parts", () => {
    const msg = {
      role: "user",
      content: [{ type: "thinking", thinking: "x" }],
    } as unknown as AgentMessage;
    expect(messageText(msg)).toBe("");
  });
});

describe("findExistingMemoryContext", () => {
  it("returns fingerprint when memory_context tag present", () => {
    const msg = {
      role: "assistant",
      content: `<memory_context fingerprint="abc123">content</memory_context>`,
    } as unknown as AgentMessage;
    expect(findExistingMemoryContext([msg])).toBe("abc123");
  });

  it("returns null when no memory_context tag", () => {
    const msg = {
      role: "assistant",
      content: "regular text",
    } as unknown as AgentMessage;
    expect(findExistingMemoryContext([msg])).toBeNull();
  });

  it("scans multiple messages", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: `<memory_context fingerprint="xyz">` },
    ] as unknown as AgentMessage[];
    expect(findExistingMemoryContext(msgs)).toBe("xyz");
  });

  it("returns null for empty array", () => {
    expect(findExistingMemoryContext([])).toBeNull();
  });
});

describe("stripMarkdownCodeBlock", () => {
  it("returns text unchanged when no fence", () => {
    expect(stripMarkdownCodeBlock("plain text")).toBe("plain text");
  });

  it("strips simple ``` fence", () => {
    expect(stripMarkdownCodeBlock("```\ncontent\n```")).toBe("content");
  });

  it("strips ```json fence", () => {
    expect(stripMarkdownCodeBlock("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("trims whitespace", () => {
    expect(stripMarkdownCodeBlock("  ```\nx\n```  ")).toBe("x");
  });
});

describe("parseFrontmatter", () => {
  it("returns empty frontmatter when no frontmatter block", () => {
    const result = parseFrontmatter("just body text");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("just body text");
  });

  it("parses simple frontmatter", () => {
    const content = "---\nname: test\ndescription: hello\n---\nbody content";
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("test");
    expect(result.frontmatter.description).toBe("hello");
    expect(result.body).toBe("body content");
  });

  it("handles missing closing ---", () => {
    const result = parseFrontmatter("---\nname: test\nno closing");
    expect(result.frontmatter).toEqual({});
  });

  it("normalizes CRLF", () => {
    const content = "---\r\nname: test\r\n---\r\nbody";
    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("test");
    expect(result.body).toBe("body");
  });
});

describe("truncateEntrypoint", () => {
  it("returns empty for empty input", () => {
    expect(truncateEntrypoint("")).toEqual({ content: "", wasTruncated: false });
  });

  it("does not truncate short content", () => {
    const short = "line1\nline2\nline3";
    expect(truncateEntrypoint(short)).toEqual({ content: short, wasTruncated: false });
  });

  it("truncates by line count (>200 lines)", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    const result = truncateEntrypoint(lines.join("\n"));
    expect(result.wasTruncated).toBe(true);
    expect(result.content.split("\n").length).toBe(200);
  });

  it("truncates by byte size (>25KB)", () => {
    const huge = "x".repeat(30_000);
    const result = truncateEntrypoint(huge);
    expect(result.wasTruncated).toBe(true);
    expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(25_000);
  });
});

describe("buildFrontmatter", () => {
  it("builds valid frontmatter string", () => {
    const fm = buildFrontmatter({ name: "test", description: "desc", type: "user" });
    expect(fm).toBe("---\nname: test\ndescription: desc\ntype: user\n---");
  });
});
