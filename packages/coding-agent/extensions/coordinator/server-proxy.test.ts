/**
 * TDD tests for coordinator serverProxy validation bugs.
 *
 * BUG-1: delegate_status returns "stopped" when handler returns { task: null }
 *         for a non-existent session. Expected: "not_found".
 *
 * BUG-2: delegate_fork returns { __error: "..." } from handler, but serverProxy
 *         passes it through without checking, so tool execute sees
 *         { sessionId: undefined }. Expected: throw error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──
vi.mock("console", () => ({
  ...vi.importActual("console"),
  // silence debug logs from serverProxy catch blocks
}));

import { createServerProxy } from "./server-proxy.ts";
import type { ProcessManagerApi } from "./handler.ts";

// ── Mock client that simulates typed channel client.call() ──
function createMockClient() {
  const callMap = new Map<string, (...args: unknown[]) => unknown>();

  return {
    call: vi.fn((method: string, _params: Record<string, unknown>) => {
      const handler = callMap.get(method);
      if (handler) return handler();
      return {};
    }),
    on: vi.fn(() => vi.fn()),
    /** Register a mock handler for a specific method */
    mockCall(method: string, handler: () => unknown) {
      callMap.set(method, handler);
    },
  };
}

// Minimal type for the client parameter — serverProxy only uses .call()
type MockClient = ReturnType<typeof createMockClient>;

describe("serverProxy delegate_status — non-existent sessionId", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns 'not_found' when handler returns { task: null, status: 'not_found' } (BUG-1)", async () => {
    // After handler fix: handler forwards status from process-manager
    client.mockCall("session_delegate_status", () => ({
      task: null,
      status: "not_found",
    }));

    const result = await proxy.delegate_status(
      "sess_ghost_never_existed_99999"
    );
    expect(result.status).toBe("not_found");
  });

  it("returns real status when handler returns a valid task", async () => {
    client.mockCall("session_delegate_status", () => ({
      task: {
        sessionId: "sess_real",
        title: "Real task",
        task: "do work",
        projectPath: "/fake",
        dispatchedAt: Date.now(),
        status: "streaming",
      },
    }));

    const result = await proxy.delegate_status("sess_real");
    expect(result.status).toBe("streaming");
  });

  it("preserves rich status detail returned by the handler", async () => {
    client.mockCall("session_delegate_status", () => ({
      task: {
        sessionId: "sess_detail",
        title: "Detail",
        task: "task",
        projectPath: "/tmp",
        dispatchedAt: 100,
        status: "streaming",
      },
      detail: {
        phase: "执行中",
        waitingType: "streaming",
        waitingSince: 123,
        lastMessages: ["助手: 正在执行 bash"],
      },
    }));

    const result = await proxy.delegate_status("sess_detail");

    expect(result.status).toBe("streaming");
    expect(result.detail).toMatchObject({
      phase: "执行中",
      waitingType: "streaming",
      lastMessages: ["助手: 正在执行 bash"],
    });
  });

  it("returns 'stopped' when handler returns { task: null } with status 'stopped' (real stopped session)", async () => {
    // After fix: handler forwards the status field from process-manager
    // which returns { status: "stopped", task: null } for a real stopped session
    client.mockCall("session_delegate_status", () => ({
      task: null,
      status: "stopped",
    }));

    const result = await proxy.delegate_status("sess_was_real_but_stopped");
    expect(result.status).toBe("stopped");
  });

  it("fallback to 'stopped' when handler returns { task: null } without status (old handler compat)", async () => {
    // Old handler (pre-fix) returns { task: null } without status field
    client.mockCall("session_delegate_status", () => ({ task: null }));

    const result = await proxy.delegate_status("sess_old_handler");
    expect(result.status).toBe("stopped");
  });
});

describe("serverProxy delegate_fork — non-existent target sessionId", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("throws when response contains { error: '...' }", async () => {
    // pi-agent-chat dispatch catch returns { error: "..." }, handler.ts also uses { error: "..." }
    client.mockCall("session_delegate_fork", () => ({
      error: "Session not found: sess_ghost_fork_99999",
    }));

    await expect(
      proxy.delegate_fork(
        "sess_ghost_fork_99999",
        "do something",
        "title",
        "/fake"
      )
    ).rejects.toThrow(/not found/i);
  });

  it("returns success when handler returns a valid result", async () => {
    client.mockCall("session_delegate_fork", () => ({
      sessionId: "sess_fork_123",
      status: "started",
    }));

    const result = await proxy.delegate_fork(
      "sess_real",
      "do something",
      "title",
      "/fake"
    );
    expect(result.sessionId).toBe("sess_fork_123");
    expect(result.status).toBe("started");
  });
});

