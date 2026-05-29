import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fileTimeGuardExtension from "../../extensions/file-time-guard/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(async (filePath: string) => {
    if (filePath.includes("nonexistent")) {
      throw new Error("ENOENT");
    }
    return {
      mtimeMs: 1000,
      ctimeMs: 1000,
      size: 100,
    };
  }),
}));

let sessionIdCounter = 0;

interface MockPi {
  pi: ExtensionAPI;
  handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  registeredCommands: Map<string, unknown>;
  flags: Record<string, boolean | string>;
  currentSessionId: string;
}

function createMockPi(): MockPi {
  sessionIdCounter++;
  const currentSessionId = `ext-ftg-${sessionIdCounter}`;
  const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
  const registeredCommands = new Map<string, unknown>();
  const flags: Record<string, boolean | string> = {
    "disable-file-time-check": false,
    "file-time-check-mode": "block",
  };

  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    callLLM: vi.fn(async () => "mock"),
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
      name: "file-time-guard",
      send: vi.fn(),
      onReceive: vi.fn(() => () => {}),
      invoke: vi.fn(),
    })),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
    registerCommand: vi.fn((name: string, cmd: unknown) => {
      registeredCommands.set(name, cmd);
    }),
    registerFlag: vi.fn(),
    getFlag: vi.fn((name: string) => flags[name]),
  } as unknown as ExtensionAPI;

  return { pi, handlers, registeredCommands, flags, currentSessionId };
}

function testCtx(sessionId: string, overrides?: Record<string, unknown>) {
  return {
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => sessionId,
      getEntries: () => [],
    },
    hasUI: true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    cwd: tmpdir(),
    ...overrides,
  };
}

async function fireEvent(
  mock: MockPi,
  event: string,
  data: unknown,
  ctxOverrides?: Partial<ReturnType<typeof testCtx>>,
): Promise<unknown> {
  const baseCtx = testCtx(mock.currentSessionId);
  const mergedCtx = ctxOverrides ? { ...baseCtx, ...ctxOverrides } : baseCtx;
  let result: unknown;
  for (const h of mock.handlers[event] ?? []) {
    result = await h(data, mergedCtx);
  }
  return result;
}

