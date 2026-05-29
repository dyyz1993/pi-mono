import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import hooksEngine, {
  groupMatches,
  isHookGroup,
  loadSettingsHooks,
  matchesCondition,
  parseHooks,
} from "../../extensions/hooks-engine/index.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface MockPi {
  handlers: Record<string, Array<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>>;
  sentMessages: Array<{ content: string; options?: { deliverAs?: string } }>;
  on: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
}

function createMockPi(): MockPi {
  const handlers: Record<string, Array<(event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>>> = {};
  const sentMessages: Array<{ content: string; options?: { deliverAs?: string } }> = [];

  return {
    handlers,
    sentMessages,
    on: vi.fn((event: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    sendUserMessage: vi.fn((content: string, options?: { deliverAs?: string }) => {
      sentMessages.push({ content, options });
    }),
  };
}

async function emitEvent(
  pi: MockPi,
  eventName: string,
  event: Record<string, unknown>,
  ctx?: Record<string, unknown>,
): Promise<unknown> {
  const list = pi.handlers[eventName];
  if (!list || list.length === 0) return undefined;
  return list[0](event, ctx ?? {});
}

describe("hooks-engine-extended", () => {
  let pi: MockPi;

  beforeEach(() => {
    pi = createMockPi();
    hooksEngine(pi as unknown as Parameters<typeof hooksEngine>[0]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("hook priority: global deny short-circuits project hook", () => {
    it("should stop at first deny and not execute later hooks", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "command", command: "echo 'first deny'; exit 2" },
              { type: "command", command: "echo 'second deny'; exit 2" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "first deny" });
    });
  });

  describe("command hook exit codes", () => {
    it("should allow on exit code 0", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [{ type: "command", command: "exit 0" }],
          }),
        },
      });
      expect(result).toBeUndefined();
    });

    it("should deny on exit code 2 with structured reason", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              {
                type: "command",
                command: `echo '{"action":"deny","reason":"not allowed"}'; exit 2`,
              },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "not allowed" });
    });

    it("should ask user on exit code 3 with question", async () => {
      const ctx = { ui: { confirm: vi.fn().mockResolvedValue(true) } };
      const result = await emitEvent(
        pi,
        "tool_call",
        {
          toolName: "Bash",
          variables: {
            agentHooks: JSON.stringify({
              on_tool_start: [
                {
                  type: "command",
                  command: `echo '{"action":"ask","question":"proceed?"}'; exit 3`,
                },
              ],
            }),
          },
        },
        ctx,
      );
      expect(ctx.ui.confirm).toHaveBeenCalledWith("Hook Confirmation", "proceed?");
      expect(result).toBeUndefined();
    });

    it("should block on exit code 3 when user denies", async () => {
      const ctx = { ui: { confirm: vi.fn().mockResolvedValue(false) } };
      const result = await emitEvent(
        pi,
        "tool_call",
        {
          toolName: "Bash",
          variables: {
            agentHooks: JSON.stringify({
              on_tool_start: [
                {
                  type: "command",
                  command: `echo '{"action":"ask","question":"dangerous?"}'; exit 3`,
                },
              ],
            }),
          },
        },
        ctx,
      );
      expect(result).toEqual({ block: true, reason: "[hook] User denied: dangerous?" });
    });

    it("should block on exit code 3 with no UI available", async () => {
      const result = await emitEvent(
        pi,
        "tool_call",
        {
          toolName: "Write",
          variables: {
            agentHooks: JSON.stringify({
              on_tool_start: [{ type: "command", command: "exit 3" }],
            }),
          },
        },
        {},
      );
      expect(result?.block).toBe(true);
      if (result && typeof result === "object" && "reason" in result) {
        expect(result.reason).toContain("Write");
      }
    });

    it("should treat exit code 1 as allow (non-blocking)", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [{ type: "command", command: "exit 1" }],
          }),
        },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("prompt hook: text injection", () => {
    it("should inject prompt text via sendUserMessage", async () => {
      await emitEvent(pi, "tool_result", {
        toolName: "Edit",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_complete: [
              { type: "prompt", prompt: "run tests after edit" },
            ],
          }),
        },
      });
      expect(pi.sendUserMessage).toHaveBeenCalledWith("run tests after edit", {
        deliverAs: "followUp",
      });
    });

    it("should inject multiple prompts in order", async () => {
      await emitEvent(pi, "tool_result", {
        toolName: "Edit",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_complete: [
              { type: "prompt", prompt: "first prompt" },
              { type: "prompt", prompt: "second prompt" },
            ],
          }),
        },
      });
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
      expect(pi.sendUserMessage).toHaveBeenNthCalledWith(1, "first prompt", {
        deliverAs: "followUp",
      });
      expect(pi.sendUserMessage).toHaveBeenNthCalledWith(2, "second prompt", {
        deliverAs: "followUp",
      });
    });
  });

  describe("missing hook command", () => {
    it("should handle gracefully when command does not exist", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "command", command: "/nonexistent/command" },
            ],
          }),
        },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("hook with if condition matching tool name", () => {
    it("should only run hook when condition matches", async () => {
      const hooks = {
        on_tool_start: [
          {
            type: "command" as const,
            command: "echo 'bash-only'; exit 2",
            if: "Bash",
          },
        ],
      };

      const bashResult = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: { agentHooks: JSON.stringify(hooks) },
      });
      expect(bashResult).toEqual({ block: true, reason: "bash-only" });

      const editResult = await emitEvent(pi, "tool_call", {
        toolName: "Edit",
        variables: { agentHooks: JSON.stringify(hooks) },
      });
      expect(editResult).toBeUndefined();
    });

    it("should support toolName == expression in condition", async () => {
      const hooks = {
        on_tool_start: [
          {
            type: "command" as const,
            command: "echo 'expression match'; exit 2",
            if: "toolName == 'Write'",
          },
        ],
      };

      const writeResult = await emitEvent(pi, "tool_call", {
        toolName: "Write",
        variables: { agentHooks: JSON.stringify(hooks) },
      });
      expect(writeResult).toEqual({ block: true, reason: "expression match" });

      const readResult = await emitEvent(pi, "tool_call", {
        toolName: "Read",
        variables: { agentHooks: JSON.stringify(hooks) },
      });
      expect(readResult).toBeUndefined();
    });
  });

  describe("HookGroup with matcher field", () => {
    it("should execute hooks within matching group", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "echo 'group deny'; exit 2" }],
              },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "group deny" });
    });

    it("should skip group when matcher does not match", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Read",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              {
                matcher: "Bash|Write",
                hooks: [{ type: "command", command: "echo 'no match'; exit 2" }],
              },
            ],
          }),
        },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("agent_start and agent_end events", () => {
    it("should handle agent_start event with hooks", async () => {
      const result = await emitEvent(pi, "agent_start", {
        variables: {
          agentHooks: JSON.stringify({
            on_agent_start: [
              { type: "command", command: "echo 'agent started'; exit 2" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "agent started" });
    });

    it("should handle agent_end event with hooks", async () => {
      const result = await emitEvent(pi, "agent_end", {
        variables: {
          agentHooks: JSON.stringify({
            on_agent_complete: [
              { type: "command", command: "echo 'agent done'; exit 2" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "agent done" });
    });
  });

  describe("matchesCondition extended", () => {
    it("should match pipe-separated conditions", () => {
      expect(matchesCondition("Bash|Edit", { toolName: "Bash" })).toBe(true);
      expect(matchesCondition("Bash|Edit", { toolName: "Edit" })).toBe(true);
      expect(matchesCondition("Bash|Edit", { toolName: "Read" })).toBe(false);
    });

    it("should handle undefined toolName", () => {
      expect(matchesCondition("Bash", {})).toBe(false);
    });

    it("should match with regex pattern b.*", () => {
      expect(matchesCondition("b.*", { toolName: "Bash" })).toBe(true);
      expect(matchesCondition("b.*", { toolName: "bash" })).toBe(true);
      expect(matchesCondition("b.*", { toolName: "read" })).toBe(false);
    });

    it("should return false for invalid regex", () => {
      expect(matchesCondition("[invalid", { toolName: "Bash" })).toBe(false);
    });

    it("should match expression syntax case-insensitively", () => {
      expect(matchesCondition("toolName == 'bash'", { toolName: "Bash" })).toBe(true);
      expect(matchesCondition("toolName == 'BASH'", { toolName: "bash" })).toBe(true);
    });
  });

  describe("groupMatches", () => {
    it("should match all when matcher is undefined", () => {
      expect(groupMatches(undefined, "anything")).toBe(true);
    });

    it("should match all when matcher is empty string", () => {
      expect(groupMatches("", "anything")).toBe(true);
    });

    it("should match all when matcher is *", () => {
      expect(groupMatches("*", "anything")).toBe(true);
    });

    it("should match specific tool name", () => {
      expect(groupMatches("Bash", "Bash")).toBe(true);
      expect(groupMatches("Bash", "Edit")).toBe(false);
    });

    it("should match regex pattern case-insensitively via matchesCondition", () => {
      expect(groupMatches("Bash", "Bash")).toBe(true);
      expect(groupMatches("Bash", "bash")).toBe(true);
      expect(groupMatches("Bash", "Edit")).toBe(false);
    });

    it("should match pipe-separated matcher", () => {
      expect(groupMatches("Bash|Edit", "Bash")).toBe(true);
      expect(groupMatches("Bash|Edit", "Edit")).toBe(true);
      expect(groupMatches("Bash|Edit", "Write")).toBe(false);
    });
  });

  describe("isHookGroup", () => {
    it("should identify hook groups", () => {
      expect(isHookGroup({ hooks: [] })).toBe(true);
      expect(isHookGroup({ hooks: [{ type: "command", command: "echo" }] })).toBe(true);
    });

    it("should identify flat hooks", () => {
      expect(isHookGroup({ type: "command", command: "echo" })).toBe(false);
      expect(isHookGroup({ type: "prompt", prompt: "text" })).toBe(false);
    });
  });

  describe("parseHooks edge cases", () => {
    it("should parse hooks with multiple event keys", () => {
      const raw = JSON.stringify({
        on_tool_start: [{ type: "command", command: "a" }],
        on_tool_complete: [{ type: "command", command: "b" }],
      });
      const result = parseHooks(raw);
      expect(result).not.toBeNull();
      expect(Object.keys(result!)).toHaveLength(2);
    });

    it("should return null for null input", () => {
      expect(parseHooks(null as unknown as string)).toBeNull();
    });
  });

  describe("loadSettingsHooks", () => {
    const tempDir = join(tmpdir(), `hooks-test-${Date.now()}`);

    beforeEach(() => {
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return null for nonexistent file", () => {
      expect(loadSettingsHooks(join(tempDir, "missing.json"))).toBeNull();
    });

    it("should return null for file without hooks field", () => {
      const filePath = join(tempDir, "no-hooks.json");
      writeFileSync(filePath, JSON.stringify({ other: "data" }));
      expect(loadSettingsHooks(filePath)).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const filePath = join(tempDir, "bad.json");
      writeFileSync(filePath, "not json");
      expect(loadSettingsHooks(filePath)).toBeNull();
    });

    it("should load hooks from valid settings file", () => {
      const filePath = join(tempDir, "settings.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          hooks: {
            on_tool_start: [{ type: "command", command: "echo loaded" }],
          },
        }),
      );
      const result = loadSettingsHooks(filePath);
      expect(result).not.toBeNull();
      expect(result!.on_tool_start).toHaveLength(1);
    });

    it("should return null for empty hooks object", () => {
      const filePath = join(tempDir, "empty-hooks.json");
      writeFileSync(filePath, JSON.stringify({ hooks: {} }));
      expect(loadSettingsHooks(filePath)).toBeNull();
    });
  });

  describe("original event name compatibility", () => {
    it("should match hooks using original event name (tool_call) not just mapped name (on_tool_start)", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            tool_call: [
              { type: "command", command: "echo 'original name'; exit 2" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "original name" });
    });

    it("should match hooks using mapped event name (on_tool_start)", async () => {
      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "command", command: "echo 'mapped name'; exit 2" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "mapped name" });
    });
  });

  describe("HTTP hook extended", () => {
    it("should deny on 403 status", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("forbidden"),
      } as Response);

      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "http", url: "http://localhost:9999/check" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "forbidden" });

      globalThis.fetch = originalFetch;
    });

    it("should deny on 400 status", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("bad request"),
      } as Response);

      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "http", url: "http://localhost:9999/check" },
            ],
          }),
        },
      });
      expect(result).toEqual({ block: true, reason: "bad request" });

      globalThis.fetch = originalFetch;
    });

    it("should allow on 200 with JSON allow action and message", async () => {
      const originalFetch = globalThis.fetch;
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve('{"action":"allow","message":"proceed carefully"}'),
      } as Response);

      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "http", url: "http://localhost:9999/check" },
            ],
          }),
        },
      });
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        "[hook] Context injection:",
        "proceed carefully",
      );

      consoleSpy.mockRestore();
      globalThis.fetch = originalFetch;
    });

    it("should not block on network error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await emitEvent(pi, "tool_call", {
        toolName: "Bash",
        variables: {
          agentHooks: JSON.stringify({
            on_tool_start: [
              { type: "http", url: "http://localhost:9999/check" },
            ],
          }),
        },
      });
      expect(result).toBeUndefined();

      globalThis.fetch = originalFetch;
    });
  });
});
