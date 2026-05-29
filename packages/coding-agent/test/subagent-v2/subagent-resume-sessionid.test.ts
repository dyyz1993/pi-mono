import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import subagentV2Extension, { resolveSessionPath } from "../../extensions/subagent-v2/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

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
			],
			projectAgentsDir: null,
		})),
	};
});

function createMockPi() {
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
			getSessionId: () => "test-session-resume",
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

describe("resolveSessionPath", () => {
	it("should find a session file by sessionId", () => {
		const testBase = join(tmpdir(), `pi-test-resolve-${Date.now()}`);
		const sessionId = `test-resolve-session-${Date.now()}`;
		const sessionDir = join(testBase, sessionId);
		mkdirSync(sessionDir, { recursive: true });
		const sessionFile = join(sessionDir, `${sessionId}.jsonl`);
		writeFileSync(sessionFile, '{"type":"message"}\n');

		const result = resolveSessionPath(sessionId, testBase);
		expect(result).toBe(sessionFile);

		rmSync(testBase, { recursive: true, force: true });
	});

	it("should return null for nonexistent sessionId", () => {
		const testBase = join(tmpdir(), `pi-test-resolve-missing-${Date.now()}`);
		const result = resolveSessionPath("nonexistent-session-xyz", testBase);
		expect(result).toBeNull();
	});
});

describe("subagent_resume sessionId resolution", () => {
	let mock: ReturnType<typeof createMockPi>;

	beforeEach(() => {
		mock = createMockPi();
		subagentV2Extension(mock.pi);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should return error when sessionId cannot be resolved", async () => {
		const tool = mock.registeredTools.get("subagent_resume") as {
			execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
		};

		const result = (await tool.execute(
			"tc_resolve_missing",
			{ sessionId: "nonexistent-session-id" },
			undefined,
			undefined,
			testCtx(),
		)) as {
			content: Array<{ type: string; text: string }>;
		};

		expect(result.content[0].text).toContain("Session file not found");
	});

	it("should still work when sessionPath is provided directly", async () => {
		const tool = mock.registeredTools.get("subagent_resume") as {
			execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
		};

		const result = (await tool.execute(
			"tc_direct_path",
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

	it("should return error when neither sessionId nor sessionPath provided", async () => {
		const tool = mock.registeredTools.get("subagent_resume") as {
			execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
		};

		const result = (await tool.execute("tc_no_params", {}, undefined, undefined, testCtx())) as {
			content: Array<{ type: string; text: string }>;
		};

		expect(result.content[0].text).toContain("Either sessionId or sessionPath is required");
	});
});
