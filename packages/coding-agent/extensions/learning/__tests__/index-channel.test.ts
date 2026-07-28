import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  tempDir = join(tmpdir(), `learning-channel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function createMockPiWithChannel(projectRoot: string): {
  callMethod: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  emit: (event: string, payload?: unknown) => Promise<unknown>;
} {
  const handlers: Record<string, Array<(event: unknown, context: ExtensionContext) => unknown | Promise<unknown>>> = {};
  const context = {
    cwd: projectRoot,
    projectRoot,
    sessionDataDir: join(tempDir, "session-data"),
    ui: { setStatus: vi.fn(), notify: vi.fn() },
    sessionManager: { getSessionId: () => "session-1" },
  } as unknown as ExtensionContext;

  let channelSendHandler: ((data: unknown) => void) | null = null;
  const pendingInvokeResolvers: Record<string, (value: unknown) => void> = {};

  const fakeChannel: Channel = {
    name: "learning",
    send: (data: unknown) => {
      const record = data as Record<string, unknown>;
      if ("__call" in record) {
        channelSendHandler?.(data);
      } else if ("invokeId" in record) {
        const id = String(record.invokeId);
        pendingInvokeResolvers[id]?.(record);
        delete pendingInvokeResolvers[id];
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
    callLLM: vi.fn(async () => JSON.stringify({ selected: [] })),

    callLLMSafe: vi.fn(async () => JSON.stringify({ selected: [] })),
    registerTool: vi.fn(),
    registerChannel: vi.fn(() => fakeChannel),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  learningExtension(pi);

  // IMPORTANT: trigger session_start so the extension captures ctx
  void (async () => {
    for (const handler of handlers["session_start"] ?? []) {
      await handler({}, context);
    }
  })();

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
      pendingInvokeResolvers[invokeId] = resolve;
    });
    channelSendHandler?.({ __call: method, invokeId, ...params });
    return promise;
  };

  return { callMethod, emit };
}

describe("learning extension channel handlers", () => {
  it("learning.getSnapshot returns a valid snapshot", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    // Give session_start handler a tick to complete
    await new Promise((r) => setTimeout(r, 10));
    const snapshot = (await callMethod("learning.getSnapshot")) as LearningSnapshot;
    expect(snapshot.version).toBe(1);
    // resolveProjectIdentity uses realpath; compare via realpath to handle /var → /private/var on macOS
    expect(realpathSync(snapshot.projectRoot)).toBe(realpathSync(projectDir));
    expect(snapshot.overview.memoryFiles).toBe(0);
    expect(snapshot.overview.pendingCandidates).toBe(0);
  });

  it("learning.setConfig updates and returns snapshot", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    await new Promise((r) => setTimeout(r, 10));
    const snapshot = (await callMethod("learning.setConfig", {
      config: { enabled: false },
    })) as LearningSnapshot;
    expect(snapshot.config.enabled).toBe(false);
  });

  it("approveCandidate flow: pending → applied memory file", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    await new Promise((r) => setTimeout(r, 10));
    const paths = getLearningPaths(projectDir);
    const store = new LearningStore(projectDir);
    const candidate = await store.createMemoryCandidate({
      title: "test memory",
      summary: "summary",
      payload: {
        type: "memory",
        filename: "test.md",
        description: "desc",
        memoryType: "user",
        content: "test content",
      },
    });

    let snapshot = (await callMethod("learning.getSnapshot")) as LearningSnapshot;
    expect(snapshot.overview.pendingCandidates).toBe(1);

    snapshot = (await callMethod("learning.approveCandidate", {
      candidateId: candidate.id,
    })) as LearningSnapshot;
    expect(snapshot.overview.pendingCandidates).toBe(0);
    expect(snapshot.overview.memoryFiles).toBe(1);
    expect(existsSync(join(paths.memoryDir, "test.md"))).toBe(true);
  });

  it("rejectCandidate: pending → 0, no memory file created", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    await new Promise((r) => setTimeout(r, 10));
    const paths = getLearningPaths(projectDir);
    const store = new LearningStore(projectDir);
    const candidate = await store.createMemoryCandidate({
      title: "rejected",
      summary: "x",
      payload: {
        type: "memory",
        filename: "rejected.md",
        description: "r",
        memoryType: "user",
        content: "x",
      },
    });

    const snapshot = (await callMethod("learning.rejectCandidate", {
      candidateId: candidate.id,
    })) as LearningSnapshot;
    expect(snapshot.overview.pendingCandidates).toBe(0);
    expect(snapshot.overview.memoryFiles).toBe(0);
    expect(existsSync(join(paths.memoryDir, "rejected.md"))).toBe(false);
  });

  it("runCurator with domain=memory returns a LearningRun", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    await new Promise((r) => setTimeout(r, 10));
    const run = (await callMethod("learning.runCurator", {
      domain: "memory",
      mode: "dry-run",
    })) as LearningRun;
    expect(run).toBeDefined();
    expect(run.domain).toBe("memory");
    expect(run.type).toMatch(/curator/);
    expect(run.id).toBeTruthy();
  });

  it("listCandidates returns the pending candidates", async () => {
    const { callMethod } = createMockPiWithChannel(projectDir);
    await new Promise((r) => setTimeout(r, 10));
    const store = new LearningStore(projectDir);
    await store.createMemoryCandidate({
      title: "c1",
      summary: "s",
      payload: {
        type: "memory",
        filename: "c1.md",
        description: "d",
        memoryType: "user",
        content: "c",
      },
    });

    const result = (await callMethod("learning.listCandidates")) as { candidates: unknown[] };
    expect(result.candidates).toHaveLength(1);
  });
});
