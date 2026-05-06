import { type AssistantMessage, type AssistantMessageEvent, type Model, parseStreamingJson } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import type { ProxyAssistantMessageEvent } from "../src/proxy.js";

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createPartial(): AssistantMessage {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [],
		api: "openai-chat",
		provider: "openai",
		model: "test-model",
		usage: createUsage(),
		timestamp: Date.now(),
	};
}

function createModel(): Model<"openai-chat"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-chat",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function processProxyEvent(
	proxyEvent: ProxyAssistantMessageEvent,
	partial: AssistantMessage,
): AssistantMessageEvent | undefined {
	switch (proxyEvent.type) {
		case "start":
			return { type: "start", partial };

		case "text_start":
			partial.content[proxyEvent.contentIndex] = { type: "text", text: "" };
			return { type: "text_start", contentIndex: proxyEvent.contentIndex, partial };

		case "text_delta": {
			const content = partial.content[proxyEvent.contentIndex];
			if (content?.type === "text") {
				content.text += proxyEvent.delta;
				return {
					type: "text_delta",
					contentIndex: proxyEvent.contentIndex,
					delta: proxyEvent.delta,
					partial,
				};
			}
			throw new Error("Received text_delta for non-text content");
		}

		case "text_end": {
			const content = partial.content[proxyEvent.contentIndex];
			if (content?.type === "text") {
				content.textSignature = proxyEvent.contentSignature;
				return {
					type: "text_end",
					contentIndex: proxyEvent.contentIndex,
					content: content.text,
					partial,
				};
			}
			throw new Error("Received text_end for non-text content");
		}

		case "thinking_start":
			partial.content[proxyEvent.contentIndex] = { type: "thinking", thinking: "" };
			return { type: "thinking_start", contentIndex: proxyEvent.contentIndex, partial };

		case "thinking_delta": {
			const content = partial.content[proxyEvent.contentIndex];
			if (content?.type === "thinking") {
				content.thinking += proxyEvent.delta;
				return {
					type: "thinking_delta",
					contentIndex: proxyEvent.contentIndex,
					delta: proxyEvent.delta,
					partial,
				};
			}
			throw new Error("Received thinking_delta for non-thinking content");
		}

		case "thinking_end": {
			const content = partial.content[proxyEvent.contentIndex];
			if (content?.type === "thinking") {
				content.thinkingSignature = proxyEvent.contentSignature;
				return {
					type: "thinking_end",
					contentIndex: proxyEvent.contentIndex,
					content: content.thinking,
					partial,
				};
			}
			throw new Error("Received thinking_end for non-thinking content");
		}

		case "toolcall_start":
			partial.content[proxyEvent.contentIndex] = {
				type: "toolCall",
				id: proxyEvent.id,
				name: proxyEvent.toolName,
				arguments: {},
				partialJson: "",
			} as any;
			return { type: "toolcall_start", contentIndex: proxyEvent.contentIndex, partial };

		case "toolcall_delta": {
			const content = partial.content[proxyEvent.contentIndex] as any;
			if (content?.type === "toolCall") {
				content.partialJson += proxyEvent.delta;
				content.arguments = parseStreamingJson(content.partialJson) || {};
				partial.content[proxyEvent.contentIndex] = { ...content };
				return {
					type: "toolcall_delta",
					contentIndex: proxyEvent.contentIndex,
					delta: proxyEvent.delta,
					partial,
				};
			}
			throw new Error("Received toolcall_delta for non-toolCall content");
		}

		case "toolcall_end": {
			const content = partial.content[proxyEvent.contentIndex] as any;
			if (content?.type === "toolCall") {
				delete content.partialJson;
				return {
					type: "toolcall_end",
					contentIndex: proxyEvent.contentIndex,
					toolCall: content,
					partial,
				};
			}
			return undefined;
		}

		case "done":
			partial.stopReason = proxyEvent.reason;
			partial.usage = proxyEvent.usage;
			return { type: "done", reason: proxyEvent.reason, message: partial };

		case "error":
			partial.stopReason = proxyEvent.reason;
			partial.errorMessage = proxyEvent.errorMessage;
			partial.usage = proxyEvent.usage;
			return { type: "error", reason: proxyEvent.reason, error: partial };
	}
}

