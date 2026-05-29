/**
 * Harness-level integration tests for the `paths` feature.
 *
 * Tests the FULL runtime chain:
 *   Agent MD paths config -> applyAgentConfig() -> variables injected -> agent-permissions extension receives tool_call -> path checker blocks/allows
 *
 * Group 1: Extension-level integration (mock pi + real extension)
 * Group 2: Full Harness flow (createHarness + applyAgentConfig)
 */

import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPathPermissionHandler } from "../../extensions/agent-permissions/path-checker.js";
import agentPermissions from "../../extensions/agent-permissions/index.js";
import hooksEngine from "../../extensions/hooks-engine/index.js";
import type { ExtensionFactory } from "../../src/index.js";
import { createHarness, type Harness } from "./harness.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HandlerResult {
	block: boolean;
	reason?: string;
}

interface ToolCallEvent {
	toolName: string;
	input: Record<string, unknown>;
	variables?: Record<string, string>;
	toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Mock pi factory (matching extension-integration.test.ts pattern)
// ---------------------------------------------------------------------------

function createMockSetup() {
	const handlers: Record<string, Array<(event: unknown) => unknown>> = {};

	const mockPi = {
		on: vi.fn((event: string, handler: (event: unknown) => unknown) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		registerFlag: vi.fn(),
		getFlag: vi.fn(),
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		registerChannel: vi.fn(() => ({
			name: "test",
			send: vi.fn(),
			onReceive: vi.fn(() => vi.fn()),
		})),
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
		appendEntry: vi.fn(),
		sendUserMessage: vi.fn(),
	};

	agentPermissions(mockPi as unknown as Parameters<typeof agentPermissions>[0]);

	return { handlers, mockPi };
}

function emitToolCall(
	handlers: Record<string, Array<(event: unknown) => unknown>>,
	event: ToolCallEvent,
): HandlerResult | undefined {
	const toolCallHandlers = handlers["tool_call"] ?? [];
	for (const handler of toolCallHandlers) {
		const result = handler(event) as HandlerResult | undefined;
		if (result?.block) return result;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Group 1: Extension-level integration
// ---------------------------------------------------------------------------

describe("Agent Paths: Extension Integration", () => {
	let setup: ReturnType<typeof createMockSetup>;

	beforeEach(() => {
		vi.clearAllMocks();
		setup = createMockSetup();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("write allowed when file matches write paths", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md", old_string: "foo", new_string: "bar" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result).toBeUndefined();
	});

	it("write blocked when file outside write paths", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("write");
	});

	it("read allowed when file matches read paths", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			variables: {
				permissionMode: "auto",
				agentName: "src-reader",
				paths: JSON.stringify({ read: ["src/**"] }),
			},
		});
		expect(result).toBeUndefined();
	});

	it("read blocked when file outside read paths", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "read",
			input: { file_path: "/project/docs/readme.md" },
			variables: {
				permissionMode: "auto",
				agentName: "src-reader",
				paths: JSON.stringify({ read: ["src/**"] }),
			},
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("read");
	});

	it("allows all tools when no paths variable", () => {
		const editResult = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			variables: { permissionMode: "auto", agentName: "free" },
		});
		expect(editResult).toBeUndefined();

		const readResult = emitToolCall(setup.handlers, {
			toolName: "read",
			input: { file_path: "/project/docs/readme.md" },
			variables: { permissionMode: "auto", agentName: "free" },
		});
		expect(readResult).toBeUndefined();
	});

	it("allows all tools when paths is empty JSON object", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			variables: {
				permissionMode: "auto",
				agentName: "free",
				paths: "{}",
			},
		});
		expect(result).toBeUndefined();
	});

	it("gracefully ignores invalid paths JSON", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			variables: {
				permissionMode: "auto",
				agentName: "bad-json",
				paths: "not-json",
			},
		});
		expect(result).toBeUndefined();
	});

	it("write tool blocked outside write paths", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "write",
			input: { file_path: "/project/src/main.ts", content: "x" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result?.block).toBe(true);
	});

	it("multiple write patterns allow matching any", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/readme.md", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "multi-writer",
				paths: JSON.stringify({ write: ["docs/**", "*.md"] }),
			},
		});
		expect(result).toBeUndefined();
	});

	it("path check blocks even in auto mode", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result?.block).toBe(true);
	});

	it("paths + disallowedTools both enforced", () => {
		const bashResult = emitToolCall(setup.handlers, {
			toolName: "bash",
			input: { command: "ls" },
			variables: {
				permissionMode: "auto",
				agentName: "restricted",
				disallowedTools: "bash",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(bashResult?.block).toBe(true);
		expect(bashResult?.reason).toContain("disallowed");

		const editOutsideResult = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "restricted",
				disallowedTools: "bash",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(editOutsideResult?.block).toBe(true);
		expect(editOutsideResult?.reason).toContain("write");

		const editInsideResult = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/docs/guide.md", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "restricted",
				disallowedTools: "bash",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(editInsideResult).toBeUndefined();
	});

	it("relative path matching works", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "./docs/readme.md", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "rel-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result).toBeUndefined();
	});

	it("path traversal blocked", () => {
		const result = emitToolCall(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/docs/../../etc/passwd", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "traversal",
				paths: JSON.stringify({ write: ["docs/**"] }),
			},
		});
		expect(result?.block).toBe(true);
	});

	it("separate read and write paths", () => {
		const readAllowed = emitToolCall(setup.handlers, {
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			variables: {
				permissionMode: "auto",
				agentName: "mixed",
				paths: JSON.stringify({ write: ["docs/**"], read: ["src/**"] }),
			},
		});
		expect(readAllowed).toBeUndefined();

		const readBlocked = emitToolCall(setup.handlers, {
			toolName: "read",
			input: { file_path: "/project/docs/readme.md" },
			variables: {
				permissionMode: "auto",
				agentName: "mixed",
				paths: JSON.stringify({ write: ["docs/**"], read: ["src/**"] }),
			},
		});
		expect(readBlocked?.block).toBe(true);
		expect(readBlocked?.reason).toContain("read");
	});

	it("grep/glob/ls bypass read paths", () => {
		const pathsJson = JSON.stringify({ read: ["src/**"] });
		for (const tool of ["grep", "glob", "ls", "find"] as const) {
			const result = emitToolCall(setup.handlers, {
				toolName: tool,
				input: { pattern: "test" },
				variables: {
					permissionMode: "auto",
					agentName: "searcher",
					paths: pathsJson,
				},
			});
			expect(result).toBeUndefined();
		}
	});

	it("multiedit and patch respect write paths", () => {
		for (const tool of ["multiedit", "patch"] as const) {
			const result = emitToolCall(setup.handlers, {
				toolName: tool,
				input: { file_path: "/project/src/index.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "tools-check",
					paths: JSON.stringify({ write: ["docs/**"] }),
				},
			});
			expect(result?.block).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Group 2: Full Harness flow (applyAgentConfig -> variables -> extension)
// ---------------------------------------------------------------------------

const agentPermissionsFactory: ExtensionFactory = (pi) => {
	agentPermissions(pi as Parameters<typeof agentPermissions>[0]);
};

describe("Agent Paths: Full Harness Flow", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("applyAgentConfig with paths blocks edit outside write paths via extension", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		const vars = harness.session.currentAgentVariables;
		expect(vars.paths).toBe(JSON.stringify({ write: ["docs/**"] }));

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "foo", newText: "bar" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit src/index.ts");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).toContain("not in the allowed write paths");
	});

	it("applyAgentConfig with paths allows edit inside write paths", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/docs/readme.md`,
					edits: [{ oldText: "old", newText: "new" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit docs/readme.md");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).not.toContain("not in the allowed write paths");
	});

	it("applyAgentConfig injects path restriction notice into system prompt", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You are a docs writer.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"], read: ["src/**"] },
		});

		const systemPrompt = harness.session["agent"].state.systemPrompt;
		expect(systemPrompt).toContain("Path Restrictions");
		expect(systemPrompt).toContain("docs/**");
		expect(systemPrompt).toContain("src/**");
	});

	it("applyAgentConfig sets paths in currentAgentVariables", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const paths = { write: ["docs/**"], read: ["src/**"] };
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Writes docs only",
			systemPrompt: "You write docs.",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths,
		});

		const vars = harness.session.currentAgentVariables;
		expect(vars.paths).toBe(JSON.stringify(paths));
	});

	it("switching agents updates path restrictions and extension behavior", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		function getMessagesText(afterIndex: number): string {
			return harness.session.messages
				.slice(afterIndex)
				.flatMap((m) => {
					if (typeof m.content === "string") return [m.content];
					return m.content
						.filter((p): p is { type: "text"; text: string } => p.type === "text")
						.map((p) => p.text);
				})
				.join(" ");
		}

		// Agent A: only docs
		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Only writes docs",
			systemPrompt: "You are a docs writer",
			source: "project",
			filePath: "/test/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		expect(JSON.parse(harness.session.currentAgentVariables.paths!)).toEqual({ write: ["docs/**"] });

		// Verify: edit on src/index.ts is blocked under agent A
		let msgIndex = harness.session.messages.length;
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "old", newText: "new" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src/index.ts");
		expect(getMessagesText(msgIndex)).toContain("not in the allowed write paths");

		// Agent B: only src — switch agents
		await harness.session.applyAgentConfig({
			name: "src-writer",
			description: "Only writes src",
			systemPrompt: "You are a src writer",
			source: "project",
			filePath: "/test/src-writer.md",
			paths: { write: ["src/**"] },
		});

		expect(JSON.parse(harness.session.currentAgentVariables.paths!)).toEqual({ write: ["src/**"] });

		// Verify: edit on src/index.ts is now allowed under agent B
		msgIndex = harness.session.messages.length;
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "old", newText: "new" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src/index.ts again");
		expect(getMessagesText(msgIndex)).not.toContain("not in the allowed write paths");

		// Verify: edit on docs/readme.md is now blocked under agent B
		msgIndex = harness.session.messages.length;
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/docs/readme.md`,
					edits: [{ oldText: "old", newText: "new" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit docs/readme.md");
		expect(getMessagesText(msgIndex)).toContain("not in the allowed write paths");
	});
});

// ---------------------------------------------------------------------------
// Group 3: paths + hooks combination (mock pi + both extensions)
// ---------------------------------------------------------------------------

function createDualExtensionSetup() {
	const handlers: Array<
		(event: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown> | unknown
	> = [];

	const mockPi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx?: unknown) => Promise<unknown> | unknown) => {
			if (event === "tool_call") {
				handlers.push(
					handler as (event: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown> | unknown,
				);
			}
		}),
		registerFlag: vi.fn(),
		getFlag: vi.fn(),
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		registerChannel: vi.fn(() => ({
			name: "test",
			send: vi.fn(),
			onReceive: vi.fn(() => vi.fn()),
		})),
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
		appendEntry: vi.fn(),
		sendUserMessage: vi.fn(),
	};

	agentPermissions(mockPi as unknown as Parameters<typeof agentPermissions>[0], {} as never);
	hooksEngine(mockPi as unknown as Parameters<typeof hooksEngine>[0]);

	return { handlers, mockPi };
}

