import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import autoSessionTitleExtension from "../../extensions/auto-session-title/index.js";
import type { ExtensionAPI, SessionEntry, TurnEndEvent } from "../../src/core/extensions/index.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
	const appendEntries: Array<{ type: string; data: unknown }> = [];
	let sessionName: string | undefined;

	const pi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "Fix authentication bug"),
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
		registerChannel: vi.fn(),
		registerTool: vi.fn(),
		appendEntry: vi.fn((type: string, data?: unknown) => {
			appendEntries.push({ type, data });
		}),
		sendUserMessage: vi.fn(),
		registerCommand: vi.fn(),
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		getSessionName: vi.fn(() => sessionName),
		setSessionName: vi.fn((name: string) => {
			sessionName = name;
		}),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		appendEntries,
	};
}

function testCtx(entries: SessionEntry[] = []) {
	return {
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "test-session-ast",
			getEntries: () => entries,
		},
		hasUI: true,
		ui: { notify: vi.fn() },
		cwd: tmpdir(),
	};
}

async function fireTurnEnd(
	mock: ReturnType<typeof createMockPi>,
	turnIndex: number,
	ctxOverrides?: Record<string, unknown>,
) {
	const entries: SessionEntry[] = ctxOverrides?.entries as SessionEntry[] ?? [
		{
			type: "message",
			message: {
				role: "user",
				content: "Help me fix the auth bug in login.ts",
			},
		} as SessionEntry,
	];

	for (const h of mock.handlers.turn_end ?? []) {
		await h(
			{ turnIndex } as TurnEndEvent,
			{ ...testCtx(entries), ...ctxOverrides },
		);
	}
}

describe("auto-session-title extension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registration", () => {
		it("registers turn_end handler", () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			expect(mock.handlers.turn_end).toBeDefined();
			expect(mock.handlers.turn_end!.length).toBe(1);
		});
	});

	describe("title generation trigger", () => {
		it("triggers on first user message (turnIndex 0)", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.callLLM).toHaveBeenCalledTimes(1);
			expect(mock.pi.setSessionName).toHaveBeenCalledWith("Fix authentication bug");
		});

		it("does not trigger on turnIndex > 0", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 1);

			expect(mock.pi.callLLM).not.toHaveBeenCalled();
			expect(mock.pi.setSessionName).not.toHaveBeenCalled();
		});

		it("skips if session already has a name", async () => {
			const mock = createMockPi();
			(mock.pi.getSessionName as ReturnType<typeof vi.fn>).mockReturnValue("Existing Name");
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.callLLM).not.toHaveBeenCalled();
		});

		it("skips if no user text found", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0, {
				entries: [
					{
						type: "message",
						message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
					},
				],
			});

			expect(mock.pi.callLLM).not.toHaveBeenCalled();
		});
	});

	describe("LLM call with correct prompt", () => {
		it("calls LLM with user message as content", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.callLLM).toHaveBeenCalledWith(
				expect.objectContaining({
					systemPrompt: expect.stringContaining("Generate a very short title"),
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: "user",
							content: "Help me fix the auth bug in login.ts",
						}),
					]),
					maxTokens: 30,
				}),
			);
		});

		it("handles string user content", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0, {
				entries: [
					{
						type: "message",
						message: { role: "user", content: "Simple string message" },
					},
				],
			});

			expect(mock.pi.callLLM).toHaveBeenCalledTimes(1);
		});
	});

	describe("title cleaning", () => {
		it("strips think tags from LLM output", async () => {
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
				"<think reasoning here>Actual Title</think\n>My Real Title",
			);
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.setSessionName).toHaveBeenCalledWith("My Real Title");
		});

		it("truncates long titles to 100 chars", async () => {
			const longTitle = "A".repeat(200);
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(longTitle);
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			const calledName = (mock.pi.setSessionName as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
			expect(calledName.length).toBeLessThanOrEqual(100);
		});

		it("takes first non-empty line of LLM output", async () => {
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue("\n  \nMy Title\nExtra line");
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.setSessionName).toHaveBeenCalledWith("My Title");
		});
	});

	describe("fallback when LLM fails", () => {
		it("silently ignores LLM errors", async () => {
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM unavailable"));
			autoSessionTitleExtension(mock.pi);

			await expect(fireTurnEnd(mock, 0)).resolves.toBeUndefined();

			expect(mock.pi.setSessionName).not.toHaveBeenCalled();
		});

		it("does not set name when LLM returns empty", async () => {
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockResolvedValue("   \n  \n  ");
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.setSessionName).not.toHaveBeenCalled();
		});
	});

	describe("skip on subsequent messages", () => {
		it("only triggers on first message", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);

			await fireTurnEnd(mock, 0);
			expect(mock.pi.callLLM).toHaveBeenCalledTimes(1);

			await fireTurnEnd(mock, 1);
			expect(mock.pi.callLLM).toHaveBeenCalledTimes(1);

			await fireTurnEnd(mock, 2);
			expect(mock.pi.callLLM).toHaveBeenCalledTimes(1);
		});
	});

	describe("appendEntry persistence", () => {
		it("persists generated title", async () => {
			const mock = createMockPi();
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.appendEntry).toHaveBeenCalledWith(
				"auto_session_title",
				expect.objectContaining({
					title: "Fix authentication bug",
					timestamp: expect.any(Number),
				}),
			);
		});

		it("does not persist when LLM fails", async () => {
			const mock = createMockPi();
			(mock.pi.callLLM as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
			autoSessionTitleExtension(mock.pi);
			await fireTurnEnd(mock, 0);

			expect(mock.pi.appendEntry).not.toHaveBeenCalled();
		});
	});
});