describe("serverProxy delegate", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns result from client.call('session_delegate', ...)", async () => {
    client.mockCall("session_delegate", () => ({
      sessionId: "sess-del-1",
      status: "started",
    }));

    const result = await proxy.delegate("build the project", "/project");
    expect(result.sessionId).toBe("sess-del-1");
    expect(result.status).toBe("started");
  });

  it("passes task and projectPath to client.call", async () => {
    client.mockCall("session_delegate", () => ({
      sessionId: "sess-del-2",
      status: "started",
    }));

    await proxy.delegate("run tests", "/tmp/project");

    expect(client.call).toHaveBeenCalledWith("session_delegate", {
      task: "run tests",
      projectPath: "/tmp/project",
      replyMode: undefined,
      agent: undefined,
      model: undefined,
      timeoutMs: undefined,
    });
  });

  it("passes replyMode to client.call", async () => {
    client.mockCall("session_delegate", () => ({
      sessionId: "sess-del-3",
      status: "started",
    }));

    await proxy.delegate("run tests", "/tmp/project", "interrupt");

    expect(client.call).toHaveBeenCalledWith("session_delegate", {
      task: "run tests",
      projectPath: "/tmp/project",
      replyMode: "interrupt",
      agent: undefined,
      model: undefined,
      timeoutMs: undefined,
    });
  });

  it("passes agent, model, and timeoutMs to client.call", async () => {
    client.mockCall("session_delegate", () => ({
      sessionId: "sess-del-4",
      status: "started",
    }));

    await proxy.delegate("run tests", "/tmp/project", "followUp", "frontend-dev", "openai/gpt-4.1", 1234);

    expect(client.call).toHaveBeenCalledWith("session_delegate", {
      task: "run tests",
      projectPath: "/tmp/project",
      replyMode: "followUp",
      agent: "frontend-dev",
      model: "openai/gpt-4.1",
      timeoutMs: 1234,
    });
  });
});

describe("serverProxy delegate_send", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns result from client.call('session_delegate_send', ...)", async () => {
    client.mockCall("session_delegate_send", () => ({
      delivered: true,
      targetStatus: "active",
    }));

    const result = await proxy.delegate_send("from-1", "to-2", "hello");
    expect(result.delivered).toBe(true);
    expect(result.targetStatus).toBe("active");
  });

  it("passes mode to client.call('session_delegate_send', ...)", async () => {
    client.mockCall("session_delegate_send", () => ({
      delivered: true,
      targetStatus: "active",
    }));

    await proxy.delegate_send("from-1", "to-2", "hello", "steer");

    expect(client.call).toHaveBeenCalledWith("session_delegate_send", {
      targetSessionId: "to-2",
      message: "hello",
      mode: "steer",
    });
  });

  it("returns empty array on error", async () => {
    // delegate_send doesn't have a try/catch in serverProxy, so we test the
    // general error path: if client.call throws, it propagates.
    // However, the return type is not an array — let's verify it throws.
    client.mockCall("session_delegate_send", () => {
      throw new Error("channel error");
    });

    await expect(
      proxy.delegate_send("from-1", "to-2", "hello")
    ).rejects.toThrow("channel error");
  });
});

describe("serverProxy delegate_list", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns tasks from client.call('session_delegate_list', ...)", async () => {
    const tasks = [
      { sessionId: "s1", status: "idle" as const, projectPath: "/p1" },
      { sessionId: "s2", status: "streaming" as const, projectPath: "/p2" },
    ];
    client.mockCall("session_delegate_list", () => ({ tasks }));

    const result = await proxy.delegate_list();
    expect(result).toHaveLength(2);
    expect(result[0].sessionId).toBe("s1");
    expect(result[1].status).toBe("streaming");
  });

  it("returns empty array on error", async () => {
    client.mockCall("session_delegate_list", () => {
      throw new Error("network failure");
    });

    const result = await proxy.delegate_list();
    expect(result).toEqual([]);
  });
});