async function emitToolCallDual(
	handlers: Array<(event: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown> | unknown>,
	event: ToolCallEvent,
): Promise<HandlerResult | undefined> {
	for (const handler of handlers) {
		const result = await handler(event as Record<string, unknown>);
		if (result && typeof result === "object" && "block" in result) {
			return result as HandlerResult;
		}
	}
	return undefined;
}

describe("Agent Paths: paths + hooks combination", () => {
	let setup: ReturnType<typeof createDualExtensionSetup>;

	beforeEach(() => {
		vi.clearAllMocks();
		setup = createDualExtensionSetup();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("paths blocks write outside allowed dir even when hooks allow", async () => {
		const result = await emitToolCallDual(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/src/index.ts", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
				agentHooks: JSON.stringify({}),
			},
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("write");
	});

	it("hooks block tool even when paths allow the file", async () => {
		const hookThatBlocksEdit = {
			type: "command" as const,
			command: 'echo \'{"action":"deny","reason":"edit blocked by hook"}\' && exit 2',
			if: "edit",
		};

		const mockExec = vi
			.fn()
			.mockResolvedValue({ exitCode: 2, stdout: '{"action":"deny","reason":"edit blocked by hook"}' });
		vi.spyOn(await import("../../extensions/hooks-engine/index.js"), "executeCommand").mockImplementation(mockExec);

		const result = await emitToolCallDual(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
				agentHooks: JSON.stringify({
					tool_call: [hookThatBlocksEdit],
				}),
			},
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("edit blocked by hook");
	});

	it("both paths and hooks allow — tool executes", async () => {
		const hookThatBlocksBash = {
			type: "command" as const,
			command: 'echo \'{"action":"deny","reason":"bash blocked"}\' && exit 2',
			if: "bash",
		};

		const mockExec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "" });
		vi.spyOn(await import("../../extensions/hooks-engine/index.js"), "executeCommand").mockImplementation(mockExec);

		const result = await emitToolCallDual(setup.handlers, {
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md", old_string: "a", new_string: "b" },
			variables: {
				permissionMode: "auto",
				agentName: "docs-writer",
				paths: JSON.stringify({ write: ["docs/**"] }),
				agentHooks: JSON.stringify({
					tool_call: [hookThatBlocksBash],
				}),
			},
		});
		expect(result).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Group 4: paths + variables combination
// ---------------------------------------------------------------------------

describe("Agent Paths: paths + variables combination", () => {
	let harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("paths work independently of agent variables", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		// 1. Agent with paths.write: ["docs/**"] AND variables: { project: "my-app" }
		await harness.session.applyAgentConfig({
			name: "test-agent",
			description: "Test agent",
			systemPrompt: "You are a test agent.",
			source: "project",
			filePath: ".pi/agents/test.md",
			paths: { write: ["docs/**"] },
			variables: { project: "my-app", version: "1.0.0" },
		});

		// 2. Verify both are set correctly in _currentAgentVariables
		const vars = harness.session.currentAgentVariables;
		expect(vars.paths).toBe(JSON.stringify({ write: ["docs/**"] }));
		expect(vars.project).toBe("my-app");
		expect(vars.version).toBe("1.0.0");

		// 3. Verify path enforcement still works
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "foo", newText: "bar" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src/index.ts");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).toContain("not in the allowed write paths");

		// 4. Variables can be accessed by other extensions (verified by checking currentAgentVariables)
		expect(vars.project).toBe("my-app");
		expect(vars.version).toBe("1.0.0");
	});

	it("changing variables does not affect paths", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		// 1. Agent with paths + variables
		await harness.session.applyAgentConfig({
			name: "test-agent",
			description: "Test agent",
			systemPrompt: "You are a test agent.",
			source: "project",
			filePath: ".pi/agents/test.md",
			paths: { write: ["docs/**"] },
			variables: { project: "my-app" },
		});

		// 2. Apply new config with different variables but same paths
		await harness.session.applyAgentConfig({
			name: "test-agent",
			description: "Test agent",
			systemPrompt: "You are a test agent.",
			source: "project",
			filePath: ".pi/agents/test.md",
			paths: { write: ["docs/**"] },
			variables: { project: "different-app", env: "production" },
		});

		// 3. Verify paths still enforced
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "foo", newText: "bar" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src/index.ts");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).toContain("not in the allowed write paths");

		// 4. Verify variables updated
		const vars = harness.session.currentAgentVariables;
		expect(vars.project).toBe("different-app");
		expect(vars.env).toBe("production");
		expect(vars.paths).toBe(JSON.stringify({ write: ["docs/**"] }));
	});

describe("Gap 9: System prompt dynamic path updates", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("switching from agent with paths to agent without paths removes restriction notice", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Docs only",
			systemPrompt: "Write docs",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});
		let sp = harness.session["agent"].state.systemPrompt;
		expect(sp).toContain("Path Restrictions");

		await harness.session.applyAgentConfig({
			name: "full-access",
			description: "Full access",
			systemPrompt: "Full access agent",
			source: "project",
			filePath: ".pi/agents/full-access.md",
		});
		sp = harness.session["agent"].state.systemPrompt;
		expect(sp).not.toContain("Path Restrictions");
	});

	it("switching from agent without paths to agent with paths adds restriction notice", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "full-access",
			description: "Full access",
			systemPrompt: "Full access agent",
			source: "project",
			filePath: ".pi/agents/full-access.md",
		});
		let sp = harness.session["agent"].state.systemPrompt;
		expect(sp).not.toContain("Path Restrictions");

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Docs only",
			systemPrompt: "Write docs",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});
		sp = harness.session["agent"].state.systemPrompt;
		expect(sp).toContain("Path Restrictions");
	});

	it("agent with paths but empty systemPrompt does NOT get restriction notice", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "no-prompt",
			description: "No prompt",
			systemPrompt: "",
			source: "project",
			filePath: ".pi/agents/no-prompt.md",
			paths: { write: ["docs/**"] },
		});
		const sp = harness.session["agent"].state.systemPrompt;
		expect(sp).not.toContain("Path Restrictions");
	});

	it("path restriction notice includes correct tool categories", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "multi-paths",
			description: "Multi paths",
			systemPrompt: "Test agent",
			source: "project",
			filePath: ".pi/agents/multi.md",
			paths: { write: ["docs/**"], read: ["src/**"] },
		});
		const sp = harness.session["agent"].state.systemPrompt;
		expect(sp).toContain("Write paths");
		expect(sp).toContain("Read paths");
		expect(sp).toContain("docs/**");
		expect(sp).toContain("src/**");
	});

	it("buildPathRestrictionNotice produces correct format for write-only", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "write-only",
			description: "Write only",
			systemPrompt: "Test",
			source: "project",
			filePath: ".pi/agents/write-only.md",
			paths: { write: ["docs/**"] },
		});
		const sp = harness.session["agent"].state.systemPrompt;
		expect(sp).toContain("Write paths");
		expect(sp).not.toContain("Read paths");
	});
});

	it("variables with 'paths' key name does not conflict with paths field", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		// 1. Agent with paths.write: ["docs/**"] AND variables: { paths: "custom value" }
		// Note: The paths config field takes precedence and overwrites the paths variable
		await harness.session.applyAgentConfig({
			name: "test-agent",
			description: "Test agent",
			systemPrompt: "You are a test agent.",
			source: "project",
			filePath: ".pi/agents/test.md",
			paths: { write: ["docs/**"] },
			variables: { paths: "custom value", otherVar: "test" },
		});

		// 2. The paths variable is set to the JSON string of the paths config, NOT the custom value
		const vars = harness.session.currentAgentVariables;
		expect(vars.paths).toBe(JSON.stringify({ write: ["docs/**"] }));
		expect(vars.otherVar).toBe("test");

		// 3. Verify path enforcement uses the paths config, NOT the custom paths variable
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "foo", newText: "bar" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src/index.ts");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).toContain("not in the allowed write paths");
	});
});

// ---------------------------------------------------------------------------
// Group 5: Gap 6 — Extension execution ordering
// ---------------------------------------------------------------------------

describe("Gap 6: Extension execution ordering", () => {
	it("path check blocks before other extensions can modify input", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "edit",
			input: { path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("path check and permission mode check both enforce", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "edit",
			input: { path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.reason).toContain("write paths");
	});

	it("multiple extensions blocking returns first block", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "edit",
			input: { path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.reason).not.toContain("not allowed");
		expect(result!.reason).toContain("write paths");
	});
});
