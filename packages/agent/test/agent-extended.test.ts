import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue, runAgentLoop, runAgentLoopContinue } from "../src/agent-loop.js";
import { Agent } from "../src/index.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

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

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

describe("Agent.reset()", () => {
	it("should clear messages, streaming state, error state, and queues", async () => {
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
				});
				return stream;
			},
		});

		agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() } as any,
		];

		await agent.prompt("test");

		agent.steer({ role: "user", content: [{ type: "text", text: "s1" }], timestamp: Date.now() });
		agent.followUp({ role: "user", content: [{ type: "text", text: "f1" }], timestamp: Date.now() });

		expect(agent.state.messages.length).toBeGreaterThan(0);
		expect(agent.hasQueuedMessages()).toBe(true);

		agent.reset();

		expect(agent.state.messages).toEqual([]);
		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.streamingMessage).toBeUndefined();
		expect(agent.state.pendingToolCalls).toEqual(new Set());
		expect(agent.state.errorMessage).toBeUndefined();
		expect(agent.hasQueuedMessages()).toBe(false);
	});
});

describe("Agent queue operations", () => {
	it("clearSteeringQueue removes only steering messages", () => {
		const agent = new Agent();
		agent.steer({ role: "user", content: [{ type: "text", text: "s" }], timestamp: Date.now() });
		agent.followUp({ role: "user", content: [{ type: "text", text: "f" }], timestamp: Date.now() });

		agent.clearSteeringQueue();
		expect(agent.hasQueuedMessages()).toBe(true);

		agent.steer({ role: "user", content: [{ type: "text", text: "s2" }], timestamp: Date.now() });
		agent.clearFollowUpQueue();
		expect(agent.hasQueuedMessages()).toBe(true);

		agent.clearSteeringQueue();
		expect(agent.hasQueuedMessages()).toBe(false);
	});

	it("clearFollowUpQueue removes only follow-up messages", () => {
		const agent = new Agent();
		agent.steer({ role: "user", content: [{ type: "text", text: "s" }], timestamp: Date.now() });
		agent.followUp({ role: "user", content: [{ type: "text", text: "f" }], timestamp: Date.now() });

		agent.clearFollowUpQueue();
		expect(agent.hasQueuedMessages()).toBe(true);

		agent.clearSteeringQueue();
		expect(agent.hasQueuedMessages()).toBe(false);
	});

	it("clearAllQueues removes both steering and follow-up messages", () => {
		const agent = new Agent();
		agent.steer({ role: "user", content: [{ type: "text", text: "s" }], timestamp: Date.now() });
		agent.followUp({ role: "user", content: [{ type: "text", text: "f" }], timestamp: Date.now() });

		expect(agent.hasQueuedMessages()).toBe(true);
		agent.clearAllQueues();
		expect(agent.hasQueuedMessages()).toBe(false);
	});

	it("hasQueuedMessages returns false when queues are empty", () => {
		const agent = new Agent();
		expect(agent.hasQueuedMessages()).toBe(false);
	});
});

describe("Agent steering/followUp mode 'all'", () => {
	it("drains all steering messages when mode is 'all'", async () => {
		let responseCount = 0;
		const agent = new Agent({
			steeringMode: "all",
			streamFn: () => {
				responseCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage(`r${responseCount}`) });
				});
				return stream;
			},
		});

		agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "init" }], timestamp: Date.now() } as any,
			createAssistantMessage("first"),
		];

		agent.steer({ role: "user", content: [{ type: "text", text: "s1" }], timestamp: Date.now() });
		agent.steer({ role: "user", content: [{ type: "text", text: "s2" }], timestamp: Date.now() });

		await agent.continue();

		const userTexts = agent.state.messages
			.filter((m) => m.role === "user" && typeof m.content !== "string")
			.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text);

		expect(userTexts).toContain("s1");
		expect(userTexts).toContain("s2");
	});

	it("drains all follow-up messages when mode is 'all'", async () => {
		let responseCount = 0;
		const agent = new Agent({
			followUpMode: "all",
			streamFn: () => {
				responseCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage(`r${responseCount}`) });
				});
				return stream;
			},
		});

		agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "init" }], timestamp: Date.now() } as any,
			createAssistantMessage("first"),
		];

		agent.followUp({ role: "user", content: [{ type: "text", text: "f1" }], timestamp: Date.now() });
		agent.followUp({ role: "user", content: [{ type: "text", text: "f2" }], timestamp: Date.now() });

		await agent.continue();

		const userTexts = agent.state.messages
			.filter((m) => m.role === "user" && typeof m.content !== "string")
			.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text);

		expect(userTexts).toContain("f1");
		expect(userTexts).toContain("f2");
	});
});

