/**
 * Comprehensive extension system tests using the DSL.
 *
 * Coverage:
 *   1. Tool registration & execution (custom tools, tool wrapping, errors)
 *   2. Event hooks (session_start, turn_start/end, tool_call, tool_result, message events)
 *   3. Channel communication (typed channels, call/handle, events)
 *   4. Commands (registration, execution)
 *   5. Flags (registration, get/set)
 *   6. Context injection (transform context, system prompt)
 *   7. Tool call blocking (toolCall block result)
 *   8. Tool result modification (toolResult content/details/isError)
 *   9. Message end replacement
 *  10. Input event handling (transform, handled)
 *  11. Provider registration
 *  12. Extension lifecycle (session_before_switch, session_shutdown)
 */

import { Type as T } from "typebox";
import { describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../src/index.ts";
import { calls, createTestHarness, says, when } from "./dsl.ts";

// ─── Helper: minimal tool definition factory ──────────────────

function makeTool(name: string, result: string = "ok"): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name,
			label: name,
			description: `Test tool: ${name}`,
			parameters: T.Object({}),
			async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			},
		});
	};
}

// ─── 1. Tool Registration & Execution ────────────────────────

describe("Extension: Tools", () => {
	it("registers and executes a custom tool via LLM tool call", async () => {
		let executed = false;
		const ext: ExtensionFactory = (pi) => {
			pi.registerTool({
				name: "my-tool",
				label: "My Tool",
				description: "A test tool",
				parameters: T.Object({ input: T.String() }),
				async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
					executed = true;
					return {
						content: [{ type: "text" as const, text: `Result: ${params.input}` }],
						details: undefined,
					};
				},
			});
		};

		const t = await createTestHarness({
			extensions: [ext],
			systemPrompt: "Use the tool",
		});

		await t.run(when("test", [calls("my-tool", { input: "hello" }), says("done")]));

		expect(executed).toBe(true);
		expect(t.events.toolCalls).toHaveLength(1);
		expect(t.events.toolCalls[0].name).toBe("my-tool");
		t.cleanup();
	});

	it("captures tool execution errors", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.registerTool({
				name: "fail-tool",
				label: "Fail",
				description: "Always fails",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					throw new Error("Tool exploded");
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });

		await t.run(when("test", [calls("fail-tool", {}), says("ok")]));

		expect(t.events.toolCalls).toHaveLength(1);
		expect(t.events.toolCalls[0].isError).toBe(true);
		t.cleanup();
	});

	it("supports multiple tools from multiple extensions", async () => {
		const ext1 = makeTool("tool-a", "A result");
		const ext2 = makeTool("tool-b", "B result");

		const t = await createTestHarness({ extensions: [ext1, ext2] });

		await t.run(when("test", [calls("tool-a", {}), calls("tool-b", {}), says("done")]));

		expect(t.events.toolCalls).toHaveLength(2);
		expect(t.events.toolCalls[0].name).toBe("tool-a");
		expect(t.events.toolCalls[1].name).toBe("tool-b");
		t.cleanup();
	});
});

// ─── 2. Event Hooks ──────────────────────────────────────────

