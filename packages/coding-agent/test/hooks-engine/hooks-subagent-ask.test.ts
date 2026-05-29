import type { AgentHook, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { processHook } from "../../extensions/hooks-engine/index.js";

describe("hook exit code 3 in subagent context", () => {
	it("should ALLOW (not block) when exit code 3 and no UI available", async () => {
		const hook: AgentHook = {
			type: "command",
			command: 'printf \'{"question":"Allow this operation?"}\' && exit 3',
			timeout: 5000,
		};

		const event: Record<string, unknown> = {
			toolName: "bash",
			toolCallId: "tc_subagent_no_ui_1",
			input: { command: "echo hello" },
		};

		const ctxNoUI: ExtensionContext = {
			hasUI: false,
			cwd: "/tmp",
		} as unknown as ExtensionContext;

		const result = await processHook(hook, event, ctxNoUI, new Set(), "on_tool_start", []);

		expect(result).toBeUndefined();
	});

	it("should still block when exit code 2 regardless of UI availability", async () => {
		const hook: AgentHook = {
			type: "command",
			command: "exit 2",
			timeout: 5000,
		};

		const event: Record<string, unknown> = {
			toolName: "bash",
			toolCallId: "tc_block_no_ui_1",
			input: { command: "rm -rf /" },
		};

		const ctxNoUI: ExtensionContext = {
			hasUI: false,
			cwd: "/tmp",
		} as unknown as ExtensionContext;

		const result = await processHook(hook, event, ctxNoUI, new Set(), "on_tool_start", []);

		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
	});

	it("should ask user when exit code 3 and UI IS available", async () => {
		const confirmFn = vi.fn(async () => true);
		const hook: AgentHook = {
			type: "command",
			command: 'printf \'{"question":"Allow this?"}\' && exit 3',
			timeout: 5000,
		};

		const event: Record<string, unknown> = {
			toolName: "bash",
			toolCallId: "tc_ui_yes_1",
			input: { command: "echo hello" },
		};

		const ctxWithUI: ExtensionContext = {
			hasUI: true,
			cwd: "/tmp",
			ui: {
				confirm: confirmFn,
				notify: vi.fn(),
			},
		} as unknown as ExtensionContext;

		const result = await processHook(hook, event, ctxWithUI, new Set(), "on_tool_start", []);

		expect(result).toBeUndefined();
		expect(confirmFn).toHaveBeenCalled();
	});

	it("should block when exit code 3, UI available, and user denies", async () => {
		const hook: AgentHook = {
			type: "command",
			command: 'printf \'{"question":"Allow this?"}\' && exit 3',
			timeout: 5000,
		};

		const event: Record<string, unknown> = {
			toolName: "bash",
			toolCallId: "tc_ui_deny_1",
			input: { command: "echo hello" },
		};

		const ctxWithUIDeny: ExtensionContext = {
			hasUI: true,
			cwd: "/tmp",
			ui: {
				confirm: vi.fn(async () => false),
				notify: vi.fn(),
			},
		} as unknown as ExtensionContext;

		const result = await processHook(hook, event, ctxWithUIDeny, new Set(), "on_tool_start", []);

		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
	});
});
