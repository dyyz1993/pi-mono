import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import {
  buildSkillCandidatePayload,
  buildWorkflowDocument,
  deriveSkillName,
  extractWorkflowText,
  shouldDistill,
} from "../skill-provider.ts";

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

function assistantToolCall(name: string, args: Record<string, unknown> = {}): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", name, arguments: args }],
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

describe("shouldDistill", () => {
  it("returns false for pure greetings", () => {
    const messages = [userMessage("哈喽"), assistantText("没问题")];
    expect(shouldDistill(messages)).toBe(false);
  });

  it("returns false when no write tool call", () => {
    const messages = [
      userMessage("explain this function"),
      assistantToolCall("read", { path: "/tmp/x.ts" }),
      toolResult("file contents"),
      assistantText("Here is the explanation"),
    ];
    expect(shouldDistill(messages)).toBe(false);
  });

  it("returns true when write tool call + toolResult + assistant reply", () => {
    const messages = [
      userMessage("create /tmp/test.txt"),
      assistantToolCall("write", { path: "/tmp/test.txt", content: "hi" }),
      toolResult("Successfully wrote 6 bytes"),
      assistantText("Done"),
    ];
    expect(shouldDistill(messages)).toBe(true);
  });

  it("returns true for bash git commit", () => {
    const messages = [
      userMessage("commit my changes"),
      assistantToolCall("bash", { command: "git commit -m foo" }),
      toolResult("[main abc1234] foo"),
      assistantText("Committed"),
    ];
    expect(shouldDistill(messages)).toBe(true);
  });

  it("returns false for bash ls (read-only)", () => {
    const messages = [
      userMessage("list files"),
      assistantToolCall("bash", { command: "ls -la" }),
      toolResult("file1\nfile2"),
      assistantText("Here are the files"),
    ];
    expect(shouldDistill(messages)).toBe(false);
  });

  it("does NOT trigger on prose 'write a function' without actual write tool", () => {
    const messages = [
      userMessage("How do I write a function in Python?"),
      assistantText("You can write a function using the def keyword..."),
    ];
    expect(shouldDistill(messages)).toBe(false);
  });

  it("returns false when assistant reply missing", () => {
    const messages = [
      userMessage("create file"),
      assistantToolCall("write", { path: "/x" }),
      toolResult("ok"),
    ];
    expect(shouldDistill(messages)).toBe(false);
  });
});

describe("deriveSkillName", () => {
  it("derives verb-noun from English request", () => {
    expect(deriveSkillName([userMessage("Please create a file at /tmp/x")])).toBe("create-file");
  });

  it("derives from Chinese 创建 + 文件", () => {
    expect(deriveSkillName([userMessage("帮我在 /tmp 下创建一个文件")])).toBe("create-file");
  });

  it("returns verb only when no noun matches", () => {
    expect(deriveSkillName([userMessage("deploy the thing")])).toBe("deploy");
  });

  it("falls back to 'task' when nothing matches", () => {
    expect(deriveSkillName([userMessage("blah blah blah")])).toBe("task");
  });

  it("falls back to 'learned-workflow' when no user message", () => {
    expect(deriveSkillName([])).toBe("learned-workflow");
    expect(deriveSkillName([assistantText("x")])).toBe("learned-workflow");
  });
});

describe("buildWorkflowDocument", () => {
  it("includes user request, thinking, tool call, tool result, response", () => {
    const messages: AgentMessage[] = [
      userMessage("Create a test file"),
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should use the write tool" },
          { type: "toolCall", name: "write", arguments: { path: "/tmp/test.txt", content: "hi" } },
        ],
        timestamp: Date.now(),
      } as AgentMessage,
      toolResult("Successfully wrote"),
      assistantText("Done!"),
    ];

    const doc = buildWorkflowDocument(messages);
    expect(doc).toContain("### User Request");
    expect(doc).toContain("Create a test file");
    expect(doc).toContain("#### Thinking");
    expect(doc).toContain("I should use the write tool");
    expect(doc).toContain("#### Tool Call: write");
    expect(doc).toContain("/tmp/test.txt");
    expect(doc).toContain("#### Tool Result");
    expect(doc).toContain("Successfully wrote");
    expect(doc).toContain("#### Response");
    expect(doc).toContain("Done!");
  });

  it("returns empty string when no content", () => {
    expect(buildWorkflowDocument([])).toBe("");
  });
});

describe("buildSkillCandidatePayload", () => {
  it("returns null for empty messages", () => {
    expect(buildSkillCandidatePayload([])).toBeNull();
  });

  it("builds payload with name, description, body, files", () => {
    const messages: AgentMessage[] = [
      userMessage("Create a config file"),
      assistantToolCall("write", { path: "/tmp/config.json", content: "{}" }),
      toolResult("ok"),
      assistantText("Done"),
    ];

    const payload = buildSkillCandidatePayload(messages);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("skill");
    // noun "file" appears in nounMap before "config", so first match wins
    expect(payload!.name).toBe("create-file");
    expect(payload!.description).toContain("Create a config file");
    expect(payload!.body).toContain("# Learned Workflow");
    expect(payload!.body).toContain("## Procedure");
    expect(payload!.files).toHaveLength(1);
    const files = payload!.files ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe("references/source-summary.md");
  });
});

describe("extractWorkflowText", () => {
  it("concatenates assistant + toolResult text, ignores user", () => {
    const messages: AgentMessage[] = [
      userMessage("ignored"),
      assistantText("first"),
      toolResult("r1"),
      assistantText("second"),
    ];
    const text = extractWorkflowText(messages);
    expect(text).toContain("first");
    expect(text).toContain("r1");
    expect(text).toContain("second");
    expect(text).not.toContain("ignored");
  });
});
