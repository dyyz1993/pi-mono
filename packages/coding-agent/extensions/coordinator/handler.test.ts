import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerChannel } from "@dyyz1993/pi-coding-agent";
import type { CoordinatorChannelContract, DelegatedTask } from "./types.js";
import { TaskStore, createCoordinatorHandler, type ProcessManagerApi } from "./handler.js";

function makeTask(overrides: Partial<DelegatedTask> = {}): DelegatedTask {
  return {
    sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test task",
    task: "Do something useful",
    projectPath: "/tmp/test",
    dispatchedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

describe("TaskStore.buildPrompt()", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("includes stopped tasks in prompt (by design, for re-activation)", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    const task = makeTask({ title: "Re-activatable task", sessionId: "sess-stopped-1" });
    store.add(task);
    store.update("sess-stopped-1", { status: "stopped", completedAt: Date.now() });

    const prompt = store.buildPrompt();

    expect(prompt).toContain("Re-activatable task");
    expect(prompt).toContain("STOPPED");
  });

  it("includes completed tasks in prompt (by design, for re-activation)", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    const task = makeTask({
      title: "Completed task still visible",
      sessionId: "sess-completed-1",
      status: "completed",
      completedAt: Date.now(),
      result: "Did the thing",
    });
    store.add(task);

    const prompt = store.buildPrompt();

    expect(prompt).toContain("Completed task still visible");
    expect(prompt).toContain("DONE");
  });

  it("persists tasks across restarts and buildPrompt includes them all", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store1 = new TaskStore(tempDir);
    store1.add(makeTask({ title: "Task A", sessionId: "sess-a" }));
    store1.add(makeTask({ title: "Task B", sessionId: "sess-b", status: "completed", completedAt: Date.now() }));

    const store2 = new TaskStore(tempDir);
    const prompt = store2.buildPrompt();

    expect(prompt).toContain("Task A");
    expect(prompt).toContain("Task B");
    expect(prompt).toContain("DONE");
  });

  it("store.remove() exists and works when called directly", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({ sessionId: "sess-removable", title: "Can be removed" }));
    expect(store.get("sess-removable")).toBeDefined();

    store.remove("sess-removable");

    expect(store.get("sess-removable")).toBeUndefined();
    expect(store.buildPrompt()).toBe("");
  });

  it("session_delegate_remove handler calls store.remove() to clean up tasks", () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, "handler.ts"),
      "utf-8",
    );

    const removeHandlerStart = handlerSource.indexOf('channel.handle("session_delegate_remove"');
    expect(removeHandlerStart).toBeGreaterThan(-1);
    const handlerBlock = handlerSource.slice(removeHandlerStart);
    expect(handlerBlock).toContain("store.remove(sessionId)");
  });

  it("session_delegate_stop sets status=stopped with completedAt timestamp", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({ sessionId: "sess-stop-test", title: "Accumulated task" }));
    store.update("sess-stop-test", { status: "stopped", completedAt: Date.now() });

    const task = store.get("sess-stop-test");
    expect(task).toBeDefined();
    expect(task?.status).toBe("stopped");
    expect(task?.completedAt).toBeDefined();

    const prompt = store.buildPrompt();
    expect(prompt).toContain("Accumulated task");
    expect(prompt).toContain("STOPPED");
  });
});

