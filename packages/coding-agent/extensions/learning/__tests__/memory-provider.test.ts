import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import {
  buildMemoryCandidatePayload,
  extractText,
  parseExtractionResponse,
  shouldExtract,
} from "../memory-provider.ts";

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function assistantText(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResult(text: string): AgentMessage {
  return {
    role: "toolResult",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

describe("shouldExtract", () => {
  it("returns false for short conversations (<4 messages)", () => {
    expect(shouldExtract([userMessage("hi")])).toBe(false);
    expect(shouldExtract([userMessage("hi"), assistantText("hello")])).toBe(false);
  });

  it("returns false for pure greetings even with 4+ messages", () => {
    const msgs = [
      userMessage("哈喽"),
      assistantText("没问题"),
      userMessage("好的"),
      assistantText("嗯"),
    ];
    expect(shouldExtract(msgs)).toBe(false);
  });

  it("returns false when text is too short (<300 chars)", () => {
    const msgs = [
      userMessage("ok"),
      assistantText("ok"),
      userMessage("ok"),
      assistantText("ok"),
    ];
    expect(shouldExtract(msgs)).toBe(false);
  });

  it("returns true at exactly 300 chars with toolResult (boundary)", () => {
    const text300 = "x".repeat(300);
    const msgs = [
      userMessage(text300),
      assistantText(text300),
      toolResult(text300),
      assistantText(text300),
    ];
    expect(shouldExtract(msgs)).toBe(true);
  });

  it("returns true when technical content present", () => {
    const longText =
      "I need to fix the database config. " +
      "The API endpoint is throwing an error when deploying. " +
      "Let me refactor the implementation to handle this case properly. ".repeat(5);
    const msgs = [
      userMessage(longText),
      assistantText(longText),
      userMessage(longText),
      assistantText(longText),
    ];
    expect(shouldExtract(msgs)).toBe(true);
  });

  it("returns true when code block present", () => {
    const codeBlock = "```\nfunction foo() { return 42; }\n```\n" + "x".repeat(300);
    const msgs = [
      userMessage(codeBlock),
      assistantText(codeBlock),
      userMessage(codeBlock),
      assistantText(codeBlock),
    ];
    expect(shouldExtract(msgs)).toBe(true);
  });

  it("returns true when toolResult present", () => {
    const filler = "blah ".repeat(80);
    const msgs = [
      userMessage(filler),
      assistantText(filler),
      toolResult(filler),
      assistantText(filler),
    ];
    expect(shouldExtract(msgs)).toBe(true);
  });
});

describe("parseExtractionResponse", () => {
  it("returns null for invalid JSON", () => {
    expect(parseExtractionResponse("not json")).toBeNull();
    expect(parseExtractionResponse("")).toBeNull();
  });

  it("returns null when no actions array", () => {
    expect(parseExtractionResponse(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(parseExtractionResponse(JSON.stringify({ actions: [] }))).toBeNull();
    expect(parseExtractionResponse(JSON.stringify({ actions: "not array" }))).toBeNull();
  });

  it("returns first action when valid", () => {
    const response = JSON.stringify({
      actions: [{ op: "create", filename: "test.md", content: "hello" }],
    });
    const result = parseExtractionResponse(response);
    expect(result).not.toBeNull();
    expect(result!.op).toBe("create");
    expect(result!.filename).toBe("test.md");
    expect(result!.content).toBe("hello");
  });

  it("strips markdown code block fences", () => {
    const inner = JSON.stringify({
      actions: [{ op: "skip" }],
    });
    const wrapped = "```json\n" + inner + "\n```";
    const result = parseExtractionResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result!.op).toBe("skip");
  });
});

describe("extractText", () => {
  it("takes last 8 messages, joins non-empty text", () => {
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(userMessage(`msg-${i}`));
    }
    const text = extractText(msgs);
    // last 8 = msg-2..msg-9
    expect(text).toContain("msg-2");
    expect(text).toContain("msg-9");
    expect(text).not.toContain("msg-0");
    expect(text).not.toContain("msg-1");
  });

  it("returns empty for empty input", () => {
    expect(extractText([])).toBe("");
  });

  it("handles string content", () => {
    const msg = { role: "user", content: "plain string", timestamp: 0 } as unknown as AgentMessage;
    expect(extractText([msg])).toBe("plain string");
  });
});

describe("buildMemoryCandidatePayload", () => {
  it("returns null for empty messages", () => {
    expect(buildMemoryCandidatePayload([])).toBeNull();
  });

  it("builds payload with filename, description, content", () => {
    const text = "First line here\nsecond line";
    const msgs = [
      userMessage(text),
      assistantText("response"),
      toolResult("result"),
      assistantText("done"),
    ];
    const payload = buildMemoryCandidatePayload(msgs);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("memory");
    expect(payload!.filename).toMatch(/\.md$/);
    expect(payload!.description.length).toBeLessThanOrEqual(90);
    expect(payload!.memoryType).toBe("project");
    expect(payload!.content.length).toBeGreaterThan(0);
  });
});
