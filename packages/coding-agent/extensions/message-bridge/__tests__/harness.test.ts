import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import messageBridgeExtension from "../index.ts";
import {
	createTestRuntime,
	createFakeContext,
	emit,
	type ExtensionTestRuntime,
} from "../../__shared__/testkit.ts";

// Mock global fetch — re-stubbed in beforeEach so every test gets a fresh mock
const fetchMock = vi.fn();

function setup(): ExtensionTestRuntime {
	const runtime = createTestRuntime();
	// Clear env vars to ensure deterministic test behavior
	delete process.env.MESSAGE_BRIDGE_URL;
	delete process.env.MESSAGE_BRIDGE_SESSION_ID;
	messageBridgeExtension(runtime.pi);
	return runtime;
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	delete process.env.MESSAGE_BRIDGE_URL;
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
	it("registers ui and agent_end event handlers", () => {
		const runtime = setup();
		expect(runtime.handlers["ui"]).toBeDefined();
		expect(runtime.handlers["agent_end"]).toBeDefined();
	});

	describe("ui handler — notify method", () => {
		it("pushes notify messages to bridge (fire-and-forget)", async () => {
			const runtime = setup();
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
			const runtime = setup();

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

	describe("ui handler — askUserQuestion method", () => {
		it("pushes question and pulls answer, then responds via ctx.respondUI", async () => {
			const runtime = setup();
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

			// Verify pull was called (source calls fetch(url) with no options arg)
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/pull/"),
			);
		});

		it("returns undefined for unknown ui methods", async () => {
			const runtime = setup();

			const results = await emit(runtime, "ui", {
				id: "ui-3",
				method: "someUnknownMethod",
			});

			expect(results[0]).toBeUndefined();
		});
	});

	describe("agent_end handler", () => {
		it("pushes assistant messages to bridge and injects user reply", async () => {
			const runtime = setup();
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
			const runtime = setup();

			await emit(runtime, "agent_end", {});

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips when no assistant messages", async () => {
			const runtime = setup();

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
			const runtime = setup();

			await emit(runtime, "agent_end", {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "   " }] },
				],
			});

			await new Promise((r) => setTimeout(r, 10));

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips sendUserMessage when pulled answer is empty", async () => {
			const runtime = setup();
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
			const runtime = setup();
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

	describe("BRIDGE_URL configuration", () => {
		it("uses default URL when env var not set", async () => {
			const runtime = setup();
			fetchMock
				.mockResolvedValueOnce(mockResponse({ id: "x", status: "ok" }))
				.mockResolvedValueOnce(mockResponse({ id: "x", answer: "" }));

			await emit(runtime, "agent_end", {
				messages: [{ role: "assistant", content: "text" }],
			});
			await new Promise((r) => setTimeout(r, 20));

			expect(fetchMock).toHaveBeenCalled();
			const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
			expect(calledUrl).toContain("message-bridge.docker.19930810.xyz");
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
});
