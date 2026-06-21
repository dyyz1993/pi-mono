import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import autoMemoryExtensionDefault, { type CallLLMFn, MemoryPrefetch } from "../../extensions/auto-memory/index.ts";
import { getEntrypointPath, getMemoryDir } from "../../extensions/auto-memory/utils.ts";
import type { ExtensionAPI } from "../../src/core/extensions/index.ts";

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `am-xml-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	const memoryDir = getMemoryDir(tempDir);
	if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
	if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function createMockPi() {
	const handlers: Record<string, ((...args: any[]) => any)[]> = {};
	const sentMessages: Array<{ customType: string; content: string; details?: unknown; display?: boolean }> = [];
	const appendedEntries: Array<{ customType: string; data?: unknown }> = [];

	const mockUI = {
		setStatus: vi.fn(),
		notify: vi.fn(),
	};
	const mockCtx = { ui: mockUI } as any;

	const mockChannel = {
		name: "memory",
		send: vi.fn(),
		onReceive: vi.fn(),
		invoke: vi.fn(),
	};

	const pi = {
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => JSON.stringify({ actions: [] })),
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerTool: vi.fn(),
		registerChannel: vi.fn(() => mockChannel),
		appendEntry: vi.fn((customType: string, data?: unknown) => {
			appendedEntries.push({ customType, data });
		}),
		sendMessage: vi.fn((msg: any) => {
			sentMessages.push(msg);
		}),
	} as unknown as ExtensionAPI;

	const emit = async <E extends string>(event: E, ...args: any[]) => {
		const fns = handlers[event] ?? [];
		let result: any;
		for (const fn of fns) {
			const eventArg = args.length > 0 ? args[0] : {};
			result = await fn(eventArg, mockCtx);
		}
		return result;
	};

	return { pi, emit, ctx: mockCtx, sentMessages, appendedEntries };
}

describe("auto-memory XML injection harness", () => {
	it("injects memory with XML wrapping on first context call", async () => {
		const { pi, emit, sentMessages } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "test query",
		});

		await new Promise((r) => setTimeout(r, 100));

		const result = await emit("context", {
			type: "context",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] as AgentMessage[],
		});

		expect(result).toBeDefined();
		expect(result.messages.length).toBe(2);

		const injectedText = result.messages[1].content[0].text;
		expect(injectedText).toContain("<memory_context");
		expect(injectedText).toContain('fingerprint="');
		expect(injectedText).toContain("<files");
		expect(injectedText).toContain("Content.");
		expect(injectedText).toContain("</memory_context>");

		expect(sentMessages.length).toBe(0);

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("does not persist memory messages when context is rebuilt repeatedly in one turn", async () => {
		const { pi, emit, sentMessages, appendedEntries } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "test query",
		});

		await new Promise((r) => setTimeout(r, 100));

		const originalMessages = [
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
		] as AgentMessage[];

		const first = await emit("context", { type: "context", messages: originalMessages });
		const second = await emit("context", { type: "context", messages: originalMessages });
		const third = await emit("context", { type: "context", messages: originalMessages });

		expect(first?.messages).toHaveLength(2);
		expect(second?.messages).toHaveLength(2);
		expect(third?.messages).toHaveLength(2);
		expect(sentMessages.length).toBe(0);
		expect(appendedEntries.some((entry) => entry.customType === "memory_relevant")).toBe(false);

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("skips injection when fingerprint matches existing memory in context", async () => {
		const { pi, emit, sentMessages } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "test query",
		});

		await new Promise((r) => setTimeout(r, 100));

		const fingerprint = "test.md|50";

		const existingMessages: AgentMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hi" }],
				timestamp: Date.now(),
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `<memory_context fingerprint="${fingerprint}">
<files count="1" source="auto-memory">
Content.
</files>
</memory_context>`,
					},
				],
				timestamp: Date.now(),
			},
		];

		const result = await emit("context", {
			type: "context",
			messages: existingMessages,
		});

		expect(result).toBeUndefined();
		expect(sentMessages.length).toBe(0);

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("re-injects after compaction removes existing memory", async () => {
		const { pi, emit, sentMessages } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "test query",
		});

		await new Promise((r) => setTimeout(r, 100));

		// First injection
		await emit("context", {
			type: "context",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] as AgentMessage[],
		});

		expect(sentMessages.length).toBe(0);

		// Simulate compaction — session_compact event
		await emit("session_compact", {
			type: "session_compact",
			compactionEntry: {
				type: "compaction",
				summary: "Previous conversation summarized",
				firstKeptEntryId: "new-id",
			},
		});

		// Next context call — messages no longer contain memory
		const result2 = await emit("context", {
			type: "context",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "[compaction summary] Previous conversation..." }],
					timestamp: Date.now(),
				},
			] as AgentMessage[],
		});

		expect(result2).toBeDefined();
		expect(result2.messages.length).toBe(2);
		expect(result2.messages[1].content[0].text).toContain("<memory_context");
		expect(sentMessages.length).toBe(0);

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("re-injects when fingerprint changes (different query)", async () => {
		const { pi, emit, sentMessages } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "a.md"), "---\nname: A\ntype: project\n---\nA content.");
		writeFileSync(join(memoryDir, "b.md"), "---\nname: B\ntype: project\n---\nB content.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["a.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "query about a",
		});

		await new Promise((r) => setTimeout(r, 100));

		const aFileContent = "---\nname: A\ntype: project\n---\nA content.";
		const formattedLength = `### a.md\n${aFileContent}`.length;
		const oldFingerprint = `a.md|${formattedLength}`;

		const existingMessages: AgentMessage[] = [
			{
				role: "user",
				content: [{ type: "text", text: "hi" }],
				timestamp: Date.now(),
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `<memory_context fingerprint="${oldFingerprint}">
<files count="1" source="auto-memory">
### a.md
${aFileContent}
</files>
</memory_context>`,
					},
				],
				timestamp: Date.now(),
			},
		];

		// New query selects different files
		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["b.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "query about b",
		});

		await new Promise((r) => setTimeout(r, 100));

		const result = await emit("context", {
			type: "context",
			messages: existingMessages,
		});

		expect(result).toBeDefined();
		expect(result.messages[result.messages.length - 1].content[0].text).toContain("B content.");
		expect(sentMessages.length).toBe(0);

		rmSync(memoryDir, { recursive: true, force: true });
	});
});