describe("Agent handleRunFailure error path", () => {
	it("should capture error message and emit agent_end when streamFn throws", async () => {
		const agent = new Agent({
			streamFn: () => {
				throw new Error("stream exploded");
			},
		});

		const events: AgentEvent[] = [];
		agent.subscribe((event) => {
			events.push(event);
		});

		await agent.prompt("hello");

		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.errorMessage).toBe("stream exploded");

		const lastMsg = agent.state.messages[agent.state.messages.length - 1];
		expect(lastMsg.role).toBe("assistant");
		if (lastMsg.role === "assistant") {
			expect(lastMsg.stopReason).toBe("error");
			expect(lastMsg.errorMessage).toBe("stream exploded");
		}

		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});

	it("should set aborted stopReason via handleRunFailure when aborted", async () => {
		const agent = new Agent({
			streamFn: () => {
				throw new Error("stream exploded");
			},
		});

		const events: AgentEvent[] = [];
		agent.subscribe((event) => {
			events.push(event);
		});

		const promptPromise = agent.prompt("hello");

		setTimeout(() => agent.abort(), 0);

		await promptPromise;

		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();

		const agentEndMessages = (agentEnd as any)?.messages ?? [];
		if (agentEndMessages.length === 0) {
			const lastMsg = agent.state.messages[agent.state.messages.length - 1];
			expect(lastMsg.stopReason).toBe("error");
		}
	});
});

describe("agentLoopContinue when last message is assistant", () => {
	it("should throw when last message role is assistant", () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createAssistantMessage([{ type: "text", text: "hi" }])],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		expect(() => agentLoopContinue(context, config)).toThrow("Cannot continue from message role: assistant");
	});

	it("runAgentLoopContinue should throw when last message role is assistant", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createAssistantMessage([{ type: "text", text: "hi" }])],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const events: AgentEvent[] = [];
		await expect(
			runAgentLoopContinue(context, config, async (e) => {
				events.push(e);
			}),
		).rejects.toThrow("Cannot continue from message role: assistant");
	});
});

describe("executeToolCallsParallel with tool that throws", () => {
	it("should capture thrown error as isError tool result", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "failing",
			label: "Failing",
			description: "Fails",
			parameters: toolSchema,
			async execute() {
				throw new Error("tool boom");
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			toolExecution: "parallel",
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "failing", arguments: { value: "x" } }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd).toBeDefined();
		expect(toolEnd!.isError).toBe(true);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "tool boom" });
	});
});

describe("afterToolCall that throws", () => {
	it("should convert the error into an isError tool result", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			parameters: toolSchema,
			async execute(_id, params) {
				return { content: [{ type: "text", text: params.value }], details: {} };
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			afterToolCall: async () => {
				throw new Error("afterHook blew up");
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "echo", arguments: { value: "hi" } }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "ok" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd).toBeDefined();
		expect(toolEnd!.isError).toBe(true);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "afterHook blew up" });
	});
});

describe("afterToolCall that modifies result content/details/isError", () => {
	it("should override content, details, and isError from afterToolCall", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			parameters: toolSchema,
			async execute(_id, params) {
				return { content: [{ type: "text", text: params.value }], details: { original: true } };
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			afterToolCall: async () => ({
				content: [{ type: "text", text: "overridden" }],
				details: { modified: true },
				isError: true,
			}),
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "echo", arguments: { value: "hi" } }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "ok" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd).toBeDefined();
		expect(toolEnd!.isError).toBe(true);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "overridden" });
		expect(toolEnd!.result.details).toEqual({ modified: true });
	});
});

describe("beforeToolCall blocking with block = true", () => {
	it("should block tool execution and emit error result", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let executed = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "blocked",
			label: "Blocked",
			description: "Blocked tool",
			parameters: toolSchema,
			async execute() {
				executed = true;
				return { content: [{ type: "text", text: "should not reach" }], details: {} };
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			beforeToolCall: async () => ({ block: true, reason: "not allowed" }),
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "blocked", arguments: { value: "x" } }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "ok" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toBe(false);
		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd).toBeDefined();
		expect(toolEnd!.isError).toBe(true);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "not allowed" });
	});

	it("should use default message when reason is not provided", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "blocked2",
			label: "Blocked2",
			description: "Blocked tool 2",
			parameters: toolSchema,
			async execute() {
				return { content: [{ type: "text", text: "nope" }], details: {} };
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			beforeToolCall: async () => ({ block: true }),
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "blocked2", arguments: { value: "x" } }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "ok" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "Tool execution was blocked" });
	});
});

describe("Tool not found path", () => {
	it("should emit error tool result when tool is not in context.tools", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					s.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tc-1", name: "nonexistent", arguments: {} }],
							"toolUse",
						),
					});
				} else {
					s.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "ok" }]),
					});
				}
				callIndex++;
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolEnd = events.find(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnd).toBeDefined();
		expect(toolEnd!.isError).toBe(true);
		expect(toolEnd!.result.content[0]).toEqual({ type: "text", text: "Tool nonexistent not found" });
	});
});

describe("getFollowUpMessages integration", () => {
	it("should continue loop when follow-up messages are returned", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};

		let followUpDelivered = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: async () => {
				if (!followUpDelivered) {
					followUpDelivered = true;
					return [createUserMessage("follow-up question")];
				}
				return [];
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("start")], context, config, undefined, () => {
			const s = new MockAssistantStream();
			queueMicrotask(() => {
				callIndex++;
				s.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: `r${callIndex}` }]),
				});
			});
			return s;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expect(callIndex).toBe(2);
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
	});
});