describe("serverProxy delegate_stop", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns ok from client.call('session_delegate_stop', ...)", async () => {
    client.mockCall("session_delegate_stop", () => ({ ok: true }));

    const result = await proxy.delegate_stop("sess-stop-1");
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    client.mockCall("session_delegate_stop", () => {
      throw new Error("stop failed");
    });

    const result = await proxy.delegate_stop("sess-stop-missing");
    expect(result).toBe(false);
  });
});

describe("serverProxy delegate_remove", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns ok from client.call('session_delegate_remove', ...)", async () => {
    client.mockCall("session_delegate_remove", () => ({ ok: true }));

    const result = await proxy.delegate_remove("sess-rm-1");
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    client.mockCall("session_delegate_remove", () => {
      throw new Error("remove failed");
    });

    const result = await proxy.delegate_remove("sess-rm-missing");
    expect(result).toBe(false);
  });
});

describe("serverProxy delegate_clear_stopped", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns removed count from client.call('session_delegate_clear_stopped', ...)", async () => {
    client.mockCall("session_delegate_clear_stopped", () => ({ removed: 3 }));

    const result = await proxy.delegate_clear_stopped();
    expect(result).toBe(3);
  });

  it("returns 0 on error", async () => {
    client.mockCall("session_delegate_clear_stopped", () => {
      throw new Error("clear failed");
    });

    const result = await proxy.delegate_clear_stopped();
    expect(result).toBe(0);
  });
});

describe("serverProxy delegate_compact_status", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns isCompacting and contextUsage from pm", async () => {
    client.mockCall("session_delegate_status", () => ({
      task: {
        isCompacting: true,
        contextUsage: { tokens: 5000, contextWindow: 200000, percent: 2.5 },
      },
    }));

    const result = await proxy.delegate_compact_status("sess-compact-1");
    expect(result.isCompacting).toBe(true);
    expect(result.contextUsage.tokens).toBe(5000);
    expect(result.contextUsage.contextWindow).toBe(200000);
    expect(result.contextUsage.percent).toBe(2.5);
  });

  it("returns defaults when pm returns null task", async () => {
    client.mockCall("session_delegate_status", () => ({ task: null }));

    const result = await proxy.delegate_compact_status("sess-no-task");
    expect(result.isCompacting).toBe(false);
    expect(result.contextUsage.tokens).toBeNull();
    expect(result.contextUsage.contextWindow).toBe(0);
    expect(result.contextUsage.percent).toBeNull();
  });

  it("returns defaults on error", async () => {
    client.mockCall("session_delegate_status", () => {
      throw new Error("compact status error");
    });

    const result = await proxy.delegate_compact_status("sess-error");
    expect(result.isCompacting).toBe(false);
    expect(result.contextUsage.tokens).toBeNull();
    expect(result.contextUsage.contextWindow).toBe(0);
    expect(result.contextUsage.percent).toBeNull();
  });
});

describe("serverProxy delegate_sync", () => {
  let client: MockClient;
  let proxy: ProcessManagerApi;

  beforeEach(() => {
    client = createMockClient();
    proxy = createServerProxy(client as never);
  });

  it("returns result with all fields", async () => {
    client.mockCall("session_delegate_sync", () => ({
      sessionId: "sess-sync-1",
      status: "completed",
      exitCode: 0,
      finalText: "All done",
    }));

    const result = await proxy.delegate_sync(
      "build project",
      undefined,
      60000,
      "/project"
    );
    expect(result.sessionId).toBe("sess-sync-1");
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe("All done");
  });

  it("passes agent, model, timeoutMs, projectPath to client.call", async () => {
    client.mockCall("session_delegate_sync", () => ({
      sessionId: "sess-sync-2",
      status: "completed",
      exitCode: 0,
      finalText: "ok",
    }));

    await proxy.delegate_sync(
      "run tests",
      "build-agent",
      120000,
      "/workspace",
      "claude-sonnet-4"
    );

    expect(client.call).toHaveBeenCalledWith(
      "session_delegate_sync",
      {
        task: "run tests",
        title: "build-agent: run tests",
        agent: "build-agent",
        model: "claude-sonnet-4",
        timeoutMs: 120000,
        projectPath: "/workspace",
      },
      150000 // timeoutMs + 30_000
    );
  });

  it("returns error result on client.call failure", async () => {
    client.mockCall("session_delegate_sync", () => {
      throw new Error("sync timed out");
    });

    const result = await proxy.delegate_sync(
      "do work",
      undefined,
      30000,
      "/project"
    );
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("sync timed out");
    expect(result.sessionId).toBe("");
    expect(result.finalText).toBe("");
  });
});
