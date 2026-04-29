import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";
import subagentExtensionDefault, { extractTextFromEvent, getFinalText, parseJsonLine } from "./subagent.js";

const spawnCalls: string[][] = [];
const mockChild = new EventEmitter() as ChildProcess;
(mockChild as any).stdout = new EventEmitter();
(mockChild as any).stderr = new EventEmitter();
(mockChild as any).killed = false;
(mockChild as any).kill = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (cmd: string, args: string[]) => {
		spawnCalls.push(args);
		process.nextTick(() => mockChild.emit("exit", 0));
		return mockChild;
	},
}));

describe("subagent", () => {
	describe("parseJsonLine", () => {
		it("parses valid JSON", () => {
			expect(parseJsonLine('{"type":"test"}')).toEqual({ type: "test" });
		});

		it("returns null for empty string", () => {
			expect(parseJsonLine("")).toBeNull();
		});

		it("returns null for whitespace", () => {
			expect(parseJsonLine("   ")).toBeNull();
		});

		it("returns null for invalid JSON", () => {
			expect(parseJsonLine("not json")).toBeNull();
		});

		it("parses arrays", () => {
			expect(parseJsonLine("[1,2,3]")).toEqual([1, 2, 3]);
		});

		it("parses numbers", () => {
			expect(parseJsonLine("42")).toBe(42);
		});
	});

	describe("getFinalText", () => {
		it("extracts text from last assistant message", () => {
			const messages = [
				{ role: "user", content: [{ type: "text", text: "hello" }] },
				{ role: "assistant", content: [{ type: "text", text: "hi there" }] },
			];
			expect(getFinalText(messages)).toBe("hi there");
		});

		it("returns empty string when no assistant messages", () => {
			const messages = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
			expect(getFinalText(messages)).toBe("");
		});

		it("returns empty string for empty array", () => {
			expect(getFinalText([])).toBe("");
		});

		it("returns last assistant text when multiple", () => {
			const messages = [
				{ role: "assistant", content: [{ type: "text", text: "first" }] },
				{ role: "user", content: [{ type: "text", text: "ok" }] },
				{ role: "assistant", content: [{ type: "text", text: "second" }] },
			];
			expect(getFinalText(messages)).toBe("second");
		});

		it("skips non-text content parts", () => {
			const messages = [
				{
					role: "assistant",
					content: [
						{ type: "tool_call", name: "bash" },
						{ type: "text", text: "result" },
					],
				},
			];
			expect(getFinalText(messages)).toBe("result");
		});

		it("handles string content", () => {
			const messages = [{ role: "assistant", content: "plain text" }];
			expect(getFinalText(messages)).toBe("");
		});

		it("skips empty text", () => {
			const messages = [{ role: "assistant", content: [{ type: "text", text: "" }] }];
			expect(getFinalText(messages)).toBe("");
		});
	});

	describe("extractTextFromEvent", () => {
		it("extracts from event.content", () => {
			const event = { content: [{ type: "text", text: "hello" }] };
			expect(extractTextFromEvent(event as any)).toBe("hello");
		});

		it("extracts from event.message.content", () => {
			const event = { message: { content: [{ type: "text", text: "world" }] } };
			expect(extractTextFromEvent(event as any)).toBe("world");
		});

		it("prefers event.content over message.content", () => {
			const event = {
				content: [{ type: "text", text: "first" }],
				message: { content: [{ type: "text", text: "second" }] },
			};
			expect(extractTextFromEvent(event as any)).toBe("first");
		});

		it("returns empty string when no text content", () => {
			const event = { type: "tool_call" };
			expect(extractTextFromEvent(event as any)).toBe("");
		});

		it("handles empty arrays", () => {
			expect(extractTextFromEvent({ content: [] } as any)).toBe("");
		});
	});

	describe("subagentExtension", () => {
		function createMockPi() {
			const registeredTools = new Map<string, any>();
			const channelSend = vi.fn();
			const appendEntries: Array<{ type: string; data: unknown }> = [];

			const pi = {
				on: vi.fn(),
				callLLM: vi.fn(async () => "{}"),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				setStatus: vi.fn(),
				registerProvider: vi.fn(),
				unregisterProvider: vi.fn(),
				events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
				registerChannel: vi.fn(() => ({
					name: "subagent",
					send: channelSend,
					onReceive: vi.fn(() => () => {}),
					invoke: vi.fn(),
				})),
				registerTool: vi.fn((tool: any) => {
					registeredTools.set(tool.name, tool);
				}),
				appendEntry: vi.fn((type: string, data?: unknown) => {
					appendEntries.push({ type, data });
				}),
			} as unknown as ExtensionAPI;

			return { pi, registeredTools, channelSend, appendEntries };
		}

		it("registers channel at load time", () => {
			const { pi } = createMockPi();
			subagentExtensionDefault(pi);
			expect(pi.registerChannel).toHaveBeenCalledWith("subagent");
		});

		it("registers subagent tool", () => {
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);

			expect(registeredTools.has("subagent")).toBe(true);
			const tool = registeredTools.get("subagent")!;
			expect(tool.name).toBe("subagent");
			expect(tool.label).toBe("SubAgent");
			expect(tool.description).toContain("JSON mode");
			expect(tool.parameters).toBeDefined();
		});

		it("tool has correct parameter schema", () => {
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;
			const schema = tool.parameters;
			expect(schema.type).toBe("object");
			expect(schema.properties.description).toBeDefined();
			expect(schema.properties.instruction).toBeDefined();
			expect(schema.properties.systemPrompt).toBeDefined();
			expect(schema.properties.cwd).toBeDefined();
			expect(schema.properties.model).toBeDefined();
			expect(schema.required).toContain("description");
			expect(schema.required).toContain("instruction");
		});

		it("tool execute is a function", () => {
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;
			expect(typeof tool.execute).toBe("function");
		});
	});

	describe("effectiveModel fallback logic", () => {
		function createMockPi() {
			const registeredTools = new Map<string, any>();
			const channelSend = vi.fn();
			const pi = {
				on: vi.fn(),
				callLLM: vi.fn(async () => "{}"),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				setStatus: vi.fn(),
				registerProvider: vi.fn(),
				unregisterProvider: vi.fn(),
				events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
				registerChannel: vi.fn(() => ({
					name: "subagent",
					send: channelSend,
					onReceive: vi.fn(() => () => {}),
					invoke: vi.fn(),
				})),
				registerTool: vi.fn((tool: any) => {
					registeredTools.set(tool.name, tool);
				}),
				appendEntry: vi.fn(),
			} as unknown as ExtensionAPI;
			return { pi, registeredTools, channelSend };
		}

		it("uses params.model when explicitly provided", async () => {
			spawnCalls.length = 0;
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;

			await tool.execute(
				"call-1",
				{
					description: "test",
					instruction: "do stuff",
					model: "claude-sonnet-4",
				},
				undefined,
				undefined,
				{ cwd: "/tmp", model: { provider: "zhipuai", id: "glm-5" } } as any,
			);

			expect(spawnCalls.length).toBe(1);
			const modelIdx = spawnCalls[0].indexOf("--model");
			expect(modelIdx).toBeGreaterThan(-1);
			expect(spawnCalls[0][modelIdx + 1]).toBe("claude-sonnet-4");
		});

		it("falls back to ctx.model (parent agent model) when params.model not set", async () => {
			spawnCalls.length = 0;
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;

			await tool.execute(
				"call-2",
				{
					description: "test",
					instruction: "do stuff",
				},
				undefined,
				undefined,
				{ cwd: "/tmp", model: { provider: "zhipuai", id: "glm-5" } } as any,
			);

			expect(spawnCalls.length).toBe(1);
			const modelIdx = spawnCalls[0].indexOf("--model");
			expect(modelIdx).toBeGreaterThan(-1);
			expect(spawnCalls[0][modelIdx + 1]).toBe("zhipuai/glm-5");
		});

		it("omits --model when both params.model and ctx.model are absent", async () => {
			spawnCalls.length = 0;
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;

			await tool.execute(
				"call-3",
				{
					description: "test",
					instruction: "do stuff",
				},
				undefined,
				undefined,
				{ cwd: "/tmp", model: undefined } as any,
			);

			expect(spawnCalls.length).toBe(1);
			expect(spawnCalls[0]).not.toContain("--model");
		});

		it("params.model takes priority over ctx.model", async () => {
			spawnCalls.length = 0;
			const { pi, registeredTools } = createMockPi();
			subagentExtensionDefault(pi);
			const tool = registeredTools.get("subagent")!;

			await tool.execute(
				"call-4",
				{
					description: "test",
					instruction: "do stuff",
					model: "gpt-4o",
				},
				undefined,
				undefined,
				{ cwd: "/tmp", model: { provider: "zhipuai", id: "glm-5" } } as any,
			);

			expect(spawnCalls.length).toBe(1);
			const modelIdx = spawnCalls[0].indexOf("--model");
			expect(spawnCalls[0][modelIdx + 1]).toBe("gpt-4o");
		});
	});
});
