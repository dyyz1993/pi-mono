import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import subagentV2Extension, { extractParentTodos } from "../../extensions/subagent-v2/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

const mockRpcClientInstances: Array<{
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  waitForIdle: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  steer: ReturnType<typeof vi.fn>;
  setActiveTools: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  getStderr: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@dyyz1993/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dyyz1993/pi-coding-agent")>();
  return {
    ...actual,
    discoverAgents: vi.fn((_cwd: string, _scope: string) => ({
      agents: [
        {
          name: "code",
          description: "Code agent",
          systemPrompt: "You are a coding assistant.",
          tools: ["read", "write", "bash"],
          source: "builtin",
          model: "claude-sonnet-4",
          filePath: "",
          mode: "subagent",
        },
        {
          name: "plan",
          description: "Plan agent",
          systemPrompt: "You plan things.",
          tools: ["read"],
          source: "builtin",
          model: "claude-sonnet-4",
          filePath: "",
          mode: "subagent",
        },
        {
          name: "project-helper",
          description: "Project local agent",
          systemPrompt: "Help with project tasks.",
          tools: ["read", "write"],
          source: "project",
          model: "claude-sonnet-4",
          filePath: "/project/.pi/agents/project-helper.md",
          mode: "subagent",
        },
      ],
      projectAgentsDir: "/project/.pi/agents",
    })),
  };
});

interface MockPi {
  pi: ExtensionAPI;
  handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  registeredTools: Map<string, unknown>;
  channelSend: ReturnType<typeof vi.fn>;
  appendEntries: Array<{ type: string; data: unknown }>;
}

function createMockPi(): MockPi {
  const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
  const registeredTools = new Map<string, unknown>();
  const channelSend = vi.fn();
  const appendEntries: Array<{ type: string; data: unknown }> = [];

  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    callLLM: vi.fn(async () => "mock title"),
    callLLMStructured: vi.fn(async () => ({})),
    forkAgent: vi.fn(async () => ({
      text: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    })),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    setStatus: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
    registerChannel: vi.fn(() => ({
      name: "subagent",
      send: channelSend,
      onReceive: vi.fn(() => () => {}),
      invoke: vi.fn(),
      emit: vi.fn(),
    })),
    registerTool: vi.fn((tool: { name: string }) => {
      registeredTools.set(tool.name, tool);
    }),
    appendEntry: vi.fn((type: string, data?: unknown) => {
      appendEntries.push({ type, data });
    }),
    sendUserMessage: vi.fn(),
    registerCommand: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    getSessionName: vi.fn(() => undefined),
    setSessionName: vi.fn(),
  } as unknown as ExtensionAPI;

  return { pi, handlers, registeredTools, channelSend, appendEntries };
}

function testCtx(overrides?: Record<string, unknown>) {
  return {
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "test-session-ext",
      getEntries: () => [],
    },
    hasUI: true,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    cwd: tmpdir(),
    model: { provider: "test-provider", id: "test-model" },
    ...overrides,
  };
}

