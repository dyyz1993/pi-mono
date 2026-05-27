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

import { createServerProxy } from "./index.js";
import type { ProcessManagerApi } from "./handler.js";

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
    client.mockCall("session_delegate_status", () => ({ task: null, status: "not_found" }));

    const result = await proxy.delegate_status("sess_ghost_never_existed_99999");
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
      proxy.delegate_fork("sess_ghost_fork_99999", "do something", "title", "/fake"),
    ).rejects.toThrow(/not found/i);
  });

  it("returns success when handler returns a valid result", async () => {
    client.mockCall("session_delegate_fork", () => ({
      sessionId: "sess_fork_123",
      status: "started",
    }));

    const result = await proxy.delegate_fork("sess_real", "do something", "title", "/fake");
    expect(result.sessionId).toBe("sess_fork_123");
    expect(result.status).toBe("started");
  });
});