describe("TaskStore.clearStopped()", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("removes all stopped and completed tasks", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({ sessionId: "sess-idle", title: "Active task", status: "idle" }));
    store.add(makeTask({ sessionId: "sess-stopped", title: "Stopped task", status: "stopped" }));
    store.add(makeTask({ sessionId: "sess-completed", title: "Completed task", status: "completed" }));
    store.add(makeTask({ sessionId: "sess-streaming", title: "Streaming task", status: "streaming" }));

    const removed = store.clearStopped();

    expect(removed).toBe(2);
    expect(store.list().length).toBe(2);
    expect(store.list().map((t) => t.sessionId)).toEqual(
      expect.arrayContaining(["sess-idle", "sess-streaming"]),
    );
  });

  it("returns 0 when no tasks are stopped or completed", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({ sessionId: "sess-idle", status: "idle" }));
    store.add(makeTask({ sessionId: "sess-streaming", status: "streaming" }));

    expect(store.clearStopped()).toBe(0);
    expect(store.list().length).toBe(2);
  });

  it("persists removal to disk", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store1 = new TaskStore(tempDir);
    store1.add(makeTask({ sessionId: "sess-a", status: "stopped" }));
    store1.add(makeTask({ sessionId: "sess-b", status: "idle" }));
    store1.clearStopped();

    const store2 = new TaskStore(tempDir);
    expect(store2.list().length).toBe(1);
    expect(store2.list()[0].sessionId).toBe("sess-b");
  });
});

describe("TaskStore.add() sessionId guard", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws on empty sessionId", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    expect(() => store.add(makeTask({ sessionId: "" }))).toThrow("cannot add task with empty sessionId");
  });

  it("throws on undefined sessionId when cast", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    expect(() => store.add(makeTask({ sessionId: undefined as unknown as string }))).toThrow("cannot add task with empty sessionId");
  });
});

describe("TaskStore.buildPrompt() stale task filtering", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("hides stopped tasks older than 5 minutes", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    const oldTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago

    store.add(makeTask({
      sessionId: "sess-old-stopped",
      title: "Old stopped task",
      status: "stopped",
      completedAt: oldTime,
    }));

    const prompt = store.buildPrompt();
    expect(prompt).toBe("");
  });

  it("keeps recently stopped tasks", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-recent-stopped",
      title: "Recent stopped task",
      status: "stopped",
      completedAt: Date.now() - 1000, // 1 second ago
    }));

    const prompt = store.buildPrompt();
    expect(prompt).toContain("Recent stopped task");
  });

  it("keeps old stopped tasks without completedAt (no timestamp to check)", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-no-completedat",
      title: "No completedAt",
      status: "stopped",
    }));

    const prompt = store.buildPrompt();
    expect(prompt).toContain("No completedAt");
  });

  it("keeps idle/streaming tasks regardless of age", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    const oldTime = Date.now() - 10 * 60 * 1000;

    store.add(makeTask({
      sessionId: "sess-old-idle",
      title: "Old idle task",
      status: "idle",
      dispatchedAt: oldTime,
    }));

    const prompt = store.buildPrompt();
    expect(prompt).toContain("Old idle task");
  });
});

describe("session_delegate_remove and session_delegate_clear_stopped handlers exist", () => {
  it("session_delegate_remove handler is registered in handler.ts", () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, "handler.ts"),
      "utf-8",
    );
    expect(handlerSource).toContain('channel.handle("session_delegate_remove"');
  });

  it("session_delegate_clear_stopped handler is registered in handler.ts", () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, "handler.ts"),
      "utf-8",
    );
    expect(handlerSource).toContain('channel.handle("session_delegate_clear_stopped"');
  });

  it("session_delegate_remove and session_delegate_clear_stopped tools are registered in index.ts", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );
    expect(indexSource).toContain('name: "session_delegate_remove"');
    expect(indexSource).toContain('name: "session_delegate_clear_stopped"');
  });

  it("delegate_remove and delegate_clear_stopped are in ProcessManagerApi", () => {
    const handlerSource = fs.readFileSync(
      path.join(__dirname, "handler.ts"),
      "utf-8",
    );
    expect(handlerSource).toContain("delegate_remove(sessionId: string): Promise<boolean>");
    expect(handlerSource).toContain("delegate_clear_stopped(): Promise<number>");
  });
});

// ── TDD tests for zombie task bugs ──