describe("subagent-v2-extended", () => {
  let mock: MockPi;

  beforeEach(() => {
    mockRpcClientInstances.length = 0;
    mock = createMockPi();
    subagentV2Extension(mock.pi);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tool registration", () => {
    it("should register subagent tool with correct name", () => {
      expect(mock.registeredTools.has("subagent")).toBe(true);
    });

    it("should register subagent_resume tool with correct name", () => {
      expect(mock.registeredTools.has("subagent_resume")).toBe(true);
    });

    it("should register exactly 2 tools", () => {
      expect(mock.registeredTools.size).toBe(2);
    });
  });

  describe("subagent parameter schema", () => {
    it("should have required agent parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown>; required?: string[] };
      };
      expect(tool.parameters.properties.agent).toBeDefined();
      expect(tool.parameters.required).toContain("agent");
    });

    it("should have required task parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown>; required?: string[] };
      };
      expect(tool.parameters.properties.task).toBeDefined();
      expect(tool.parameters.required).toContain("task");
    });

    it("should have optional background parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.background).toBeDefined();
    });

    it("should have optional timeout parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.timeout).toBeDefined();
    });

    it("should have optional agentScope parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.agentScope).toBeDefined();
    });

    it("should have optional cwd parameter", () => {
      const tool = mock.registeredTools.get("subagent") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.cwd).toBeDefined();
    });
  });

  describe("subagent_resume parameter schema", () => {
    it("should have optional sessionId parameter", () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.sessionId).toBeDefined();
    });

    it("should have optional sessionPath parameter", () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.sessionPath).toBeDefined();
    });

    it("should have optional instruction parameter", () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        parameters: { properties: Record<string, unknown> };
      };
      expect(tool.parameters.properties.instruction).toBeDefined();
    });
  });

  describe("subagent tool description", () => {
    it("should have description mentioning subagent delegation", () => {
      const tool = mock.registeredTools.get("subagent") as {
        description: string;
      };
      expect(tool.description).toContain("subagent");
      expect(tool.description).toContain("Delegate");
    });

    it("should have label set to Subagent", () => {
      const tool = mock.registeredTools.get("subagent") as { label: string };
      expect(tool.label).toBe("Subagent");
    });
  });

  describe("channel registration", () => {
    it("should register subagent channel", () => {
      expect(mock.pi.registerChannel).toHaveBeenCalledWith("subagent");
    });

    it("should register coordinator_client channel", () => {
      expect(mock.pi.registerChannel).toHaveBeenCalledWith("coordinator_client");
    });
  });

  describe("error handling: unknown agent", () => {
    it("should return error content for unknown agent", async () => {
      const tool = mock.registeredTools.get("subagent") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const result = (await tool.execute(
        "tc_err",
        { agent: "unknown-agent", task: "do something" },
        undefined,
        undefined,
        testCtx(),
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toContain("Unknown agent");
      expect(result.content[0].text).toContain("unknown-agent");
    });

    it("should list available agents in error message", async () => {
      const tool = mock.registeredTools.get("subagent") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const result = (await tool.execute(
        "tc_avail",
        { agent: "missing", task: "do stuff" },
        undefined,
        undefined,
        testCtx(),
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("plan");
    });
  });

  describe("project agent confirmation", () => {
    it("should prompt for confirmation when using project agent with UI", async () => {
      const tool = mock.registeredTools.get("subagent") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const ctx = testCtx();
      const result = (await tool.execute(
        "tc_proj",
        { agent: "project-helper", task: "help me", agentScope: "both" },
        undefined,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Run project-local agent?",
        expect.stringContaining("project-helper"),
        expect.objectContaining({ timeout: 30_000 }),
      );
    });

    it("should skip confirmation when confirmProjectAgents is false", async () => {
      const tool = mock.registeredTools.get("subagent") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const ctx = testCtx();
      const result = (await tool.execute(
        "tc_noconfirm",
        { agent: "project-helper", task: "help me", agentScope: "both", confirmProjectAgents: false },
        undefined,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(ctx.ui.confirm).not.toHaveBeenCalledWith(
        "Run project-local agent?",
        expect.anything(),
      );
    });

    it("should cancel when user denies project agent", async () => {
      const tool = mock.registeredTools.get("subagent") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const ctx = testCtx({
        ui: {
          notify: vi.fn(),
          confirm: vi.fn(async () => false),
        },
      });

      const result = (await tool.execute(
        "tc_cancel",
        { agent: "project-helper", task: "help me", agentScope: "both" },
        undefined,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toContain("Canceled");
    });
  });

  describe("subagent_resume error handling", () => {
    it("should return error when neither sessionId nor sessionPath provided", async () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const result = (await tool.execute(
        "tc_resume_none",
        {},
        undefined,
        undefined,
        testCtx(),
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toContain("Either sessionId or sessionPath is required");
    });

    it("should return error when sessionId not found", async () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const result = (await tool.execute(
        "tc_resume_missing",
        { sessionId: "nonexistent-session-id" },
        undefined,
        undefined,
        testCtx(),
      )) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].text).toContain("Session file not found");
    });

    it("should accept sessionPath directly", async () => {
      const tool = mock.registeredTools.get("subagent_resume") as {
        execute: (
          id: string,
          params: unknown,
          signal: unknown,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<unknown>;
      };

      const result = (await tool.execute(
        "tc_resume_path",
        { sessionPath: "/tmp/some-session.jsonl", instruction: "continue" },
        undefined,
        undefined,
        testCtx(),
      )) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Resume failed");
    });
  });

  describe("renderCall", () => {
    const theme = {
      fg: (_c: string, t: string) => t,
      bold: (t: string) => t,
      dim: (t: string) => t,
      accent: (t: string) => t,
      muted: (t: string) => t,
      warning: (t: string) => t,
      toolTitle: (t: string) => t,
    };

    it("should render agent name and scope", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderCall(
        { agent: "code", task: "fix bug", agentScope: "user" },
        theme,
        {},
      );
      expect(result.text).toContain("subagent");
      expect(result.text).toContain("code");
      expect(result.text).toContain("[user]");
    });

    it("should truncate long task descriptions", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const longTask = "a".repeat(100);
      const result = tool.renderCall(
        { agent: "code", task: longTask },
        theme,
        {},
      );
      expect(result.text).toContain("...");
    });

    it("should handle missing agent gracefully", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderCall({}, theme, {});
      expect(result.text).toContain("...");
    });

    it("should default agentScope to user when not specified", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderCall(
        { agent: "plan", task: "plan something" },
        theme,
        {},
      );
      expect(result.text).toContain("[user]");
    });
  });

  describe("renderResult", () => {
    const theme = {
      fg: (_c: string, t: string) => t,
      bold: (t: string) => t,
      dim: (t: string) => t,
      accent: (t: string) => t,
      muted: (t: string) => t,
      error: (t: string) => t,
      toolTitle: (t: string) => t,
    };

    it("should render result with details", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderResult: (result: unknown, state: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "done" }],
          details: {
            agentScope: "user",
            result: { sessionId: "s1", status: "completed", exitCode: 0, finalText: "all done" },
          },
        },
        { expanded: false },
        theme,
        {},
      );
      expect(result.text).toContain("subagent result");
      expect(result.text).toContain("all done");
    });

    it("should render error exit code", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderResult: (result: unknown, state: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "failed" }],
          details: {
            agentScope: "user",
            result: { sessionId: "s2", status: "error", exitCode: 1, finalText: "error occurred" },
          },
        },
        { expanded: false },
        theme,
        {},
      );
      expect(result.text).toContain("[exit: 1]");
    });

    it("should render plain text when no details", () => {
      const tool = mock.registeredTools.get("subagent") as {
        renderResult: (result: unknown, state: unknown, theme: unknown, ctx: unknown) => { text: string };
      };

      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "simple output" }],
        },
        { expanded: false },
        theme,
        {},
      );
      expect(result.text).toContain("simple output");
    });
  });

  describe("extractParentTodos extended", () => {
    it("should extract todos with priority field", () => {
      const branch = [
        {
          type: "custom",
          customType: "todo",
          data: {
            todos: [
              { id: 1, text: "High priority", done: false, priority: "high" },
              { id: 2, text: "Low priority", done: false, priority: "low" },
            ],
            nextId: 3,
          },
        },
      ];

      const result = extractParentTodos(branch);
      expect(result).toEqual([
        { id: 1, text: "High priority", priority: "high", done: false },
        { id: 2, text: "Low priority", priority: "low", done: false },
      ]);
    });

    it("should filter done and deleted todos", () => {
      const branch = [
        {
          type: "custom",
          customType: "todo",
          data: {
            todos: [
              { id: 1, text: "Active", done: false },
              { id: 2, text: "Done", done: true },
              { id: 3, text: "Deleted", done: false, deleted: true },
            ],
            nextId: 4,
          },
        },
      ];

      const result = extractParentTodos(branch);
      expect(result).toEqual([
        { id: 1, text: "Active", priority: undefined, done: false },
      ]);
    });

    it("should handle empty branch", () => {
      expect(extractParentTodos([])).toEqual([]);
    });

    it("should handle non-object entries gracefully", () => {
      const branch = [{ type: "message", message: { role: "user" } }];
      expect(() => extractParentTodos(branch)).not.toThrow();
      expect(extractParentTodos(branch)).toEqual([]);
    });

    it("should override earlier todos with later ones", () => {
      const branch = [
        {
          type: "custom",
          customType: "todo",
          data: {
            todos: [{ id: 1, text: "First version", done: false }],
            nextId: 2,
          },
        },
        {
          type: "custom",
          customType: "todo",
          data: {
            todos: [{ id: 1, text: "Updated version", done: false }],
            nextId: 2,
          },
        },
      ];

      const result = extractParentTodos(branch);
      expect(result).toEqual([
        { id: 1, text: "Updated version", priority: undefined, done: false },
      ]);
    });

    it("should extract from tool result entries", () => {
      const branch = [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "todo",
            details: {
              todos: [{ id: 1, text: "From tool", done: false }],
              nextId: 2,
            },
          },
        },
      ];

      const result = extractParentTodos(branch);
      expect(result).toEqual([
        { id: 1, text: "From tool", priority: undefined, done: false },
      ]);
    });

    it("should skip non-todo tool results", () => {
      const branch = [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "bash",
            details: { output: "some output" },
          },
        },
      ];

      expect(extractParentTodos(branch)).toEqual([]);
    });

    it("should skip non-toolResult messages", () => {
      const branch = [
        {
          type: "message",
          message: {
            role: "assistant",
            content: "I will help you",
          },
        },
      ];

      expect(extractParentTodos(branch)).toEqual([]);
    });
  });
});
