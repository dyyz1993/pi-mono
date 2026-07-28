import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionContext } from "@dyyz1993/pi-coding-agent";
import {
	createTestRuntime,
	createFakeContext,
	emit,
	type ExtensionTestRuntime,
} from "../../__shared__/testkit.ts";

// Mock global fetch — re-stubbed in beforeEach so every test gets a fresh mock
const fetchMock = vi.fn();

async function setup(): Promise<ExtensionTestRuntime> {
	const runtime = createTestRuntime();
	// Set a test bridge URL (no default URL is baked into the extension anymore).
	// BRIDGE_URL is computed at module load, so we must resetModules + re-import
	// to pick up the env var.
	process.env.MESSAGE_BRIDGE_URL = "http://test-bridge:8080";
	delete process.env.MESSAGE_BRIDGE_SESSION_ID;
	vi.resetModules();
	const mod = await import("../index.ts");
	mod.default(runtime.pi);
	return runtime;
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	process.env.MESSAGE_BRIDGE_URL = "http://test-bridge:8080";
	delete process.env.MESSAGE_BRIDGE_SESSION_ID;
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.MESSAGE_BRIDGE_URL;
	delete process.env.MESSAGE_BRIDGE_SESSION_ID;
});

/** Create a mock fetch response. */
function mockResponse(body: unknown, ok = true): Response {
	return {
		ok,
		status: ok ? 200 : 500,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as Response;
}

describe("message-bridge extension", () => {
	it("registers ui and agent_end event handlers", async () => {
		const runtime = await setup();
		expect(runtime.handlers["ui"]).toBeDefined();
		expect(runtime.handlers["agent_end"]).toBeDefined();
	});

	describe("ui handler — notify method", () => {
		it("pushes notify messages to bridge (fire-and-forget)", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-1", status: "ok" })) // push
				.mockResolvedValueOnce(mockResponse({ id: "msg-1", answer: "ack" })); // pull

			await emit(runtime, "ui", {
				id: "ui-1",
				method: "notify",
				message: "Build complete",
			});

			// Wait for fire-and-forget async
			await new Promise((r) => setTimeout(r, 10));

			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/push"),
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("skips notify when message is null", async () => {
			const runtime = await setup();

			await emit(runtime, "ui", {
				id: "ui-1",
				method: "notify",
				message: null,
			});

			// Wait for any potential async
			await new Promise((r) => setTimeout(r, 10));

			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("ui handler — askUserQuestion method", async () => {
		it("pushes question and pulls answer, then responds via ctx.respondUI", async () => {
			const runtime = await setup();
			const ctx = createFakeContext();
			const fakeAnswer = { action: "responded", answers: { q1: { selected: ["a"] } } };

			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", status: "ok" })) // push
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", answer: fakeAnswer })); // pull

			await emit(runtime, "ui", {
				id: "ui-2",
				method: "askUserQuestion",
				title: "Choose",
				questions: [{ id: "q1", header: "Q1", question: "Which?", options: [{ label: "a" }, { label: "b" }] }],
				timeout: 5000,
				toolCallId: "tc-1",
			}, ctx);

			// Wait for async push+pull
			await new Promise((r) => setTimeout(r, 10));

			// Verify push was called with the question payload
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/push"),
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("askUserQuestion"),
				}),
			);

			// Verify pull was called (pullAnswer now passes { signal } for timeout)
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/pull/"),
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
		});


		it("returns undefined for unknown ui methods", async () => {
			const runtime = await setup();

			const results = await emit(runtime, "ui", {
				id: "ui-3",
				method: "someUnknownMethod",
			});

			expect(results[0]).toBeUndefined();
		});
	});

	describe("agent_end handler", async () => {
		it("pushes assistant messages to bridge and injects user reply", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-3", status: "ok" })) // push
				.mockResolvedValueOnce(mockResponse({ id: "msg-3", answer: "continue please" })); // pull

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "user", content: "hello" },
					{ role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
				],
			});

			// Wait for async push+pull+sendUserMessage
			await new Promise((r) => setTimeout(r, 20));

			// Verify push was called with assistant text
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/push"),
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("Hi there!"),
				}),
			);

			// Verify sendUserMessage was called with the pulled answer
			expect(runtime.sendUserMessage).toHaveBeenCalledWith("continue please");
		});

		it("skips when no messages in event", async () => {
			const runtime = await setup();

			await emit(runtime, "agent_end", {});

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips when no assistant messages", async () => {
			const runtime = await setup();

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "user", content: "hello" },
				],
			});

			// Wait for any potential async
			await new Promise((r) => setTimeout(r, 10));

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips when assistant message has empty text", async () => {
			const runtime = await setup();

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "   " }] },
				],
			});

			await new Promise((r) => setTimeout(r, 10));

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips sendUserMessage when pulled answer is empty", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-4", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "msg-4", answer: "" }));

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "response" }] },
				],
			});

			await new Promise((r) => setTimeout(r, 20));

			expect(runtime.sendUserMessage).not.toHaveBeenCalled();
		});

		it("handles string content in assistant messages", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-5", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "msg-5", answer: "" }));

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "assistant", content: "plain string response" },
				],
			});

			await new Promise((r) => setTimeout(r, 20));

			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/push"),
				expect.objectContaining({
					body: expect.stringContaining("plain string response"),
				}),
			);
		});
	});

	describe("BRIDGE_URL configuration", async () => {
		it("uses configured MESSAGE_BRIDGE_URL for requests", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "" }));

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(fetchMock).toHaveBeenCalled();
			const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
			expect(calledUrl).toContain("test-bridge:8080");
		});

		it("skips fetch and logs error when MESSAGE_BRIDGE_URL is not set", async () => {
			// Force unset URL — extension should throw at push time, error is
			// logged via logError, fetch never called.
			delete process.env.MESSAGE_BRIDGE_URL;
			vi.resetModules();
			const mod = await import("../index.ts");
			const runtime = createTestRuntime();
			mod.default(runtime.pi);
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(fetchMock).not.toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] push failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});

		it("uses MESSAGE_BRIDGE_URL env var when set", async () => {
			// BRIDGE_URL is computed at module load, so we must resetModules + re-import
			vi.resetModules();
			process.env.MESSAGE_BRIDGE_URL = "http://custom-bridge:9000";
			const mod = await import("../index.ts");
			const runtime = createTestRuntime();
			mod.default(runtime.pi);

			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "" }));

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(fetchMock).toHaveBeenCalled();
			const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
			expect(calledUrl).toContain("custom-bridge:9000");
		});
	});

	describe("error handling and reliability (P1)", async () => {
		it("logs push failure when fetch rejects (network down)", async () => {
			const runtime = await setup();
			fetchMock.mockRejectedValueOnce(new Error("network down"));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] push failed"),
				expect.anything(),
			);
			expect(runtime.sendUserMessage).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("logs push failure when push response is not ok", async () => {
			const runtime = await setup();
			fetchMock.mockResolvedValueOnce(mockResponse({ id: "x" }, false));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] push failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});

		it("logs failure when pull rejects after a successful push", async () => {
			const runtime = await setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" })) // push ok
				.mockRejectedValueOnce(new Error("pull network error")); // pull fails
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			// Current implementation funnels pull errors through the "push" stage
			// label because the agent_end handler chains .catch at the end.
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] push failed"),
				expect.anything(),
			);
			expect(runtime.sendUserMessage).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("does not log when sendUserMessage throws a stale error synchronously", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() => {
				throw new Error("stale request: session already advanced");
			});
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "reply" }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(runtime.sendUserMessage).toHaveBeenCalledWith("reply");
			expect(errorSpy).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("logs sendUserMessage failure when it throws a non-stale error synchronously", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() => {
				throw new Error("boom: agent unavailable");
			});
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "reply" }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] sendUserMessage failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});

		it("does not log when sendUserMessage returns a rejected Promise with a stale error", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() =>
				Promise.reject(new Error("stale turn: cannot send")),
			);
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "reply" }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			// Wait extra ticks for the Promise.reject to propagate through .catch
			await new Promise((r) => setTimeout(r, 30));

			expect(runtime.sendUserMessage).toHaveBeenCalledWith("reply");
			expect(errorSpy).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("logs sendUserMessage failure when it returns a rejected Promise with a non-stale error", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() =>
				Promise.reject(new Error("agent crashed")),
			);
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "reply" }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 30));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] sendUserMessage failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});

		it("does not log when respondUI throws a stale error", async () => {
			const runtime = await setup();
			const ctx = createFakeContext({
				respondUI: vi.fn(() => {
					throw new Error("stale UI event");
				}) as unknown as ExtensionContext["respondUI"],
			});
			const fakeAnswer = { action: "responded", answers: { q1: { selected: ["a"] } } };
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", answer: fakeAnswer }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "ui", {
				id: "ui-stale",
				method: "askUserQuestion",
				questions: [{ id: "q1", header: "Q1", question: "Which?", options: [{ label: "a" }] }],
			}, ctx);
			await new Promise((r) => setTimeout(r, 20));

			expect(ctx.respondUI).toHaveBeenCalledWith("ui-stale", fakeAnswer);
			expect(errorSpy).not.toHaveBeenCalled();
			errorSpy.mockRestore();
		});

		it("logs respondUI failure when it throws a non-stale error", async () => {
			const runtime = await setup();
			const ctx = createFakeContext({
				respondUI: vi.fn(() => {
					throw new Error("respondUI internal error");
				}) as unknown as ExtensionContext["respondUI"],
			});
			const fakeAnswer = { action: "responded", answers: { q1: { selected: ["a"] } } };
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "msg-2", answer: fakeAnswer }));
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await emit(runtime, "ui", {
				id: "ui-bad",
				method: "askUserQuestion",
				questions: [{ id: "q1", header: "Q1", question: "Which?", options: [{ label: "a" }] }],
			}, ctx);
			await new Promise((r) => setTimeout(r, 20));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] respondUI failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});

		it("concurrent agent_end events do not interfere with each other", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() => undefined);
			// Route by URL + body so concurrent fetch ordering doesn't matter
			fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
				if (url.endsWith("/push")) {
					const body = JSON.parse((init?.body as string) ?? "{}");
					const q = body.question as string;
					if (q === "A") return mockResponse({ id: "a1", status: "ok" });
					if (q === "B") return mockResponse({ id: "b2", status: "ok" });
					return mockResponse({ id: "unknown", status: "ok" });
				}
				if (url.includes("/pull/")) {
					const id = url.split("/pull/")[1];
					if (id === "a1") return mockResponse({ id, answer: "answer-a" });
					if (id === "b2") return mockResponse({ id, answer: "answer-b" });
					return mockResponse({ id, answer: "" });
				}
				return mockResponse({}, false);
			});

			// Fire both events back-to-back without awaiting in between
			await Promise.all([
				emit(runtime, "agent_end", {
					messages: [{ role: "assistant", content: "A" }],
				}),
				emit(runtime, "agent_end", {
					messages: [{ role: "assistant", content: "B" }],
				}),
			]);
			await new Promise((r) => setTimeout(r, 30));

			// Both round-trips should complete and sendUserMessage should have
			// been called with each answer exactly once.
			expect(runtime.sendUserMessage).toHaveBeenCalledTimes(2);
			expect(runtime.sendUserMessage).toHaveBeenCalledWith("answer-a");
			expect(runtime.sendUserMessage).toHaveBeenCalledWith("answer-b");

			// Verify each push carried the correct payload
			const pushBodies = fetchMock.mock.calls
				.filter((c) => (c[0] as string).includes("/push"))
				.map((c) => JSON.parse((c[1] as RequestInit).body as string).question);
			expect(pushBodies).toEqual(expect.arrayContaining(["A", "B"]));
		});

		it("handles mixed fetch outcomes across concurrent events", async () => {
			const runtime = await setup();
			runtime.sendUserMessage.mockImplementation(() => undefined);
			// Event A: push ok, pull ok -> sendUserMessage called
			// Event B: push rejects -> logged, no sendUserMessage
			// Event C: push ok, pull ok, empty answer -> no sendUserMessage
			fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
				if (url.endsWith("/push")) {
					const body = JSON.parse((init?.body as string) ?? "{}");
					const q = body.question as string;
					if (q === "B") throw new Error("network down");
					if (q === "A") return mockResponse({ id: "a", status: "ok" });
					if (q === "C") return mockResponse({ id: "c", status: "ok" });
					return mockResponse({ id: "unknown", status: "ok" });
				}
				if (url.includes("/pull/")) {
					const id = url.split("/pull/")[1];
					if (id === "a") return mockResponse({ id, answer: "ok-a" });
					if (id === "c") return mockResponse({ id, answer: "" });
					return mockResponse({ id, answer: "" });
				}
				return mockResponse({}, false);
			});
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			await Promise.all([
				emit(runtime, "agent_end", { messages: [{ role: "assistant", content: "A" }] }),
				emit(runtime, "agent_end", { messages: [{ role: "assistant", content: "B" }] }),
				emit(runtime, "agent_end", { messages: [{ role: "assistant", content: "C" }] }),
			]);
			await new Promise((r) => setTimeout(r, 30));

			// Only event A produced a sendUserMessage call
			expect(runtime.sendUserMessage).toHaveBeenCalledTimes(1);
			expect(runtime.sendUserMessage).toHaveBeenCalledWith("ok-a");
			// Event B's push failure was logged
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("[message-bridge] push failed"),
				expect.anything(),
			);
			errorSpy.mockRestore();
		});
	});
});