describe("processProxyEvent", () => {
	describe("start", () => {
		it("returns start event", () => {
			const partial = createPartial();
			const event = processProxyEvent({ type: "start" }, partial);
			expect(event).toEqual({ type: "start", partial });
		});
	});

	describe("text events", () => {
		it("handles text_start, text_delta, text_end sequence", () => {
			const partial = createPartial();

			const start = processProxyEvent({ type: "text_start", contentIndex: 0 }, partial);
			expect(start?.type).toBe("text_start");
			expect(partial.content[0]).toEqual({ type: "text", text: "" });

			const delta1 = processProxyEvent({ type: "text_delta", contentIndex: 0, delta: "Hello" }, partial);
			expect(delta1?.type).toBe("text_delta");
			expect(partial.content[0]).toEqual({ type: "text", text: "Hello" });

			const delta2 = processProxyEvent({ type: "text_delta", contentIndex: 0, delta: " world" }, partial);
			expect(delta2?.type).toBe("text_delta");
			expect(partial.content[0]).toEqual({ type: "text", text: "Hello world" });

			const end = processProxyEvent({ type: "text_end", contentIndex: 0, contentSignature: "sig123" }, partial);
			expect(end?.type).toBe("text_end");
			if (end?.type === "text_end") {
				expect(end.content).toBe("Hello world");
			}
			expect((partial.content[0] as any).textSignature).toBe("sig123");
		});

		it("throws on text_delta for non-text content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "thinking", thinking: "" };
			expect(() => processProxyEvent({ type: "text_delta", contentIndex: 0, delta: "x" }, partial)).toThrow(
				"Received text_delta for non-text content",
			);
		});

		it("throws on text_end for non-text content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "thinking", thinking: "" };
			expect(() => processProxyEvent({ type: "text_end", contentIndex: 0 }, partial)).toThrow(
				"Received text_end for non-text content",
			);
		});
	});

	describe("thinking events", () => {
		it("handles thinking_start, thinking_delta, thinking_end sequence", () => {
			const partial = createPartial();

			const start = processProxyEvent({ type: "thinking_start", contentIndex: 0 }, partial);
			expect(start?.type).toBe("thinking_start");
			expect(partial.content[0]).toEqual({ type: "thinking", thinking: "" });

			const delta1 = processProxyEvent({ type: "thinking_delta", contentIndex: 0, delta: "Let me" }, partial);
			expect(delta1?.type).toBe("thinking_delta");
			expect((partial.content[0] as any).thinking).toBe("Let me");

			const delta2 = processProxyEvent({ type: "thinking_delta", contentIndex: 0, delta: " think..." }, partial);
			expect(delta2?.type).toBe("thinking_delta");
			expect((partial.content[0] as any).thinking).toBe("Let me think...");

			const end = processProxyEvent({ type: "thinking_end", contentIndex: 0, contentSignature: "tsig" }, partial);
			expect(end?.type).toBe("thinking_end");
			if (end?.type === "thinking_end") {
				expect(end.content).toBe("Let me think...");
			}
		});

		it("throws on thinking_delta for non-thinking content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "text", text: "hi" };
			expect(() => processProxyEvent({ type: "thinking_delta", contentIndex: 0, delta: "x" }, partial)).toThrow(
				"Received thinking_delta for non-thinking content",
			);
		});

		it("throws on thinking_end for non-thinking content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "text", text: "hi" };
			expect(() => processProxyEvent({ type: "thinking_end", contentIndex: 0 }, partial)).toThrow(
				"Received thinking_end for non-thinking content",
			);
		});
	});

	describe("toolcall events", () => {
		it("handles toolcall_start, toolcall_delta, toolcall_end sequence", () => {
			const partial = createPartial();

			const start = processProxyEvent(
				{ type: "toolcall_start", contentIndex: 0, id: "tc1", toolName: "read_file" },
				partial,
			);
			expect(start?.type).toBe("toolcall_start");
			const tc = partial.content[0] as any;
			expect(tc.type).toBe("toolCall");
			expect(tc.id).toBe("tc1");
			expect(tc.name).toBe("read_file");

			const delta1 = processProxyEvent({ type: "toolcall_delta", contentIndex: 0, delta: '{"path":' }, partial);
			expect(delta1?.type).toBe("toolcall_delta");

			const delta2 = processProxyEvent(
				{ type: "toolcall_delta", contentIndex: 0, delta: ' "/tmp/f.txt"}' },
				partial,
			);
			expect(delta2?.type).toBe("toolcall_delta");

			const tcAfter = partial.content[0] as any;
			expect(tcAfter.arguments).toEqual({ path: "/tmp/f.txt" });

			const end = processProxyEvent({ type: "toolcall_end", contentIndex: 0 }, partial);
			expect(end?.type).toBe("toolcall_end");
			if (end?.type === "toolcall_end") {
				expect((end.toolCall as any).partialJson).toBeUndefined();
			}
		});

		it("throws on toolcall_delta for non-toolCall content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "text", text: "hi" };
			expect(() => processProxyEvent({ type: "toolcall_delta", contentIndex: 0, delta: "{}" }, partial)).toThrow(
				"Received toolcall_delta for non-toolCall content",
			);
		});

		it("returns undefined for toolcall_end on non-toolCall content", () => {
			const partial = createPartial();
			(partial.content as any)[0] = { type: "text", text: "hi" };
			const result = processProxyEvent({ type: "toolcall_end", contentIndex: 0 }, partial);
			expect(result).toBeUndefined();
		});
	});

	describe("done", () => {
		it("sets stopReason and usage on partial", () => {
			const partial = createPartial();
			const usage = {
				input: 100,
				output: 50,
				cacheRead: 10,
				cacheWrite: 5,
				totalTokens: 165,
				cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
			};
			const event = processProxyEvent({ type: "done", reason: "stop", usage }, partial);
			expect(event?.type).toBe("done");
			if (event?.type === "done") {
				expect(event.reason).toBe("stop");
				expect(event.message.stopReason).toBe("stop");
				expect(event.message.usage).toEqual(usage);
			}
		});

		it("handles toolUse stop reason", () => {
			const partial = createPartial();
			const event = processProxyEvent({ type: "done", reason: "toolUse", usage: createUsage() }, partial);
			expect(event?.type).toBe("done");
			if (event?.type === "done") {
				expect(event.reason).toBe("toolUse");
			}
		});
	});

	describe("error", () => {
		it("sets error state on partial", () => {
			const partial = createPartial();
			const event = processProxyEvent(
				{ type: "error", reason: "error", errorMessage: "rate limited", usage: createUsage() },
				partial,
			);
			expect(event?.type).toBe("error");
			if (event?.type === "error") {
				expect(event.reason).toBe("error");
				expect(event.error.stopReason).toBe("error");
				expect(event.error.errorMessage).toBe("rate limited");
			}
		});

		it("handles aborted reason", () => {
			const partial = createPartial();
			const event = processProxyEvent({ type: "error", reason: "aborted", usage: createUsage() }, partial);
			expect(event?.type).toBe("error");
			if (event?.type === "error") {
				expect(event.reason).toBe("aborted");
			}
		});

		it("handles error without errorMessage", () => {
			const partial = createPartial();
			const event = processProxyEvent({ type: "error", reason: "error", usage: createUsage() }, partial);
			if (event?.type === "error") {
				expect(event.error.errorMessage).toBeUndefined();
			}
		});
	});

	describe("multiple content blocks", () => {
		it("handles interleaved text, thinking, and tool calls", () => {
			const partial = createPartial();

			processProxyEvent({ type: "thinking_start", contentIndex: 0 }, partial);
			processProxyEvent({ type: "thinking_delta", contentIndex: 0, delta: "hmm" }, partial);
			processProxyEvent({ type: "thinking_end", contentIndex: 0 }, partial);

			processProxyEvent({ type: "text_start", contentIndex: 1 }, partial);
			processProxyEvent({ type: "text_delta", contentIndex: 1, delta: "Hello" }, partial);
			processProxyEvent({ type: "text_end", contentIndex: 1 }, partial);

			processProxyEvent({ type: "toolcall_start", contentIndex: 2, id: "tc1", toolName: "bash" }, partial);
			processProxyEvent({ type: "toolcall_delta", contentIndex: 2, delta: '{"command":"ls"}' }, partial);
			processProxyEvent({ type: "toolcall_end", contentIndex: 2 }, partial);

			expect(partial.content).toHaveLength(3);
			expect((partial.content[0] as any).thinking).toBe("hmm");
			expect((partial.content[1] as any).text).toBe("Hello");
			expect((partial.content[2] as any).name).toBe("bash");
			expect((partial.content[2] as any).arguments).toEqual({ command: "ls" });
		});
	});
});

describe("streamProxy exports", () => {
	it("exports streamProxy function", async () => {
		const mod = await import("../src/proxy.js");
		expect(mod.streamProxy).toBeDefined();
		expect(typeof mod.streamProxy).toBe("function");
	});

	it("streamProxy returns an event stream that handles abort", async () => {
		const mod = await import("../src/proxy.js");
		const model = createModel();
		const controller = new AbortController();
		const stream = mod.streamProxy(model, [], {
			authToken: "test-token",
			proxyUrl: "https://example.invalid",
			signal: controller.signal,
		});
		expect(stream).toBeDefined();
		controller.abort();
	});
});
