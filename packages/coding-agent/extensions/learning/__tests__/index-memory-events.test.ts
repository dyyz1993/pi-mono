import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import learningExtension from "../index.ts";
import { LearningStore } from "../store.ts";

let tempDir: string;
let agentDir: string;
let projectDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tempDir = join(tmpdir(), `learning-index-events-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentDir = join(tempDir, "agent");
  projectDir = join(tempDir, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function createMockPi() {
  const handlers: Record<string, ((event: unknown, context: ExtensionContext) => unknown | Promise<unknown>)[]> = {};
  const appendedEntries: Array<{ customType: string; data?: unknown }> = [];
  const registeredTools: unknown[] = [];
  const context = {
    cwd: projectDir,
    projectRoot: projectDir,
    sessionDataDir: join(tempDir, "session-data"),
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
    },
    sessionManager: {
      getSessionId: () => "session-1",
    },
  } as unknown as ExtensionContext;

  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, context: ExtensionContext) => unknown | Promise<unknown>) => {
      handlers[event] ??= [];
      handlers[event]!.push(handler);
    }),
    callLLM: vi.fn(async () => JSON.stringify({ selected: [] })),
    registerTool: vi.fn((tool: unknown) => {
      registeredTools.push(tool);
    }),
    registerChannel: vi.fn(() => {
      throw new Error("channel unavailable in test");
    }),
    appendEntry: vi.fn((customType: string, data?: unknown) => {
      appendedEntries.push({ customType, data });
    }),
  } as unknown as ExtensionAPI;

  const emit = async (event: string, payload: unknown = {}) => {
    let result: unknown;
    for (const handler of handlers[event] ?? []) {
      result = await handler(payload, context);
    }
    return result;
  };

  learningExtension(pi);
  return { emit, appendedEntries, registeredTools };
}

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

async function seedMemoryFile(): Promise<void> {
  const store = new LearningStore(projectDir);
  mkdirSync(store.paths.memoryDir, { recursive: true });
  writeFileSync(
    join(store.paths.memoryDir, "remote-preference.md"),
    "---\nname: Remote Preference\ndescription: SSH preference\ntype: feedback\n---\nConfirm hostname and pwd before remote actions.\n",
    "utf-8",
  );
}

describe("learning extension memory event compatibility", () => {
  it("emits renderable memory_* custom entries in prefetch-result-inject order", async () => {
    await seedMemoryFile();
    const runtime = createMockPi();

    await runtime.emit("session_start");
    await runtime.emit("before_agent_start", {
      type: "before_agent_start",
      systemPrompt: "base",
      prompt: "remote ssh preference",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = (await runtime.emit("context", {
      type: "context",
      messages: [userMessage("remote ssh preference")],
    })) as { messages?: AgentMessage[] } | undefined;

    expect(result?.messages).toHaveLength(2);
    expect(runtime.appendedEntries.map((entry) => entry.customType)).toEqual([
      "memory_prefetch",
      "memory_prefetch_result",
      "memory_inject",
    ]);
    const [prefetch, prefetchResult, inject] = runtime.appendedEntries.map((entry) => entry.data as Record<string, unknown>);
    expect(prefetch.operationId).toBe(prefetchResult.operationId);
    expect(prefetchResult.operationId).toBe(inject.operationId);
    expect(prefetch.phaseOrder).toBe(1);
    expect(prefetchResult.phaseOrder).toBe(2);
    expect(inject.phaseOrder).toBe(3);
    expect(inject.source).toBe("learning");
  });

  it("recognizes existing array-content memory context and skips duplicate injection", async () => {
    await seedMemoryFile();
    const firstRuntime = createMockPi();

    await firstRuntime.emit("session_start");
    await firstRuntime.emit("before_agent_start", {
      type: "before_agent_start",
      systemPrompt: "base",
      prompt: "remote ssh preference",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const first = (await firstRuntime.emit("context", {
      type: "context",
      messages: [userMessage("remote ssh preference")],
    })) as { messages?: AgentMessage[] } | undefined;
    expect(first?.messages).toHaveLength(2);

    const secondRuntime = createMockPi();
    await secondRuntime.emit("session_start");
    await secondRuntime.emit("before_agent_start", {
      type: "before_agent_start",
      systemPrompt: "base",
      prompt: "remote ssh preference again",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await secondRuntime.emit("context", {
      type: "context",
      messages: [...(first!.messages ?? []), userMessage("remote ssh preference again")],
    });

    expect(second).toBeUndefined();
    const injectEntries = secondRuntime.appendedEntries.filter((entry) => entry.customType === "memory_inject");
    expect(injectEntries).toHaveLength(1);
    expect(injectEntries[0]!.data).toMatchObject({
      skipped: true,
      alreadyInjected: true,
      skipReason: "already_in_context",
      injectedBytes: 0,
      source: "learning",
    });
  });
});