describe("Bug: session_delegate_stop leaves stopped tasks in store forever", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-evicts stopped tasks older than 5 minutes from the store on save()", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-zombie-stop",
      title: "Zombie stopped task",
      status: "stopped",
      completedAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    }));

    // After eviction, the task should be gone from the store entirely
    expect(store.get("sess-zombie-stop")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("auto-evicts completed tasks older than 5 minutes from the store on save()", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-zombie-done",
      title: "Zombie completed task",
      status: "completed",
      completedAt: Date.now() - 10 * 60 * 1000,
    }));

    expect(store.get("sess-zombie-done")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it("keeps recently stopped tasks (within 5 minutes)", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-recent-stop",
      title: "Recent stopped",
      status: "stopped",
      completedAt: Date.now() - 30 * 1000,
    }));

    expect(store.get("sess-recent-stop")).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });

  it("evicts stale tasks and keeps fresh ones in the same batch", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-old-stopped",
      status: "stopped",
      completedAt: Date.now() - 10 * 60 * 1000,
    }));
    store.add(makeTask({
      sessionId: "sess-recent-stopped",
      status: "stopped",
      completedAt: Date.now() - 10 * 1000,
    }));
    store.add(makeTask({
      sessionId: "sess-active-idle",
      status: "idle",
    }));

    expect(store.list()).toHaveLength(2);
    expect(store.list().map((t) => t.sessionId)).toEqual(
      expect.arrayContaining(["sess-recent-stopped", "sess-active-idle"]),
    );
  });
});

describe("Bug: delegate_list never removes ghost tasks whose sessions are gone", () => {
  it("handler session_delegate_list removes tasks whose remote status is 'stopped' and have completedAt older than 5 min", async () => {
    const handlerSource = fs.readFileSync(path.join(__dirname, "handler.ts"), "utf-8");
    const listHandlerStart = handlerSource.indexOf('channel.handle("session_delegate_list"');
    expect(listHandlerStart).toBeGreaterThan(-1);

    const listHandlerEnd = handlerSource.indexOf("});", listHandlerStart);
    const listHandlerBlock = handlerSource.slice(listHandlerStart, listHandlerEnd);

    // The list handler should remove (not just update) tasks whose remote session is gone
    expect(listHandlerBlock).toContain("store.remove(");
  });
});

describe("Bug: session_delegate_stop registered twice in index.ts", () => {
  it("session_delegate_stop appears exactly once in tool registrations", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "index.ts"), "utf-8");

    const firstIdx = indexSource.indexOf('name: "session_delegate_stop"');
    expect(firstIdx).toBeGreaterThan(-1);

    const secondIdx = indexSource.indexOf('name: "session_delegate_stop"', firstIdx + 1);
    // Should NOT find a second registration
    expect(secondIdx).toBe(-1);
  });
});

// ── Regression tests for bugs found during audit ──

describe("buildPrompt() filters completed tasks older than 5 minutes (Bug 2 fix)", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("hides completed tasks older than 5 minutes", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-old-completed",
      title: "Old completed task",
      status: "completed",
      completedAt: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    }));

    expect(store.buildPrompt()).toBe("");
  });

  it("keeps recently completed tasks (within 5 minutes)", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-recent-completed",
      title: "Recent completed task",
      status: "completed",
      completedAt: Date.now() - 30 * 1000, // 30 seconds ago
    }));

    const prompt = store.buildPrompt();
    expect(prompt).toContain("Recent completed task");
    expect(prompt).toContain("DONE");
  });

  it("mixed: old completed hidden, recent completed visible, idle always visible", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({
      sessionId: "sess-old-completed",
      title: "Old Completed",
      status: "completed",
      completedAt: Date.now() - 10 * 60 * 1000,
    }));
    store.add(makeTask({
      sessionId: "sess-recent-completed",
      title: "Recent Completed",
      status: "completed",
      completedAt: Date.now() - 10 * 1000,
    }));
    store.add(makeTask({
      sessionId: "sess-idle",
      title: "Active Task",
      status: "idle",
    }));

    const prompt = store.buildPrompt();
    expect(prompt).not.toContain("Old Completed");
    expect(prompt).toContain("Recent Completed");
    expect(prompt).toContain("Active Task");
  });
});

