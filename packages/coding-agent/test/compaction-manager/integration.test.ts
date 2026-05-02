import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it, vi } from "vitest";
import compactionManager from "../../extensions/compaction-manager/index.js";
import { microcompactMessages } from "../../extensions/compaction-manager/microcompact.js";
import { shouldForceCompact, shouldWarn } from "../../extensions/compaction-manager/reactive.js";
import { buildMemorySummary } from "../../extensions/compaction-manager/session-memory.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const commands: Record<string, any> = {};

	const pi = {
		on: vi.fn((event: string, handler: any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		registerCommand: vi.fn((name: string, options: any) => {
			commands[name] = options;
		}),
		registerTool: vi.fn(),
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		callLLM: vi.fn(),
		callLLMStructured: vi.fn(),
		forkAgent: vi.fn(),
		appendEntry: vi.fn(),
	} as any;

	return { pi, handlers, commands };
}

function createMockCtx(overrides?: Record<string, unknown>) {
	return {
		ui: { notify: vi.fn() },
		hasUI: true,
		cwd: "/test/project",
		getContextUsage: vi.fn(() => ({
			tokens: 100000,
			contextWindow: 200000,
			percent: 50,
		})),
		compact: vi.fn(),
		sessionManager: {},
		modelRegistry: {},
		...overrides,
	};
}

describe("compaction-manager integration", () => {
	it("all pure modules can be imported", () => {
		expect(microcompactMessages).toBeDefined();
		expect(buildMemorySummary).toBeDefined();
		expect(shouldWarn).toBeDefined();
		expect(shouldForceCompact).toBeDefined();
	});

	it("L1 + L3 pipeline works", () => {
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "old file content..." }],
				isError: false,
				timestamp: Date.now() - 120 * 60 * 1000,
			} as ToolResultMessage,
		];

		const microResult = microcompactMessages(messages, ["read", "bash"], 60 * 60 * 1000);
		expect(microResult).toBeDefined();

		const memoryFiles = new Map([
			["notes.md", "## Key Decision\n- Use React for the frontend framework\n- Use PostgreSQL for database"],
		]);
		const preparation = {
			firstKeptEntryId: "entry-1",
			tokensBefore: 100000,
			settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		};
		const smResult = buildMemorySummary(memoryFiles, preparation as any, 50);
		expect(smResult).toBeDefined();
		expect(smResult!.summary).toContain("React");

		expect(shouldWarn(160000, 200000, 75)).toBe(true);
		expect(shouldForceCompact(160000, 200000, 90)).toBe(false);
	});
});

describe("compaction-manager extension registration", () => {
	it("registers handlers for context, session_before_compact, turn_end, after_provider_response, agent_start", () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		expect(pi.on).toHaveBeenCalledWith("context", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("after_provider_response", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
	});

	it("registers compact-force command", () => {
		const { pi, commands } = createMockPi();
		compactionManager(pi);

		expect(pi.registerCommand).toHaveBeenCalledWith(
			"compact-force",
			expect.objectContaining({
				description: expect.any(String),
				handler: expect.any(Function),
			}),
		);
	});

	it("context handler clears old tool results", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const contextHandler = handlers.context[0];
		const oldTimestamp = Date.now() - 120 * 60 * 1000;
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "old file content" }],
				isError: false,
				timestamp: oldTimestamp,
			} as ToolResultMessage,
		];

		const ctx = createMockCtx();
		const result = await contextHandler({ type: "context", messages }, ctx);
		expect(result).toBeDefined();
		expect(result.messages).toHaveLength(1);
		expect((result.messages[0] as ToolResultMessage).content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("cleared") }),
		);
	});

	it("context handler returns undefined for recent messages", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const contextHandler = handlers.context[0];
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "recent content" }],
				isError: false,
				timestamp: Date.now() - 1000,
			} as ToolResultMessage,
		];

		const ctx = createMockCtx();
		const result = await contextHandler({ type: "context", messages }, ctx);
		expect(result).toBeUndefined();
	});

	it("turn_end handler warns at 75% usage", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const turnEndHandler = handlers.turn_end[0];
		const ctx = createMockCtx({
			getContextUsage: vi.fn(() => ({
				tokens: 160000,
				contextWindow: 200000,
				percent: 80,
			})),
		});

		await turnEndHandler({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Context high"), "info");
	});

	it("turn_end handler shows critical warning at 90% usage", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const turnEndHandler = handlers.turn_end[0];
		const ctx = createMockCtx({
			getContextUsage: vi.fn(() => ({
				tokens: 190000,
				contextWindow: 200000,
				percent: 95,
			})),
		});

		await turnEndHandler({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Context critical"), "warning");
	});

	it("turn_end handler does not warn when usage is low", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const turnEndHandler = handlers.turn_end[0];
		const ctx = createMockCtx({
			getContextUsage: vi.fn(() => ({
				tokens: 50000,
				contextWindow: 200000,
				percent: 25,
			})),
		});

		await turnEndHandler({}, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("agent_start resets warnedThisTurn flag", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const agentStartHandler = handlers.agent_start[0];
		const turnEndHandler = handlers.turn_end[0];

		const ctxHigh = createMockCtx({
			getContextUsage: vi.fn(() => ({
				tokens: 180000,
				contextWindow: 200000,
				percent: 90,
			})),
		});

		await turnEndHandler({}, ctxHigh);
		expect(ctxHigh.ui.notify).toHaveBeenCalledTimes(1);

		await agentStartHandler({}, createMockCtx());

		const ctxHigh2 = createMockCtx({
			getContextUsage: vi.fn(() => ({
				tokens: 180000,
				contextWindow: 200000,
				percent: 90,
			})),
		});
		await turnEndHandler({}, ctxHigh2);
		expect(ctxHigh2.ui.notify).toHaveBeenCalledTimes(1);
	});

	it("after_provider_response warns on 429", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const handler = handlers.after_provider_response[0];
		const ctx = createMockCtx();

		await handler({ status: 429 }, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Rate limited"), "warning");
	});

	it("after_provider_response warns on 5xx", async () => {
		const { pi, handlers } = createMockPi();
		compactionManager(pi);

		const handler = handlers.after_provider_response[0];
		const ctx = createMockCtx();

		await handler({ status: 503 }, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("server error"), "warning");
	});

	it("compact-force command triggers ctx.compact", async () => {
		const { pi, commands } = createMockPi();
		compactionManager(pi);

		const ctx = createMockCtx();
		await commands["compact-force"].handler("", ctx);

		expect(ctx.compact).toHaveBeenCalledWith(expect.objectContaining({ customInstructions: undefined }));
	});

	it("compact-force command passes custom instructions", async () => {
		const { pi, commands } = createMockPi();
		compactionManager(pi);

		const ctx = createMockCtx();
		await commands["compact-force"].handler("focus on architecture decisions", ctx);

		expect(ctx.compact).toHaveBeenCalledWith(
			expect.objectContaining({ customInstructions: "focus on architecture decisions" }),
		);
	});
});