describe("file-time-guard-extended", () => {
  let mock: MockPi;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockPi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("block mode: read-then-write flow", () => {
    it("should allow write after reading the same file", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/app.ts" },
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/app.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
    });

    it("should block write before read in block mode", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/new.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件未读取过" });
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("文件未读取过"),
        "error",
      );
    });
  });

  describe("block mode: external modification detection", () => {
    it("should block write when file was externally modified", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/changed.ts" },
      });

      const { stat } = await import("node:fs/promises");
      (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mtimeMs: 9999,
        ctimeMs: 9999,
        size: 200,
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/changed.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件已被外部修改" });
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("外部修改"),
        "error",
      );
    });

    it("should block write when only mtime changed", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/mtime-only.ts" },
      });

      const { stat } = await import("node:fs/promises");
      (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mtimeMs: 5000,
        ctimeMs: 1000,
        size: 100,
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/mtime-only.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件已被外部修改" });
    });

    it("should block write when only size changed", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/size-only.ts" },
      });

      const { stat } = await import("node:fs/promises");
      (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mtimeMs: 1000,
        ctimeMs: 1000,
        size: 999,
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/size-only.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件已被外部修改" });
    });
  });

  describe("warn mode", () => {
    it("should NOT block write before read in warn mode", async () => {
      mock.flags["file-time-check-mode"] = "warn";
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/unread.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("文件未读取过"),
        "warning",
      );
    });

    it("should NOT block write when externally modified in warn mode", async () => {
      mock.flags["file-time-check-mode"] = "warn";
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/warn-mod.ts" },
      });

      const { stat } = await import("node:fs/promises");
      (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mtimeMs: 8888,
        ctimeMs: 8888,
        size: 500,
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/warn-mod.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("外部修改"),
        "warning",
      );
    });
  });

  describe("ignore mode", () => {
    it("should NOT block write before read in ignore mode", async () => {
      mock.flags["file-time-check-mode"] = "ignore";
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/ignore.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });

    it("should NOT block write after external modification in ignore mode", async () => {
      mock.flags["file-time-check-mode"] = "ignore";
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/ignore-ext.ts" },
      });

      const { stat } = await import("node:fs/promises");
      (stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        mtimeMs: 9999,
        ctimeMs: 9999,
        size: 500,
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/ignore-ext.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
  });

  describe("session isolation", () => {
    it("should isolate file records between sessions", async () => {
      const mockA = createMockPi();
      const mockB = createMockPi();

      fileTimeGuardExtension(mockA.pi);
      fileTimeGuardExtension(mockB.pi);

      await fireEvent(mockA, "session_start", {});
      await fireEvent(mockB, "session_start", {});

      await fireEvent(mockA, "tool_call", {
        toolName: "read",
        input: { path: "shared.ts" },
      });

      const ctxB = testCtx(mockB.currentSessionId);
      const resultB = await fireEvent(
        mockB,
        "tool_call",
        { toolName: "write", input: { path: "shared.ts" } },
        { ui: ctxB.ui },
      );
      expect(resultB).toEqual({ block: true, reason: "文件未读取过" });

      const ctxA = testCtx(mockA.currentSessionId);
      const resultA = await fireEvent(
        mockA,
        "tool_call",
        { toolName: "write", input: { path: "shared.ts" } },
        { ui: ctxA.ui },
      );
      expect(resultA).toBeUndefined();
    });
  });

  describe("ignore patterns", () => {
    it("should skip files matching ignore patterns", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "dist/bundle.js" },
      });

      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "dist/bundle.js" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
    });
  });

  describe("multiple files tracking", () => {
    it("should track multiple files independently", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/a.ts" },
      });
      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/b.ts" },
      });

      const ctx = testCtx(mock.currentSessionId);

      const resultA = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/a.ts" } },
        { ui: ctx.ui },
      );
      expect(resultA).toBeUndefined();

      const resultC = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/c.ts" } },
        { ui: ctx.ui },
      );
      expect(resultC).toEqual({ block: true, reason: "文件未读取过" });
    });

    it("should allow writing file B after reading only file A if writing file A", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/only-a.ts" },
      });

      const ctx = testCtx(mock.currentSessionId);

      const resultA = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/only-a.ts" } },
        { ui: ctx.ui },
      );
      expect(resultA).toBeUndefined();

      const resultB = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/only-b.ts" } },
        { ui: ctx.ui },
      );
      expect(resultB).toEqual({ block: true, reason: "文件未读取过" });
    });
  });

  describe("nonexistent file handling", () => {
    it("should not crash when reading a nonexistent file", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const result = await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "nonexistent/file.ts" },
      });
      expect(result).toBeUndefined();
    });

    it("should block write to unread file even if it does not exist on disk", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "nonexistent/new-file.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件未读取过" });
    });
  });

  describe("edit tool tracking", () => {
    it("should track reads and allow subsequent edits", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/editable.ts" },
      });

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/editable.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
    });

    it("should block edit before read in block mode", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "edit", input: { path: "src/no-read-edit.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toEqual({ block: true, reason: "文件未读取过" });
    });
  });

  describe("session lifecycle", () => {
    it("should not track files before session_start", async () => {
      const freshMock = createMockPi();
      fileTimeGuardExtension(freshMock.pi);

      const ctx = testCtx(freshMock.currentSessionId);
      const result = await fireEvent(
        freshMock,
        "tool_call",
        { toolName: "write", input: { path: "src/no-session.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
    });

    it("should not track after session_shutdown", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/before-shutdown.ts" },
      });

      await fireEvent(mock, "session_shutdown", {});

      const ctx = testCtx(mock.currentSessionId);
      const result = await fireEvent(
        mock,
        "tool_call",
        { toolName: "write", input: { path: "src/before-shutdown.ts" } },
        { ui: ctx.ui },
      );
      expect(result).toBeUndefined();
    });
  });

  describe("tool_call for non-file tools", () => {
    it("should ignore non-read/write/edit tool calls", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const result = await fireEvent(mock, "tool_call", {
        toolName: "bash",
        input: { command: "ls" },
      });
      expect(result).toBeUndefined();
    });

    it("should ignore glob tool calls", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const result = await fireEvent(mock, "tool_call", {
        toolName: "glob",
        input: { pattern: "**/*.ts" },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("file-time-status command", () => {
    it("should show tracking status with tracked files", async () => {
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      await fireEvent(mock, "tool_call", {
        toolName: "read",
        input: { path: "src/tracked.ts" },
      });

      const cmd = mock.registeredCommands.get("file-time-status") as {
        handler: (args: unknown, ctx: unknown) => Promise<void>;
      };

      const ctx = testCtx(mock.currentSessionId);
      await cmd.handler({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("已追踪文件: 1"),
        "info",
      );
    });

    it("should show disabled status when flag is set", async () => {
      mock.flags["disable-file-time-check"] = true;
      fileTimeGuardExtension(mock.pi);
      await fireEvent(mock, "session_start", {});

      const cmd = mock.registeredCommands.get("file-time-status") as {
        handler: (args: unknown, ctx: unknown) => Promise<void>;
      };

      const ctx = testCtx(mock.currentSessionId);
      await cmd.handler({}, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("文件"),
        "info",
      );
    });
  });
});