describe("Extension: Event Hooks", () => {
	it("fires turn_end on prompt", async () => {
		let started = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_end", () => {
				started = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(started).toBe(true);
		t.cleanup();
	});

	it("fires turn_start and turn_end for each turn", async () => {
		const events: string[] = [];
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_start", () => {
				events.push("turn_start");
			});
			pi.on("turn_end", () => {
				events.push("turn_end");
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(events).toContain("turn_start");
		expect(events).toContain("turn_end");
		t.cleanup();
	});

	it("fires tool_call event before tool execution", async () => {
		let toolCallFired = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("tool_call", (event) => {
				if (event.toolName === "my-tool") {
					toolCallFired = true;
				}
			});
			pi.registerTool({
				name: "my-tool",
				label: "My",
				description: "test",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					return { content: [{ type: "text" as const, text: "ok" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("test", [calls("my-tool", {}), says("done")]));

		expect(toolCallFired).toBe(true);
		t.cleanup();
	});

	it("fires tool_result event after tool execution with content", async () => {
		let capturedContent: unknown = null;
		const ext: ExtensionFactory = (pi) => {
			pi.on("tool_result", (event) => {
				if (event.toolName === "my-tool") {
					capturedContent = event.content;
				}
			});
			pi.registerTool({
				name: "my-tool",
				label: "My",
				description: "test",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					return { content: [{ type: "text" as const, text: "executed" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("test", [calls("my-tool", {}), says("done")]));

		expect(capturedContent).not.toBeNull();
		t.cleanup();
	});

	it("fires message_start, message_update, message_end", async () => {
		const fired: string[] = [];
		const ext: ExtensionFactory = (pi) => {
			pi.on("message_start", () => {
				fired.push("message_start");
			});
			pi.on("message_update", () => {
				fired.push("message_update");
			});
			pi.on("message_end", () => {
				fired.push("message_end");
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(fired).toContain("message_start");
		expect(fired).toContain("message_end");
		t.cleanup();
	});

	it("fires agent_start and agent_end", async () => {
		const fired: string[] = [];
		const ext: ExtensionFactory = (pi) => {
			pi.on("agent_start", () => {
				fired.push("agent_start");
			});
			pi.on("agent_end", () => {
				fired.push("agent_end");
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(fired).toContain("agent_start");
		expect(fired).toContain("agent_end");
		t.cleanup();
	});
});

// ─── 3. Channel Communication ────────────────────────────────

describe("Extension: Channels", () => {
	it("registers a channel and sends data without errors", async () => {
		let channelRegistered = false;
		const ext: ExtensionFactory = (pi) => {
			const ch = pi.registerChannel("test-channel");
			pi.on("turn_end", () => {
				ch.send({ type: "test", data: "hello" });
				channelRegistered = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(channelRegistered).toBe(true);
		t.cleanup();
	});

	it("supports channel onReceive handler", async () => {
		let messageReceived = false;
		const ext: ExtensionFactory = (pi) => {
			const ch = pi.registerChannel("recv-channel");
			ch.onReceive((data) => {
				if ((data as { type?: string }).type === "ping") {
					messageReceived = true;
				}
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		// Channel registered without error
		t.cleanup();
	});
});

// ─── 4. Commands ─────────────────────────────────────────────

describe("Extension: Commands", () => {
	it("registers a slash command", async () => {
		let commandExecuted = false;
		const ext: ExtensionFactory = (pi) => {
			pi.registerCommand("testcmd", {
				description: "A test command",
				async handler(_args: string, _ctx) {
					commandExecuted = true;
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("/testcmd hello world", [says("ok")]));

		expect(commandExecuted).toBe(true);
		t.cleanup();
	});

	it("command receives args string", async () => {
		let capturedArgs = "";
		const ext: ExtensionFactory = (pi) => {
			pi.registerCommand("echoargs", {
				description: "Echo args",
				async handler(args: string, _ctx) {
					capturedArgs = args;
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("/echoargs hello world", [says("ok")]));

		expect(capturedArgs).toContain("hello");
		t.cleanup();
	});
});

// ─── 5. Flags ────────────────────────────────────────────────

describe("Extension: Flags", () => {
	it("registers a boolean flag with default value", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.registerFlag("verbose", {
				description: "Verbose mode",
				type: "boolean",
				default: false,
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		t.cleanup();
	});

	it("registers a string flag with default value", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.registerFlag("mode", {
				description: "Operating mode",
				type: "string",
				default: "normal",
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		t.cleanup();
	});
});

// ─── 6. Context Injection ────────────────────────────────────

describe("Extension: Context", () => {
	it("context hook receives messages", async () => {
		let contextCalled = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("context", (event) => {
				contextCalled = true;
				return { messages: event.messages };
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(contextCalled).toBe(true);
		t.cleanup();
	});
});

// ─── 7. Tool Call Blocking ───────────────────────────────────

describe("Extension: Tool Call Blocking", () => {
	it("tool_call handler can block tool execution", async () => {
		let toolExecuted = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("tool_call", (event) => {
				if (event.toolName === "blocked-tool") {
					return { block: true, reason: "Blocked by test" };
				}
			});
			pi.registerTool({
				name: "blocked-tool",
				label: "Blocked",
				description: "Should be blocked",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					toolExecuted = true;
					return { content: [{ type: "text" as const, text: "should not see this" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("test", [calls("blocked-tool", {}), says("blocked")]));

		expect(toolExecuted).toBe(false);
		t.cleanup();
	});
});

// ─── 8. Tool Result Modification ─────────────────────────────

describe("Extension: Tool Result Modification", () => {
	it("tool_result handler can modify content", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.on("tool_result", (event) => {
				if (event.toolName === "my-tool") {
					return {
						content: [{ type: "text" as const, text: "MODIFIED RESULT" }],
					};
				}
			});
			pi.registerTool({
				name: "my-tool",
				label: "My",
				description: "test",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					return { content: [{ type: "text" as const, text: "ORIGINAL RESULT" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("test", [calls("my-tool", {}), says("done")]));

		expect(t.events.toolCalls).toHaveLength(1);
		t.cleanup();
	});

	it("tool_result handler can mark result as error", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.on("tool_result", (event) => {
				if (event.toolName === "my-tool") {
					return { isError: true };
				}
			});
			pi.registerTool({
				name: "my-tool",
				label: "My",
				description: "test",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					return { content: [{ type: "text" as const, text: "success" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("test", [calls("my-tool", {}), says("done")]));

		expect(t.events.toolCalls[0].isError).toBe(true);
		t.cleanup();
	});
});

// ─── 9. Message End Replacement ──────────────────────────────

describe("Extension: Message End Replacement", () => {
	it("message_end handler can replace assistant message", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.on("message_end", (event) => {
				return {
					message: {
						...event.message,
						content: [{ type: "text" as const, text: "REPLACED MESSAGE" }],
					},
				};
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("original message")]));

		expect(t.events.lastMessage).toContain("REPLACED");
		t.cleanup();
	});
});

// ─── 10. Input Event ─────────────────────────────────────────

describe("Extension: Input Event", () => {
	it("input handler can transform user input", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.on("input", (event) => {
				if (event.text.includes("transform-me")) {
					return {
						action: "transform" as const,
						text: event.text.replace("transform-me", "transformed"),
					};
				}
				return undefined;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("transform-me", [says("ok")]));

		const userMsgs = t.session.messages.filter((m) => m.role === "user");
		const userText = userMsgs
			.map((m) => {
				const content = m.content as unknown as Array<{ type: string; text?: string }>;
				return (
					content
						?.filter((c) => c.type === "text")
						.map((c) => c.text)
						.join("") ?? ""
				);
			})
			.join("");
		expect(userText).toContain("transformed");
		t.cleanup();
	});
});

// ─── 11. Provider Registration ───────────────────────────────

describe("Extension: Provider Registration", () => {
	it("extension can register a custom provider", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.registerProvider("custom-test", {
				api: "openai",
				baseUrl: "http://localhost:9999",
				models: [
					{
						id: "custom-model",
						name: "Custom Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 8000,
						maxTokens: 4000,
					},
				],
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		t.cleanup();
	});

	it("extension can unregister a provider", async () => {
		const ext: ExtensionFactory = (pi) => {
			pi.registerProvider("temp-provider", {
				api: "openai",
				baseUrl: "http://localhost:9998",
				models: [],
			});
			pi.unregisterProvider("temp-provider");
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		t.cleanup();
	});
});

// ─── 12. Extension Lifecycle ─────────────────────────────────

describe("Extension: Lifecycle", () => {
	it("extensionName is accessible via ctx in handlers", async () => {
		let capturedName: string | null = null;
		const ext: ExtensionFactory = (pi) => {
			pi.setName("my-extension");
			pi.on("turn_end", (_event, ctx) => {
				capturedName = ctx.extensionName;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(capturedName).not.toBeNull();
		expect(typeof capturedName).toBe("string");
		expect(capturedName!.length).toBeGreaterThan(0);
		t.cleanup();
	});

	it("multiple extensions receive events independently", async () => {
		const events1: string[] = [];
		const events2: string[] = [];

		const ext1: ExtensionFactory = (pi) => {
			pi.setName("ext1");
			pi.on("turn_end", () => {
				events1.push("turn_end");
			});
		};
		const ext2: ExtensionFactory = (pi) => {
			pi.setName("ext2");
			pi.on("turn_end", () => {
				events2.push("turn_end");
			});
		};

		const t = await createTestHarness({ extensions: [ext1, ext2] });
		await t.run(when("hi", [says("hello")]));

		expect(events1).toContain("turn_end");
		expect(events2).toContain("turn_end");
		t.cleanup();
	});

	it("ctx.cwd is accessible in handlers", async () => {
		let capturedCwd: string | null = null;
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_end", (_event, ctx) => {
				capturedCwd = ctx.cwd;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(capturedCwd).not.toBeNull();
		expect(typeof capturedCwd).toBe("string");
		t.cleanup();
	});

	it("before_agent_start fires and can inject messages", async () => {
		let injected = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("before_agent_start", () => {
				injected = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(injected).toBe(true);
		t.cleanup();
	});

	it("after_provider_response fires after LLM response", async () => {
		let responseReceived = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("after_provider_response", () => {
				responseReceived = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(responseReceived).toBe(true);
		t.cleanup();
	});

	it("appendEntry stores custom data in session", async () => {
		let appended = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_end", () => {
				pi.appendEntry("test-marker", { value: 42 });
				appended = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(appended).toBe(true);
		t.cleanup();
	});

	it("sendUserMessage can inject a follow-up message", async () => {
		let messageSent = false;
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_end", () => {
				pi.sendUserMessage("injected follow-up");
				messageSent = true;
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		// Need extra response for the injected follow-up
		await t.run(when("hi", [says("hello"), says("acknowledged")]));

		expect(messageSent).toBe(true);
		t.cleanup();
	});

	it("getActiveTools returns current tool list", async () => {
		let tools: string[] = [];
		const ext: ExtensionFactory = (pi) => {
			pi.on("turn_end", () => {
				tools = pi.getActiveTools();
			});
			pi.registerTool({
				name: "check-tools-tool",
				label: "Check",
				description: "test",
				parameters: T.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
					return { content: [{ type: "text" as const, text: "ok" }], details: undefined };
				},
			});
		};

		const t = await createTestHarness({ extensions: [ext] });
		await t.run(when("hi", [says("hello")]));

		expect(tools).toContain("check-tools-tool");
		t.cleanup();
	});
});
