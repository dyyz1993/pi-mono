import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionRunner } from "../../src/core/extensions/runner.js";
import type { RegisteredTool, ToolDefinition } from "../../src/core/extensions/types.js";
import { wrapRegisteredTool, wrapRegisteredTools } from "../../src/core/extensions/wrapper.js";

function makeRegisteredTool(overrides?: Partial<ToolDefinition>): RegisteredTool {
	return {
		definition: {
			name: "test_tool",
			label: "Test Tool",
			description: "A test tool",
			parameters: Type.Object({ input: Type.String() }),
			execute: vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "result" }],
				details: undefined,
			}),
			...overrides,
		},
		sourceInfo: {
			extensionPath: "test-ext",
			extensionName: "Test Extension",
			isBuiltIn: false,
		},
	};
}

function makeRunner(): ExtensionRunner {
	return {
		createContext: vi.fn().mockResolvedValue({ sessionManager: {} }),
	} as unknown as ExtensionRunner;
}

describe("wrapRegisteredTool", () => {
	it("returns AgentTool with correct name, label, description, parameters", () => {
		const registered = makeRegisteredTool({
			name: "my_tool",
			label: "My Tool",
			description: "Does things",
			parameters: Type.Object({ x: Type.Number() }),
		});
		const runner = makeRunner();
		const tool = wrapRegisteredTool(registered, runner);

		expect(tool.name).toBe("my_tool");
		expect(tool.label).toBe("My Tool");
		expect(tool.description).toBe("Does things");
		expect(tool.parameters).toBe(registered.definition.parameters);
	});

	it("execute calls runner.createContext", async () => {
		const mockCtx = { sessionManager: { id: "ctx-1" } };
		const runner = makeRunner();
		(runner.createContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

		let capturedCtx: unknown;
		const registered = makeRegisteredTool({
			execute: vi.fn().mockImplementation(async (_id, _params, _sig, _onUpdate, ctx) => {
				capturedCtx = ctx;
				return { content: [{ type: "text", text: "ok" }], details: undefined };
			}),
		});

		const tool = wrapRegisteredTool(registered, runner);
		await tool.execute("call-1", { input: "test" });

		expect(runner.createContext).toHaveBeenCalledOnce();
		await expect(capturedCtx!).resolves.toEqual(mockCtx);
	});

	it("execute produces correct results", async () => {
		const runner = makeRunner();
		const registered = makeRegisteredTool();
		const tool = wrapRegisteredTool(registered, runner);

		const result = await tool.execute("call-1", { input: "hello" });
		expect(result.content[0]).toEqual({ type: "text", text: "result" });
	});
});

describe("wrapRegisteredTools", () => {
	it("returns empty array for empty input", () => {
		const runner = makeRunner();
		const tools = wrapRegisteredTools([], runner);
		expect(tools).toEqual([]);
	});

	it("maps over array correctly", () => {
		const runner = makeRunner();
		const registered = [
			makeRegisteredTool({ name: "tool_a", label: "Tool A" }),
			makeRegisteredTool({ name: "tool_b", label: "Tool B" }),
			makeRegisteredTool({ name: "tool_c", label: "Tool C" }),
		];

		const tools = wrapRegisteredTools(registered, runner);
		expect(tools).toHaveLength(3);
		expect(tools[0].name).toBe("tool_a");
		expect(tools[0].label).toBe("Tool A");
		expect(tools[1].name).toBe("tool_b");
		expect(tools[1].label).toBe("Tool B");
		expect(tools[2].name).toBe("tool_c");
		expect(tools[2].label).toBe("Tool C");
	});

	it("each tool execution calls runner.createContext", async () => {
		const runner = makeRunner();
		const capturedCtxList: unknown[] = [];

		const registered = [
			makeRegisteredTool({
				name: "t1",
				execute: vi.fn().mockImplementation(async (_id, _params, _sig, _onUpdate, ctx) => {
					capturedCtxList.push(ctx);
					return { content: [{ type: "text", text: "1" }], details: undefined };
				}),
			}),
			makeRegisteredTool({
				name: "t2",
				execute: vi.fn().mockImplementation(async (_id, _params, _sig, _onUpdate, ctx) => {
					capturedCtxList.push(ctx);
					return { content: [{ type: "text", text: "2" }], details: undefined };
				}),
			}),
		];

		const tools = wrapRegisteredTools(registered, runner);
		await tools[0].execute("c1", { input: "a" });
		await tools[1].execute("c2", { input: "b" });

		expect(runner.createContext).toHaveBeenCalledTimes(2);
		expect(capturedCtxList).toHaveLength(2);
	});
});
