import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import agentPermissions, { createPermissionHandler } from "../../extensions/agent-permissions/index.js";
import type { AgentConfig } from "../../src/core/agent-types.js";

interface ToolCallEvent {
	toolName: string;
	input: Record<string, unknown>;
	variables?: Record<string, string>;
}

interface HandlerResult {
	block: boolean;
	reason?: string;
}

interface MockPi {
	on: ReturnType<typeof vi.fn>;
	handlers: Record<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>>;
}

function createMockPi(): MockPi {
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>> = {};
	return {
		on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		handlers,
	};
}

function makeConfig(mode: AgentConfig["permissionMode"], overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		name: "test",
		description: "",
		permissionMode: mode,
		...overrides,
	} as AgentConfig;
}

async function fireToolCall(mock: MockPi, event: ToolCallEvent): Promise<HandlerResult | undefined> {
	const ctx = {
		sessionManager: {
			getSessionId: () => "test-session",
			getEntries: () => [],
			getBranch: () => [],
		},
		hasUI: true,
		ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
		cwd: "/tmp/test",
	};
	let result: HandlerResult | undefined;
	for (const h of mock.handlers["tool_call"] ?? []) {
		result = (await h(event, ctx)) as HandlerResult | undefined;
	}
	return result;
}

describe("agent-permissions-extended", () => {
	let mock: MockPi;

	beforeEach(() => {
		mock = createMockPi();
		agentPermissions(mock as unknown as Parameters<typeof agentPermissions>[0]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("plan mode via extension handler", () => {
		it("should allow all read tools in plan mode", async () => {
			const vars = { permissionMode: "plan", agentName: "planner" };
			for (const tool of ["read", "grep", "find", "ls", "glob"]) {
				const result = await fireToolCall(mock, {
					toolName: tool,
					input: {},
					variables: vars,
				});
				expect(result).toBeUndefined();
			}
		});

		it("should block edit, write, and bash in plan mode", async () => {
			const vars = { permissionMode: "plan", agentName: "planner" };
			for (const tool of ["edit", "write", "bash"]) {
				const result = await fireToolCall(mock, {
					toolName: tool,
					input: tool === "bash" ? { command: "ls" } : {},
					variables: vars,
				});
				expect(result?.block).toBe(true);
			}
		});

		it("should block even safe bash in plan mode", async () => {
			const result = await fireToolCall(mock, {
				toolName: "bash",
				input: { command: "echo hello" },
				variables: { permissionMode: "plan", agentName: "planner" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("plan mode");
		});
	});

	describe("acceptEdits mode via extension handler", () => {
		it("should allow edit and write in acceptEdits mode", async () => {
			const vars = { permissionMode: "acceptEdits", agentName: "editor" };
			const editResult = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: vars,
			});
			expect(editResult).toBeUndefined();

			const writeResult = await fireToolCall(mock, {
				toolName: "write",
				input: {},
				variables: vars,
			});
			expect(writeResult).toBeUndefined();
		});

		it("should block dangerous bash patterns in acceptEdits mode", async () => {
			const dangerousCommands = [
				"rm -rf /tmp/test",
				"sudo apt install foo",
				"chmod 777 /etc/passwd",
				"git push --force origin main",
				"git commit --no-verify",
				"cat .env",
				"cat credentials.json",
			];

			for (const cmd of dangerousCommands) {
				const result = await fireToolCall(mock, {
					toolName: "bash",
					input: { command: cmd },
					variables: { permissionMode: "acceptEdits", agentName: "editor" },
				});
				expect(result?.block).toBe(true);
			}
		});

		it("should allow safe bash in acceptEdits mode", async () => {
			const safeCommands = ["npm test", "ls -la", "git status", "node -v"];
			for (const cmd of safeCommands) {
				const result = await fireToolCall(mock, {
					toolName: "bash",
					input: { command: cmd },
					variables: { permissionMode: "acceptEdits", agentName: "editor" },
				});
				expect(result).toBeUndefined();
			}
		});
	});

	describe("auto mode via extension handler", () => {
		it("should allow all tools in auto mode", async () => {
			const tools = ["read", "edit", "write", "bash"];
			for (const tool of tools) {
				const result = await fireToolCall(mock, {
					toolName: tool,
					input: tool === "bash" ? { command: "echo hello" } : {},
					variables: { permissionMode: "auto", agentName: "agent" },
				});
				expect(result).toBeUndefined();
			}
		});

		it("should return undefined when no permissionMode is set", async () => {
			const result = await fireToolCall(mock, {
				toolName: "bash",
				input: { command: "rm -rf /" },
				variables: { agentName: "agent" },
			});
			expect(result).toBeUndefined();
		});
	});

	describe("allowedTools whitelist via extension handler", () => {
		it("should only allow whitelisted tools", async () => {
			const vars = {
				permissionMode: "auto",
				agentName: "reader",
				allowedTools: "read,grep",
			};
			const readResult = await fireToolCall(mock, {
				toolName: "read",
				input: {},
				variables: vars,
			});
			expect(readResult).toBeUndefined();

			const grepResult = await fireToolCall(mock, {
				toolName: "grep",
				input: {},
				variables: vars,
			});
			expect(grepResult).toBeUndefined();

			const editResult = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: vars,
			});
			expect(editResult?.block).toBe(true);
			expect(editResult?.reason).toContain("whitelist");
		});

		it("should apply whitelist even in plan mode", async () => {
			const vars = {
				permissionMode: "plan",
				agentName: "reader",
				allowedTools: "read",
			};
			const grepResult = await fireToolCall(mock, {
				toolName: "grep",
				input: {},
				variables: vars,
			});
			expect(grepResult?.block).toBe(true);
		});
	});

	describe("disallowedTools blacklist via extension handler", () => {
		it("should block disallowed tools in auto mode", async () => {
			const vars = {
				permissionMode: "auto",
				agentName: "safe-agent",
				disallowedTools: "edit,write",
			};
			const editResult = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: vars,
			});
			expect(editResult?.block).toBe(true);
			expect(editResult?.reason).toContain("disallowed");

			const readResult = await fireToolCall(mock, {
				toolName: "read",
				input: {},
				variables: vars,
			});
			expect(readResult).toBeUndefined();
		});
	});

	describe("whitelist and blacklist both present", () => {
		it("should allow tool in whitelist even if also in disallowedTools via createPermissionHandler", () => {
			const handler = createPermissionHandler(
				makeConfig("auto", {
					tools: ["read", "edit"],
					disallowedTools: ["edit"],
				}),
			);
			const result = handler?.({ toolName: "edit", input: {} });
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");

			const readResult = handler?.({ toolName: "read", input: {} });
			expect(readResult).toBeNull();
		});

		it("should block tool not in whitelist", () => {
			const handler = createPermissionHandler(
				makeConfig("auto", {
					tools: ["read"],
					disallowedTools: ["bash"],
				}),
			);
			const writeResult = handler?.({ toolName: "write", input: {} });
			expect(writeResult?.block).toBe(true);

			const readResult = handler?.({ toolName: "read", input: {} });
			expect(readResult).toBeNull();
		});
	});

	describe("empty permissionMode defaults to auto behavior", () => {
		it("should treat empty string as auto (not blocked)", async () => {
			const result = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: { permissionMode: "", agentName: "agent" },
			});
			expect(result).toBeUndefined();
		});

		it("should treat missing permissionMode as auto (not blocked)", async () => {
			const result = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: { agentName: "agent" },
			});
			expect(result).toBeUndefined();
		});
	});

	describe("dontAsk and always-allow modes via extension handler", () => {
		it("should allow everything in dontAsk mode", async () => {
			const result = await fireToolCall(mock, {
				toolName: "bash",
				input: { command: "rm -rf /" },
				variables: { permissionMode: "dontAsk", agentName: "agent" },
			});
			expect(result).toBeUndefined();
		});

		it("should allow everything in always-allow mode", async () => {
			const result = await fireToolCall(mock, {
				toolName: "bash",
				input: { command: "rm -rf /" },
				variables: { permissionMode: "always-allow", agentName: "agent" },
			});
			expect(result).toBeUndefined();
		});
	});

	describe("always-deny mode via extension handler", () => {
		it("should block all tools in always-deny mode", async () => {
			const tools = ["read", "edit", "write", "bash", "grep"];
			for (const tool of tools) {
				const result = await fireToolCall(mock, {
					toolName: tool,
					input: tool === "bash" ? { command: "ls" } : {},
					variables: { permissionMode: "always-deny", agentName: "agent" },
				});
				expect(result?.block).toBe(true);
			}
		});
	});

	describe("wildcard patterns in tools list", () => {
		it("should match all tools with * pattern via createPermissionHandler", () => {
			const handler = createPermissionHandler(makeConfig("auto", { tools: ["*"] }));
			expect(handler?.({ toolName: "any-tool", input: {} })).toBeNull();
			expect(handler?.({ toolName: "read", input: {} })).toBeNull();
		});

		it("should match tools with prefix wildcard via createPermissionHandler", () => {
			const handler = createPermissionHandler(makeConfig("auto", { tools: ["mcp__*"] }));
			expect(handler?.({ toolName: "mcp__redis__get", input: {} })).toBeNull();
			expect(handler?.({ toolName: "read", input: {} })?.block).toBe(true);
		});

		it("should match tools with input pattern via createPermissionHandler", () => {
			const handler = createPermissionHandler(makeConfig("auto", { tools: ["bash(ls *)"] }));
			expect(handler?.({ toolName: "bash", input: { command: "ls -la" } })).toBeNull();
			expect(handler?.({ toolName: "bash", input: { command: "rm file" } })?.block).toBe(true);
		});

		it("should match tools with suffix wildcard", () => {
			const handler = createPermissionHandler(makeConfig("auto", { tools: ["*__get"] }));
			expect(handler?.({ toolName: "mcp__get", input: {} })).toBeNull();
			expect(handler?.({ toolName: "redis__get", input: {} })).toBeNull();
			expect(handler?.({ toolName: "redis__set", input: {} })?.block).toBe(true);
		});

		it("should match tools with middle wildcard", () => {
			const handler = createPermissionHandler(makeConfig("auto", { tools: ["*redis*"] }));
			expect(handler?.({ toolName: "mcp__redis__get", input: {} })).toBeNull();
			expect(handler?.({ toolName: "mcp__postgres__get", input: {} })?.block).toBe(true);
		});
	});

	describe("agent name in reason messages", () => {
		it("should include agent name in block reason for whitelist", async () => {
			const result = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: {
					permissionMode: "auto",
					agentName: "my-special-agent",
					allowedTools: "read",
				},
			});
			expect(result?.reason).toContain("my-special-agent");
		});

		it("should include agent name in block reason for disallowedTools", async () => {
			const result = await fireToolCall(mock, {
				toolName: "edit",
				input: {},
				variables: {
					permissionMode: "auto",
					agentName: "my-safe-agent",
					disallowedTools: "edit",
				},
			});
			expect(result?.reason).toContain("my-safe-agent");
		});
	});
});
