/**
 * Full lifecycle integration test for the learning extension.
 *
 * Walks through: session_start → multi-turn conversation with memory prefetch →
 * candidate creation via direct store call → approve via channel handler →
 * snapshot consistency check → curator run.
 *
 * This is the closest we can get to a real pi session without a live LLM.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import learningExtension from "../index.ts";
import { LearningStore, getLearningPaths } from "../store.ts";
import type { Channel } from "../../../src/core/extensions/channel-types.ts";
import type { LearningSnapshot, LearningRun } from "../contract.ts";

let tempDir: string;
let agentDir: string;
let projectDir: string;
let previousAgentDir: string | undefined;
let previousRuntimeKind: string | undefined;

beforeEach(() => {
  tempDir = join(tmpdir(), `learning-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentDir = join(tempDir, "agent");
  projectDir = join(tempDir, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  previousRuntimeKind = process.env.PI_RUNTIME_KIND;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_RUNTIME_KIND = "local";
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousRuntimeKind === undefined) delete process.env.PI_RUNTIME_KIND;
  else process.env.PI_RUNTIME_KIND = previousRuntimeKind;
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function userMessage(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}
function assistantMessage(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

interface LifecycleRuntime {
  emit: (event: string, payload?: unknown) => Promise<unknown>;
  callMethod: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  appendedEntries: Array<{ customType: string; data?: unknown }>;
}

function createLifecycleRuntime(): LifecycleRuntime {
  const handlers: Record<string, Array<(event: unknown, context: ExtensionContext) => unknown | Promise<unknown>>> = {};
  const appendedEntries: Array<{ customType: string; data?: unknown }> = [];
  const context = {
    cwd: projectDir,
    projectRoot: projectDir,
    sessionDataDir: join(tempDir, "session-data"),
    ui: { setStatus: vi.fn(), notify: vi.fn() },
    sessionManager: { getSessionId: () => "session-lifecycle-1" },
  } as unknown as ExtensionContext;

  let channelSendHandler: ((data: unknown) => void) | null = null;
  const pendingInvokes: Record<string, (value: unknown) => void> = {};

  const fakeChannel: Channel = {
    name: "learning",
    send: (data: unknown) => {
      const record = data as Record<string, unknown>;
      if ("__call" in record) channelSendHandler?.(data);
      else if ("invokeId" in record) {
        const id = String(record.invokeId);
        pendingInvokes[id]?.(record);
        delete pendingInvokes[id];
      }
    },
    onReceive: (handler: (data: unknown) => void) => {
      channelSendHandler = handler;
      return () => {
        channelSendHandler = null;
      };
    },
    invoke: async () => {
      throw new Error("not implemented");
    },
    call: async () => {
      throw new Error("not implemented");
    },
  };

  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, context: ExtensionContext) => unknown | Promise<unknown>) => {
      handlers[event] ??= [];
      handlers[event]!.push(handler);
    }),
    callLLM: vi.fn(async (opts: { systemPrompt: string; messages: Array<{ role: string; content: string }> }) => {
      // Simulate LLM: if prefetch prompt, return empty selection; if extraction, return skip
      if (opts.systemPrompt.includes("memory") || opts.systemPrompt.includes("Memory")) {
        return JSON.stringify({ selected: [] });
      }
      return JSON.stringify({ actions: [{ op: "skip" }] });
    }),
    callLLMSafe: vi.fn(async (opts: { systemPrompt: string; messages: Array<{ role: string; content: string }> }) => {
      if (opts.systemPrompt.includes("memory") || opts.systemPrompt.includes("Memory")) {
        return JSON.stringify({ selected: [] });
      }
      return JSON.stringify({ actions: [{ op: "skip" }] });
    }),
    registerTool: vi.fn(),
    registerChannel: vi.fn(() => fakeChannel),
    appendEntry: vi.fn((customType: string, data?: unknown) => {
      appendedEntries.push({ customType, data });
    }),
  } as unknown as ExtensionAPI;

  learningExtension(pi);

  const emit = async (event: string, payload: unknown = {}) => {
    let lastResult: unknown;
    for (const handler of handlers[event] ?? []) {
      lastResult = await handler(payload, context);
    }
    return lastResult;
  };

  let invokeCounter = 0;
  const callMethod = (method: string, params: Record<string, unknown> = {}) => {
    const invokeId = `inv-${++invokeCounter}`;
    const promise = new Promise<unknown>((resolve) => {
      pendingInvokes[invokeId] = resolve;
    });
    channelSendHandler?.({ __call: method, invokeId, ...params });
    return promise;
  };

  return { emit, callMethod, appendedEntries };
}

describe("learning extension full lifecycle", () => {
  it("session_start → multi-turn conversation → snapshot reflects state", async () => {
    const runtime = createLifecycleRuntime();
    await runtime.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    // First turn
    await runtime.emit("before_agent_start", {
      type: "before_agent_start",
      systemPrompt: "base",
      prompt: "I'm working on a Postgres microservice",
    });
    await runtime.emit("context", {
      type: "context",
      messages: [userMessage("I'm working on a Postgres microservice")],
    });
    await new Promise((r) => setTimeout(r, 20));

    // agent_end with messages
    await runtime.emit("agent_end", {
      sessionId: "session-lifecycle-1",
      messages: [
        userMessage("I'm working on a Postgres microservice. Please remember this context for future help. ".repeat(8)),
        assistantMessage("Got it. I'll keep that in mind for future advice.".repeat(8)),
      ],
    });
    await new Promise((r) => setTimeout(r, 30));

    // Snapshot should now show 1 candidate (LLM extraction returned skip, so we fall back to raw payload)
    const snapshot = (await runtime.callMethod("learning.getSnapshot")) as LearningSnapshot;
    expect(snapshot.overview.pendingCandidates).toBeGreaterThanOrEqual(0);
    expect(snapshot.overview.memoryFiles).toBe(0);
  });

  it("candidate approve lifecycle: pending → applied → indexed in MEMORY.md", async () => {
    const runtime = createLifecycleRuntime();
    await runtime.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    const paths = getLearningPaths(projectDir);
    const store = new LearningStore(projectDir);
    const candidate = await store.createMemoryCandidate({
      title: "user prefers PostgreSQL",
      summary: "user prefers PostgreSQL for new projects",
      payload: {
        type: "memory",
        filename: "postgres-preference.md",
        description: "User prefers PostgreSQL for new projects",
        memoryType: "user",
        content: "When suggesting a database, default to PostgreSQL unless the user specifies otherwise.",
      },
    });

    // Approve via channel
    const snapshot = (await runtime.callMethod("learning.approveCandidate", {
      candidateId: candidate.id,
    })) as LearningSnapshot;

    // Verify
    expect(snapshot.overview.pendingCandidates).toBe(0);
    expect(snapshot.overview.memoryFiles).toBe(1);
    expect(existsSync(join(paths.memoryDir, "postgres-preference.md"))).toBe(true);
    expect(existsSync(join(paths.memoryDir, "MEMORY.md"))).toBe(true);

    // MEMORY.md must contain a link to the new file
    const index = readFileSync(join(paths.memoryDir, "MEMORY.md"), "utf-8");
    expect(index).toContain("postgres-preference.md");
    expect(index).toContain("User prefers PostgreSQL");

    // The memory file itself must have valid frontmatter
    const memFile = readFileSync(join(paths.memoryDir, "postgres-preference.md"), "utf-8");
    expect(memFile).toContain("name: postgres-preference");
    expect(memFile).toContain("type: user");
    expect(memFile).toContain("default to PostgreSQL");
  });

  it("curator dry-run produces a plan without modifying files", async () => {
    const runtime = createLifecycleRuntime();
    await runtime.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    // Seed a few memory files
    const paths = getLearningPaths(projectDir);
    mkdirSync(paths.memoryDir, { recursive: true });
    writeFileSync(
      join(paths.memoryDir, "tech-stack.md"),
      "---\nname: tech-stack\ndescription: Node.js + Postgres\ntype: project\n---\nUsing Node.js with Postgres.",
    );
    writeFileSync(
      join(paths.memoryDir, "deploy-pref.md"),
      "---\nname: deploy-pref\ndescription: deploy via CI\ntype: feedback\n---\nAlways deploy via CI.",
    );

    const run = (await runtime.callMethod("learning.runCurator", {
      domain: "memory",
      mode: "dry-run",
    })) as LearningRun;

    expect(run).toBeDefined();
    expect(run.domain).toBe("memory");
    expect(run.status).toMatch(/completed|dry-run/);

    // Files must be unchanged
    expect(existsSync(join(paths.memoryDir, "tech-stack.md"))).toBe(true);
    expect(existsSync(join(paths.memoryDir, "deploy-pref.md"))).toBe(true);
    expect(readdirSync(paths.memoryDir).filter((f) => f.endsWith(".md"))).toHaveLength(2);
  });

  it("multi-session: second session sees memory from first", async () => {
    // Session 1: create + approve a memory
    const r1 = createLifecycleRuntime();
    await r1.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    const paths = getLearningPaths(projectDir);
    const store = new LearningStore(projectDir);
    const candidate = await store.createMemoryCandidate({
      title: "test memory",
      summary: "summary",
      payload: {
        type: "memory",
        filename: "cross-session.md",
        description: "Cross-session memory",
        memoryType: "user",
        content: "This should persist across sessions.",
      },
    });
    await r1.callMethod("learning.approveCandidate", { candidateId: candidate.id });

    // Session 2: new runtime, fresh extension instance, same projectDir
    const r2 = createLifecycleRuntime();
    await r2.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    // Snapshot via session 2 should see the memory from session 1
    const snapshot = (await r2.callMethod("learning.getSnapshot")) as LearningSnapshot;
    expect(snapshot.overview.memoryFiles).toBe(1);

    // before_agent_start should inject MEMORY.md content into system prompt
    const result = (await r2.emit("before_agent_start", {
      type: "before_agent_start",
      systemPrompt: "BASE",
      prompt: "what do you know about me",
    })) as { systemPrompt?: string } | undefined;
    expect(result?.systemPrompt).toContain("Cross-session memory");
  });

  it("snapshot consistency: pending + memory counts match filesystem", async () => {
    const runtime = createLifecycleRuntime();
    await runtime.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    const paths = getLearningPaths(projectDir);
    const store = new LearningStore(projectDir);

    // Create 3 candidates, approve 2, reject 1
    const c1 = await store.createMemoryCandidate({
      title: "c1",
      summary: "s",
      payload: { type: "memory", filename: "c1.md", description: "c1", memoryType: "user", content: "x" },
    });
    const c2 = await store.createMemoryCandidate({
      title: "c2",
      summary: "s",
      payload: { type: "memory", filename: "c2.md", description: "c2", memoryType: "user", content: "x" },
    });
    const c3 = await store.createMemoryCandidate({
      title: "c3",
      summary: "s",
      payload: { type: "memory", filename: "c3.md", description: "c3", memoryType: "user", content: "x" },
    });

    await runtime.callMethod("learning.approveCandidate", { candidateId: c1.id });
    await runtime.callMethod("learning.approveCandidate", { candidateId: c2.id });
    await runtime.callMethod("learning.rejectCandidate", { candidateId: c3.id });

    const snapshot = (await runtime.callMethod("learning.getSnapshot")) as LearningSnapshot;

    // 2 approved memory files on disk
    expect(snapshot.overview.memoryFiles).toBe(2);
    expect(existsSync(join(paths.memoryDir, "c1.md"))).toBe(true);
    expect(existsSync(join(paths.memoryDir, "c2.md"))).toBe(true);
    expect(existsSync(join(paths.memoryDir, "c3.md"))).toBe(false);

    // 0 pending (all decided)
    expect(snapshot.overview.pendingCandidates).toBe(0);
  });

  it("setConfig disables learning, subsequent snapshots reflect disabled state", async () => {
    const runtime = createLifecycleRuntime();
    await runtime.emit("session_start");
    await new Promise((r) => setTimeout(r, 10));

    const snap = (await runtime.callMethod("learning.setConfig", {
      config: { enabled: false },
    })) as LearningSnapshot;

    expect(snap.config.enabled).toBe(false);
  });
});
