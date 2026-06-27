import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import autoMemoryExtensionDefault, { type CallLLMFn, MemoryPrefetch } from "../../extensions/auto-memory/index.ts";
import { MEMORY_SYSTEM_PROMPT } from "../../extensions/auto-memory/prompts.ts";
import { getEntrypointPath, getMemoryDir } from "../../extensions/auto-memory/utils.ts";
import type { ExtensionAPI } from "../../src/core/extensions/index.ts";

let tempDir: string;
let previousRemoteToolProxyEnv: string | undefined;
let previousAgentDirEnv: string | undefined;

beforeEach(() => {
	previousRemoteToolProxyEnv = process.env.PI_REMOTE_SSH_TOOL_PROXY;
	previousAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
	delete process.env.PI_REMOTE_SSH_TOOL_PROXY;
	delete process.env.PI_CODING_AGENT_DIR;
	tempDir = join(tmpdir(), `am-xml-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	const memoryDir = getMemoryDir(tempDir);
	if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
	if (previousRemoteToolProxyEnv === undefined) {
		delete process.env.PI_REMOTE_SSH_TOOL_PROXY;
	} else {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = previousRemoteToolProxyEnv;
	}
	if (previousAgentDirEnv === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDirEnv;
	}
	if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function createMockPi(options: { sessionDataDir?: string } = {}) {
	const handlers: Record<string, ((...args: any[]) => any)[]> = {};
	const sentMessages: Array<{ customType: string; content: string; details?: unknown; display?: boolean }> = [];
	const appendedEntries: Array<{ customType: string; data?: unknown }> = [];
	const registeredTools: any[] = [];

	const mockUI = {
		setStatus: vi.fn(),
		notify: vi.fn(),
	};
	const mockCtx = { ui: mockUI, sessionDataDir: options.sessionDataDir ?? join(tempDir, "session-data") } as any;

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
		registerTool: vi.fn((tool: any) => {
			registeredTools.push(tool);
		}),
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

	return { pi, emit, ctx: mockCtx, sentMessages, appendedEntries, registeredTools };
}

describe("auto-memory storage paths", () => {
	it("stores memories under the legacy homedir-scoped agent root", () => {
		const agentDir = join(tempDir, "remote-agent-dir");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const memoryDir = getMemoryDir(tempDir);

		expect(memoryDir.startsWith(join(agentDir, "memory"))).toBe(false);
		expect(memoryDir).toContain(join(".pi", "agent", "memory"));
	});
});

describe("auto-memory XML injection harness", () => {
	it("disables model-visible memory tools and injection in SSH tool-proxy mode", async () => {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = "1";
		const { pi, emit, registeredTools, appendedEntries } = createMockPi();
		autoMemoryExtensionDefault(pi);

		expect(registeredTools.map((tool) => tool.name)).not.toContain("save_memory");
		expect(registeredTools.map((tool) => tool.name)).not.toContain("create_bookmark");

		await emit("session_start");
		const beforeResult = await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "please remember this",
		});
		const contextResult = await emit("context", {
			type: "context",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] as AgentMessage[],
		});

		expect(beforeResult).toBeUndefined();
		expect(contextResult).toBeUndefined();
		expect(appendedEntries).toEqual([]);
		expect(pi.registerChannel).toHaveBeenCalledWith("memory");
	});

	it("documents the legacy filesystem-based save flow in the system prompt", () => {
		const prompt = MEMORY_SYSTEM_PROMPT("/runtime-owned/memory", "");

		expect(prompt).toContain("/runtime-owned/memory");
		expect(prompt).toContain("Step 1 — Write memory file");
		expect(prompt).toContain("Step 2 — Add pointer in MEMORY.md");
		expect(prompt).not.toContain("Use the save_memory tool");
	});

	it("does not expose physical memory paths in model-visible save events", async () => {
		const { pi, registeredTools, appendedEntries } = createMockPi();
		autoMemoryExtensionDefault(pi);

		const saveMemory = registeredTools.find((tool) => tool.name === "save_memory");
		expect(saveMemory).toBeDefined();

		const result = await saveMemory.execute("tool-call", {
			name: "ssh-remote-verification-flow",
			description: "SSH remote project testing preference",
			type: "feedback",
			content: "Confirm hostname, then pwd before remote operations.",
		});

		expect(result.content[0].text).toContain("Memory saved:");
		expect(result.details).toEqual({ filename: expect.stringMatching(/ssh-remote-verification-flow.*\.md/) });
		expect(JSON.stringify(result)).not.toContain("filePath");
		expect(JSON.stringify(appendedEntries.filter((entry) => entry.customType === "memory_created"))).not.toContain(
			"filePath",
		);

		const memoryDir = getMemoryDir(process.cwd());
		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("does not log the physical memory directory in prefetch custom entries", async () => {
		const { pi, emit, appendedEntries } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");
		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "where is the memory path?",
		});

		const prefetchEntry = appendedEntries.find((entry) => entry.customType === "memory_prefetch");
		expect(prefetchEntry).toBeDefined();
		expect(JSON.stringify(prefetchEntry)).not.toContain("memoryDir");
		expect(JSON.stringify(prefetchEntry)).not.toContain(getMemoryDir(process.cwd()));
	});

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

	it("orders prefetch result before memory injection when context races prefetch completion", async () => {
		const { pi, emit, appendedEntries } = createMockPi();
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

		const result = await emit("context", {
			type: "context",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] as AgentMessage[],
		});

		expect(result?.messages).toHaveLength(2);
		expect(appendedEntries.map((entry) => entry.customType)).toEqual([
			"memory_prefetch",
			"memory_prefetch_result",
			"memory_inject",
		]);

		const [prefetchEntry, resultEntry, injectEntry] = appendedEntries;
		const prefetchData = prefetchEntry.data as Record<string, unknown>;
		const resultData = resultEntry.data as Record<string, unknown>;
		const injectData = injectEntry.data as Record<string, unknown>;
		expect(prefetchData.operationId).toBe(resultData.operationId);
		expect(resultData.operationId).toBe(injectData.operationId);
		expect(prefetchData.phase).toBe("prefetch_started");
		expect(resultData.phase).toBe("prefetch_result");
		expect(injectData.phase).toBe("inject");
		expect(prefetchData.phaseOrder).toBe(1);
		expect(resultData.phaseOrder).toBe(2);
		expect(injectData.phaseOrder).toBe(3);
		expect(typeof prefetchData.occurredAt).toBe("number");
		expect(typeof resultData.occurredAt).toBe("number");
		expect(typeof injectData.occurredAt).toBe("number");
		expect(resultData.occurredAt as number).toBeGreaterThanOrEqual(prefetchData.occurredAt as number);
		expect(injectData.occurredAt as number).toBeGreaterThanOrEqual(resultData.occurredAt as number);

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
		expect(second).toBeUndefined();
		expect(third).toBeUndefined();
		expect(sentMessages.length).toBe(0);
		expect(appendedEntries.some((entry) => entry.customType === "memory_relevant")).toBe(false);
		expect(appendedEntries.filter((entry) => entry.customType === "memory_inject")).toHaveLength(1);

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("remembers injected memory fingerprints across session restart", async () => {
		const sessionDataDir = join(tempDir, "persisted-session-data");
		const firstRuntime = createMockPi({ sessionDataDir });
		autoMemoryExtensionDefault(firstRuntime.pi);

		await firstRuntime.emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(firstRuntime.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			JSON.stringify({ selected: ["test.md"] }),
		);

		await firstRuntime.emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "first query",
		});
		const first = await firstRuntime.emit("context", {
			type: "context",
			messages: [
				{ role: "user", content: [{ type: "text", text: "first" }], timestamp: Date.now() },
			] as AgentMessage[],
		});

		expect(first?.messages).toHaveLength(2);
		expect(firstRuntime.appendedEntries.filter((entry) => entry.customType === "memory_inject")).toHaveLength(1);

		await new Promise((r) => setTimeout(r, 50));

		const secondRuntime = createMockPi({ sessionDataDir });
		autoMemoryExtensionDefault(secondRuntime.pi);
		(secondRuntime.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			JSON.stringify({ selected: ["test.md"] }),
		);

		await secondRuntime.emit("session_start");
		await secondRuntime.emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "second query after restart",
		});
		const second = await secondRuntime.emit("context", {
			type: "context",
			messages: [
				{ role: "user", content: [{ type: "text", text: "first" }], timestamp: Date.now() },
				{ role: "assistant", content: [{ type: "text", text: "first response" }], timestamp: Date.now() },
				{ role: "user", content: [{ type: "text", text: "second" }], timestamp: Date.now() },
			] as AgentMessage[],
		});

		expect(second).toBeUndefined();
		const restartInjectEntries = secondRuntime.appendedEntries.filter(
			(entry) => entry.customType === "memory_inject",
		);
		expect(restartInjectEntries).toHaveLength(1);
		expect(restartInjectEntries[0].data).toMatchObject({
			skipped: true,
			alreadyInjected: true,
			skipReason: "already_in_session",
			injectedBytes: 0,
		});

		rmSync(memoryDir, { recursive: true, force: true });
	});

	it("does not re-inject the same memory fingerprint on later turns when the prior injection was transient", async () => {
		const { pi, emit, appendedEntries } = createMockPi();
		autoMemoryExtensionDefault(pi);

		await emit("session_start");

		const memoryDir = getMemoryDir(process.cwd());
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(join(memoryDir, "test.md"), "---\nname: T\ntype: project\n---\nContent.");

		(pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({ selected: ["test.md"] }));

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "first query",
		});
		const first = await emit("context", {
			type: "context",
			messages: [
				{ role: "user", content: [{ type: "text", text: "first" }], timestamp: Date.now() },
			] as AgentMessage[],
		});
		expect(first?.messages).toHaveLength(2);
		expect(first.messages[1].content[0].text).toContain("<memory_context");

		await emit("before_agent_start", {
			type: "before_agent_start",
			systemPrompt: "base",
			prompt: "second query",
		});
		const second = await emit("context", {
			type: "context",
			messages: [
				{ role: "user", content: [{ type: "text", text: "first" }], timestamp: Date.now() },
				{ role: "assistant", content: [{ type: "text", text: "first response" }], timestamp: Date.now() },
				{ role: "user", content: [{ type: "text", text: "second" }], timestamp: Date.now() },
			] as AgentMessage[],
		});

		expect(second).toBeUndefined();
		const injectEntries = appendedEntries.filter((entry) => entry.customType === "memory_inject");
		expect(injectEntries).toHaveLength(2);
		expect((injectEntries[0].data as Record<string, unknown>).skipped).not.toBe(true);
		expect((injectEntries[0].data as Record<string, unknown>).alreadyInjected).not.toBe(true);
		expect(injectEntries[1].data).toMatchObject({
			skipped: true,
			alreadyInjected: true,
			skipReason: "already_in_session",
			injectedBytes: 0,
		});

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