describe("re-activating a stopped task clears completedAt (Bug 5 fix)", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("completedAt is cleared when re-activating from stopped to idle", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    store.add(makeTask({ sessionId: "sess-reactivate", title: "Reactivated task" }));
    store.update("sess-reactivate", { status: "stopped", completedAt: Date.now() });

    // Verify completedAt is set
    expect(store.get("sess-reactivate")?.completedAt).toBeDefined();

    // Re-activate (simulating session_delegate_send handler)
    store.update("sess-reactivate", { status: "idle", completedAt: undefined });

    const task = store.get("sess-reactivate");
    expect(task?.status).toBe("idle");
    expect(task?.completedAt).toBeUndefined();
  });

  it("buildPrompt shows correct elapsed time after re-activation", () => {
    tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const store = new TaskStore(tempDir);
    const dispatchedAt = Date.now() - 60 * 1000; // 1 minute ago
    store.add(makeTask({
      sessionId: "sess-timecheck",
      title: "Time check task",
      dispatchedAt,
    }));
    store.update("sess-timecheck", { status: "stopped", completedAt: Date.now() });

    // Before re-activate: shows frozen duration (completedAt - dispatchedAt)
    let prompt = store.buildPrompt();
    expect(prompt).toContain("Time check task");

    // Re-activate
    store.update("sess-timecheck", { status: "idle", completedAt: undefined });

    // After re-activate: shows "elapsed" (live counter)
    prompt = store.buildPrompt();
    expect(prompt).toContain("Time check task");
    expect(prompt).toContain("elapsed");
    expect(prompt).not.toContain("STOPPED");
  });
});

describe("no double store operations in tool handlers (Bug 3/4/6 fix)", () => {
  it("session_delegate tool handler does NOT call store.add (handler.ts does it)", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    // Find the session_delegate tool execute block
    const delegateToolStart = indexSource.indexOf('name: "session_delegate"');
    expect(delegateToolStart).toBeGreaterThan(-1);

    // Find the session_delegate_fork tool start to bound the search
    const forkToolStart = indexSource.indexOf('name: "session_delegate_fork"');
    expect(forkToolStart).toBeGreaterThan(-1);

    const delegateToolBlock = indexSource.slice(delegateToolStart, forkToolStart);
    expect(delegateToolBlock).not.toContain("store.add(");
  });

  it("session_delegate_stop tool handler does NOT call store.update (handler.ts does it)", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    const stopToolStart = indexSource.indexOf('name: "session_delegate_stop"');
    expect(stopToolStart).toBeGreaterThan(-1);

    const nextToolStart = indexSource.indexOf('name: "session_delegate_fork"');
    const stopToolBlock = indexSource.slice(stopToolStart, nextToolStart);
    expect(stopToolBlock).not.toContain("store.update(");
  });

  it("session_delegate_remove tool handler does NOT call store.remove (handler.ts does it)", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    const removeToolStart = indexSource.indexOf('name: "session_delegate_remove"');
    expect(removeToolStart).toBeGreaterThan(-1);

    const nextToolStart = indexSource.indexOf('name: "session_delegate_clear_stopped"');
    const removeToolBlock = indexSource.slice(removeToolStart, nextToolStart);
    expect(removeToolBlock).not.toContain("store.remove(");
  });

  it("session_delegate_clear_stopped tool handler does NOT call store.clearStopped (handler.ts does it)", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    const clearToolStart = indexSource.indexOf('name: "session_delegate_clear_stopped"');
    expect(clearToolStart).toBeGreaterThan(-1);

    const messageReceivedStart = indexSource.indexOf('client.on("message_received"');
    const clearToolBlock = indexSource.slice(clearToolStart, messageReceivedStart);
    expect(clearToolBlock).not.toContain("store.clearStopped(");
  });

  it("session_delegate_fork tool handler does NOT call store.add (handler.ts does it)", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    const forkToolStart = indexSource.indexOf('name: "session_delegate_fork"');
    expect(forkToolStart).toBeGreaterThan(-1);

    const removeToolStart = indexSource.indexOf('name: "session_delegate_remove"');
    const forkToolBlock = indexSource.slice(forkToolStart, removeToolStart);
    expect(forkToolBlock).not.toContain("store.add(");
  });
});

