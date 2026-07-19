import { describe, expect, it, vi } from "vitest";
import autoSessionTitle from "../index.ts";
import {
	createTestRuntime,
	createFakeContext,
	emit,
	type ExtensionTestRuntime,
} from "../../__shared__/testkit.ts";

function setup(getSessionNameReturn: string | undefined = undefined): ExtensionTestRuntime {
	const runtime = createTestRuntime();
	runtime.getSessionNameReturn = getSessionNameReturn;
	autoSessionTitle(runtime.pi);
	return runtime;
}

/** Create a mock SessionEntry that looks like a user message. */
function makeUserEntry(text: string) {
	return {
		type: "message",
		message: { role: "user", content: [{ type: "text", text }] },
	};
}

/** Create a mock SessionEntry that looks like an assistant message. */
function makeAssistantEntry(text: string) {
	return {
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text }] },
	};
}

describe("auto-session-title extension", () => {
	it("registers a turn_end handler", () => {
		const runtime = setup();
		expect(runtime.handlers["turn_end"]).toBeDefined();
		expect(runtime.handlers["turn_end"]).toHaveLength(1);
	});

	it("generates and sets session title on first turn_end (turnIndex === 0)", async () => {
		const runtime = setup();
		runtime.callLLM.mockResolvedValue("Fix login bug");

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("fix the login bug")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.callLLM).toHaveBeenCalledWith(expect.objectContaining({
			systemPrompt: expect.stringContaining("Generate a very short title"),
			messages: [{ role: "user", content: "fix the login bug" }],
			maxTokens: 30,
		}));
		expect(runtime.setSessionName).toHaveBeenCalledWith("Fix login bug");
		expect(runtime.appendEntry).toHaveBeenCalledWith(
			"auto_session_title",
			expect.objectContaining({ title: "Fix login bug" }),
		);
	});

	it("skips when turnIndex > 0", async () => {
		const runtime = setup();
		const ctx = createFakeContext();

		await emit(runtime, "turn_end", { turnIndex: 1 }, ctx);

		expect(runtime.callLLM).not.toHaveBeenCalled();
		expect(runtime.setSessionName).not.toHaveBeenCalled();
	});

	it("skips when session already has a name", async () => {
		const runtime = setup("Existing Name");
		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("hello")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.callLLM).not.toHaveBeenCalled();
		expect(runtime.setSessionName).not.toHaveBeenCalled();
	});

	it("skips when first user message is empty", async () => {
		const runtime = setup();
		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeAssistantEntry("hi")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.callLLM).not.toHaveBeenCalled();
	});

	it("handles string content in user messages", async () => {
		const runtime = setup();
		runtime.callLLM.mockResolvedValue("Test title");

		const ctx = createFakeContext({
			sessionManager: {
				getEntries: () => [{
					type: "message",
					message: { role: "user", content: "plain string content" },
				}],
			} as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.callLLM).toHaveBeenCalledWith(expect.objectContaining({
			messages: [{ role: "user", content: "plain string content" }],
		}));
	});

	it("cleans think tags from LLM output", async () => {
		const runtime = setup();
		runtime.callLLM.mockResolvedValue("<think>reasoning here</think>Actual Title");

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("test")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.setSessionName).toHaveBeenCalledWith("Actual Title");
	});

	it("truncates long titles to 100 characters", async () => {
		const runtime = setup();
		const longTitle = "A".repeat(200);
		runtime.callLLM.mockResolvedValue(longTitle);

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("test")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		const calledTitle = (runtime.setSessionName as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
		expect(calledTitle.length).toBeLessThanOrEqual(100);
	});

	it("takes first non-empty line of LLM output", async () => {
		const runtime = setup();
		runtime.callLLM.mockResolvedValue("First Line\nSecond Line\nThird Line");

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("test")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.setSessionName).toHaveBeenCalledWith("First Line");
	});

	it("silently ignores LLM failures (does not throw)", async () => {
		const runtime = setup();
		runtime.callLLM.mockRejectedValue(new Error("LLM unavailable"));

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("test")] } as never,
		});

		// Should not throw
		await expect(emit(runtime, "turn_end", { turnIndex: 0 }, ctx)).resolves.toBeDefined();
		expect(runtime.setSessionName).not.toHaveBeenCalled();
	});

	it("does not set title when cleaned title is empty", async () => {
		const runtime = setup();
		runtime.callLLM.mockResolvedValue("<think>all thinking</think>");

		const ctx = createFakeContext({
			sessionManager: { getEntries: () => [makeUserEntry("test")] } as never,
		});

		await emit(runtime, "turn_end", { turnIndex: 0 }, ctx);

		expect(runtime.setSessionName).not.toHaveBeenCalled();
	});
});
