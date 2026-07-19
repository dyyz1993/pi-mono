import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import {
  buildSkillCandidatePayload,
  buildWorkflowDocument,
  deriveSkillName,
  extractWorkflowText,
  maybeDistillSkill,
  parseDistillResponse,
  shouldDistill,
} from "../skill-provider.ts";
import { LearningStore } from "../store.ts";

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


describe("parseDistillResponse", () => {
  it("parses valid response with name, description, body", () => {
    const response = JSON.stringify({
      name: "create-file",
      description: "Create a file with given content",
      body: "# Skill: create-file\n\n## Procedure\n1. ...",
      shouldSkip: false,
    });
    const result = parseDistillResponse(response);
    expect(result).toEqual({
      skipped: false,
      name: "create-file",
      description: "Create a file with given content",
      body: "# Skill: create-file\n\n## Procedure\n1. ...",
    });
  });

  it("returns {skipped:true} when shouldSkip is true", () => {
    const response = JSON.stringify({ shouldSkip: true });
    expect(parseDistillResponse(response)).toEqual({ skipped: true });
  });

  it("returns null when name or body is missing", () => {
    expect(parseDistillResponse(JSON.stringify({ name: "x" }))).toBeNull();
    expect(parseDistillResponse(JSON.stringify({ body: "y" }))).toBeNull();
    expect(parseDistillResponse(JSON.stringify({}))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseDistillResponse("not json")).toBeNull();
    expect(parseDistillResponse("")).toBeNull();
  });

  it("strips markdown code fences before parsing", () => {
    const response = "```json\n" + JSON.stringify({
      name: "test",
      description: "d",
      body: "b",
    }) + "\n```";
    const result = parseDistillResponse(response);
    expect(result && !result.skipped ? result.name : null).toBe("test");
  });
});

describe("maybeDistillSkill with LLM", () => {
  let tempDir: string;
  let store: LearningStore;
  let previousAgentDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skill-distill-"));
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tempDir, "agent");
    store = new LearningStore(projectDir);
  });

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  function writeOpMessages(): AgentMessage[] {
    return [
      { role: "user", content: [{ type: "text", text: "创建 hello.txt 文件 内容 Hello" }], timestamp: Date.now() },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should use the write tool" },
          { type: "toolCall", name: "write", arguments: { path: "hello.txt", content: "Hello" } },
        ],
        timestamp: Date.now(),
      } as AgentMessage,
      { role: "toolResult", content: [{ type: "text", text: "Created hello.txt" }], timestamp: Date.now() } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "Done. Created hello.txt" }],
        timestamp: Date.now(),
      } as AgentMessage,
    ];
  }

  it("uses LLM to refine skill content when callLLM provided", async () => {
    const callLLM = vi.fn(async () => JSON.stringify({
      name: "create-text-file",
      description: "Create a text file with specified content",
      body: "# Skill: create-text-file\n\n## When to use\nWhen you need to create a file.\n\n## Procedure\n1. Use write tool\n2. Verify",
      shouldSkip: false,
    }));
    await store.setConfig({
      version: 1,
      enabled: true,
      memory: { recallEnabled: true, extractMode: "off", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
      skills: { distillMode: "pending", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
    });
    await maybeDistillSkill({
      store,
      messages: writeOpMessages(),
      callLLM: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],

      callLLMSafe: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],
    });
    expect(callLLM).toHaveBeenCalledTimes(1);
    const snapshot = await store.getSnapshot();
    expect(snapshot.candidates).toHaveLength(1);
    const candidate = snapshot.candidates[0]!;
    expect(candidate.payload.name).toBe("create-text-file");
    expect(candidate.payload.description).toBe("Create a text file with specified content");
    expect(candidate.payload.body).toContain("# Skill: create-text-file");
    expect(candidate.payload.body).not.toContain("I should use the write tool"); // thinking stripped
  });

  it("skips candidate when LLM returns shouldSkip=true", async () => {
    const callLLM = vi.fn(async () => JSON.stringify({ shouldSkip: true }));
    await store.setConfig({
      version: 1,
      enabled: true,
      memory: { recallEnabled: true, extractMode: "off", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
      skills: { distillMode: "pending", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
    });
    await maybeDistillSkill({
      store,
      messages: writeOpMessages(),
      callLLM: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],

      callLLMSafe: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.candidates).toHaveLength(0);
  });

  it("falls back to raw payload when LLM throws", async () => {
    const callLLM = vi.fn(async () => { throw new Error("stale ctx"); });
    await store.setConfig({
      version: 1,
      enabled: true,
      memory: { recallEnabled: true, extractMode: "off", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
      skills: { distillMode: "pending", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
    });
    await maybeDistillSkill({
      store,
      messages: writeOpMessages(),
      callLLM: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],

      callLLMSafe: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.candidates).toHaveLength(1);
    // Fallback: raw payload with original name from deriveSkillName
    expect(snapshot.candidates[0]!.payload.name).toBe("create-file");
  });

  it("falls back to raw payload when LLM returns invalid JSON", async () => {
    const callLLM = vi.fn(async () => "not json at all");
    await store.setConfig({
      version: 1,
      enabled: true,
      memory: { recallEnabled: true, extractMode: "off", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
      skills: { distillMode: "pending", curatorMode: "dry-run", curatorSchedule: { enabled: false, intervalMinutes: 1440 } },
    });
    await maybeDistillSkill({
      store,
      messages: writeOpMessages(),
      callLLM: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],

      callLLMSafe: callLLM as unknown as Parameters<typeof maybeDistillSkill>[0]["callLLM"],
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]!.payload.name).toBe("create-file");
  });
});
describe("SKILL_SYSTEM_PROMPT", () => {
  it("returns empty string for empty skill list", async () => {
    const { SKILL_SYSTEM_PROMPT } = await import("../prompts.ts");
    expect(SKILL_SYSTEM_PROMPT([])).toBe("");
  });

  it("includes skill name, description, and body", async () => {
    const { SKILL_SYSTEM_PROMPT } = await import("../prompts.ts");
    const result = SKILL_SYSTEM_PROMPT([
      {
        name: "create-file",
        description: "Create a file with content",
        body: "# Skill: create-file\n\n## Procedure\n1. Use write tool",
      },
    ]);
    expect(result).toContain("# learning skills");
    expect(result).toContain("create-file");
    expect(result).toContain("Create a file with content");
    expect(result).toContain("## Procedure");
    expect(result).toContain("Use write tool");
  });

  it("truncates long skill bodies", async () => {
    const { SKILL_SYSTEM_PROMPT } = await import("../prompts.ts");
    const longBody = "x".repeat(2000);
    const result = SKILL_SYSTEM_PROMPT(
      [{ name: "big", description: "d", body: longBody }],
      100,
    );
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(longBody.length + 500);
  });

  it("limits to maxSkills", async () => {
    const { SKILL_SYSTEM_PROMPT } = await import("../prompts.ts");
    const skills = Array.from({ length: 12 }, (_, i) => ({
      name: `skill-${i}`,
      description: `desc-${i}`,
      body: `body-${i}`,
    }));
    const result = SKILL_SYSTEM_PROMPT(skills, 1500, 5);
    expect(result).toContain("skill-0");
    expect(result).toContain("skill-4");
    expect(result).not.toContain("skill-5");
    expect(result).not.toContain("skill-11");
  });
});