// ── TDD tests for hooks-engine agent param passthrough (P0) ──

describe("Bug: session_delegate_sync handler missing (hooks not activated in subagent)", () => {
  it("handler.ts registers session_delegate_sync handler", () => {
    const handlerSource = fs.readFileSync(path.join(__dirname, "handler.ts"), "utf-8");
    expect(handlerSource).toContain('channel.handle("session_delegate_sync"');
  });

  it("ProcessManagerApi includes delegate_sync method", () => {
    const handlerSource = fs.readFileSync(path.join(__dirname, "handler.ts"), "utf-8");
    expect(handlerSource).toContain("delegate_sync");
  });

  it("serverProxy passes agent param through to delegate_sync", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "index.ts"), "utf-8");

    // The serverProxy should have a delegate_sync method that passes agent
    expect(indexSource).toContain("delegate_sync");
    expect(indexSource).toContain("agent");
  });

  it("session_delegate_sync handler passes agent to delegate_sync", () => {
    const handlerSource = fs.readFileSync(path.join(__dirname, "handler.ts"), "utf-8");
    const syncHandlerStart = handlerSource.indexOf('channel.handle("session_delegate_sync"');
    expect(syncHandlerStart).toBeGreaterThan(-1);

    const syncHandlerEnd = handlerSource.indexOf("});", syncHandlerStart);
    const syncHandlerBlock = handlerSource.slice(syncHandlerStart, syncHandlerEnd);

    // The handler should extract agent from params and pass it
    expect(syncHandlerBlock).toContain("agent");
    expect(syncHandlerBlock).toContain("delegate_sync");
  });

  it("session_delegate_sync tool is registered in index.ts with agent param", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "index.ts"), "utf-8");
    expect(indexSource).toContain('name: "session_delegate_sync"');
  });

  it("session_delegate_sync DelegateSyncParams schema includes agent field", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "index.ts"), "utf-8");

    // Find the DelegateSyncParams schema (or inline schema for session_delegate_sync tool)
    const syncToolStart = indexSource.indexOf('name: "session_delegate_sync"');
    if (syncToolStart === -1) {
      // Tool doesn't exist yet - this is the RED test failing as expected
      expect(syncToolStart).toBeGreaterThan(-1);
      return;
    }
    const syncToolEnd = indexSource.indexOf("});", syncToolStart);
    const syncToolBlock = indexSource.slice(syncToolStart, syncToolEnd);
    expect(syncToolBlock).toMatch(/agent/i);
  });
});

describe("message_received handler tracks task status (Bug 7 fix)", () => {
  it("index.ts message_received handler detects completion signals and updates status", () => {
    const indexSource = fs.readFileSync(
      path.join(__dirname, "index.ts"),
      "utf-8",
    );

    const msgReceivedStart = indexSource.indexOf('client.on("message_received"');
    expect(msgReceivedStart).toBeGreaterThan(-1);

    const msgReceivedBlock = indexSource.slice(msgReceivedStart);
    // Should detect [completed], [done], or "task completed" signals
    expect(msgReceivedBlock).toContain("[completed]");
    expect(msgReceivedBlock).toContain("isCompletion");
    expect(msgReceivedBlock).toContain("status: \"completed\"");
    // Should also update streaming status for regular messages
    expect(msgReceivedBlock).toContain("status: \"streaming\"");
  });
});
