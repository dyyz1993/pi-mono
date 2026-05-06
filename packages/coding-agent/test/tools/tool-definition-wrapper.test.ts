import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../src/core/extensions/types.js";
import {
	createToolDefinitionFromAgentTool,
	wrapToolDefinition,
	wrapToolDefinitions,
} from "../../src/core/tools/tool-definition-wrapper.js";

function makeToolDefinition(overrides?: Partial<ToolDefinition>): ToolDefinition {
	return {
		name: "test_tool",
		label: "Test Tool",
		description: "A test tool",
		parameters: Type.Object({ input: Type.String() }),
		execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => ({
			content: [{ type: "text", text: "result" }],
			details: undefined,
		}),
		...overrides,
	};
}

function makeAgentTool(overrides?: Partial<AgentTool>): AgentTool {
	return {
		name: "agent_tool",
		label: "Agent Tool",
		description: "An agent tool",
		parameters: Type.Object({ input: Type.String() }),
		execute: async (_toolCallId, _params, _signal, _onUpdate) => ({
			content: [{ type: "text", text: "agent result" }],
			details: undefined,
		}),
		...overrides,
	};
}

describe("wrapToolDefinition", () => {
	it("maps name, label, description, parameters", () => {
		const def = makeToolDefinition({
			name: "my_tool",
			label: "My Tool",
			description: "Does things",
			parameters: Type.Object({ x: Type.Number() }),
		});
		const tool = wrapToolDefinition(def);
		expect(tool.name).toBe("my_tool");
		expect(tool.label).toBe("My Tool");
		expect(tool.description).toBe("Does things");
		expect(tool.parameters).toBe(def.parameters);
	});

	it("maps prepareArguments", () => {
		const prepareArguments = (args: unknown) => args as any;
		const def = makeToolDefinition({ prepareArguments });
		const tool = wrapToolDefinition(def);
		expect(tool.prepareArguments).toBe(prepareArguments);
	});

	it("maps executionMode", () => {
		const def = makeToolDefinition({ executionMode: "sequential" });
		const tool = wrapToolDefinition(def);
		expect(tool.executionMode).toBe("sequential");
	});

	it("execute calls definition.execute without ctx when no ctxFactory", async () => {
		let capturedCtx: unknown = "sentinel";
		const def = makeToolDefinition({
			execute: async (_id, _params, _signal, _onUpdate, ctx) => {
				capturedCtx = ctx;
				return { content: [{ type: "text", text: "ok" }], details: undefined };
			},
		});
		const tool = wrapToolDefinition(def);
		const result = await tool.execute("call-1", { input: "test" });
		expect(result.content[0]).toEqual({ type: "text", text: "ok" });
		expect(capturedCtx).toBeUndefined();
	});

	it("execute provides ctx from ctxFactory", async () => {
		const mockCtx = { sessionManager: {} } as any;
		let capturedCtx: unknown;
		const def = makeToolDefinition({
			execute: async (_id, _params, _signal, _onUpdate, ctx) => {
				capturedCtx = ctx;
				return { content: [{ type: "text", text: "ok" }], details: undefined };
			},
		});
		const tool = wrapToolDefinition(def, () => mockCtx);
		await tool.execute("call-1", { input: "test" });
		expect(capturedCtx).toBe(mockCtx);
	});

	it("forwards signal and onUpdate to definition execute", async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		let capturedSignal: AbortSignal | undefined;
		let capturedOnUpdate: unknown;

		const def = makeToolDefinition({
			execute: async (_id, _params, sig, onUpdate, _ctx) => {
				capturedSignal = sig;
				capturedOnUpdate = onUpdate;
				return { content: [{ type: "text", text: "ok" }], details: undefined };
			},
		});
		const tool = wrapToolDefinition(def);
		const onUpdate = () => {};
		await tool.execute("call-1", { input: "test" }, signal, onUpdate);
		expect(capturedSignal).toBe(signal);
		expect(capturedOnUpdate).toBe(onUpdate);
	});
});

describe("wrapToolDefinitions", () => {
	it("wraps empty array", () => {
		const tools = wrapToolDefinitions([]);
		expect(tools).toEqual([]);
	});

	it("wraps multiple definitions", () => {
		const defs = [
			makeToolDefinition({ name: "tool_a", label: "Tool A" }),
			makeToolDefinition({ name: "tool_b", label: "Tool B" }),
		];
		const tools = wrapToolDefinitions(defs);
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("tool_a");
		expect(tools[1].name).toBe("tool_b");
	});

	it("passes ctxFactory to each wrapped tool", async () => {
		const mockCtx = { value: 42 } as any;
		const capturedCtxList: unknown[] = [];

		const defs = [
			makeToolDefinition({
				name: "t1",
				execute: async (_id, _params, _signal, _onUpdate, ctx) => {
					capturedCtxList.push(ctx);
					return { content: [{ type: "text", text: "1" }], details: undefined };
				},
			}),
			makeToolDefinition({
				name: "t2",
				execute: async (_id, _params, _signal, _onUpdate, ctx) => {
					capturedCtxList.push(ctx);
					return { content: [{ type: "text", text: "2" }], details: undefined };
				},
			}),
		];

		const tools = wrapToolDefinitions(defs, () => mockCtx);
		await tools[0].execute("c1", { input: "a" });
		await tools[1].execute("c2", { input: "b" });
		expect(capturedCtxList).toEqual([mockCtx, mockCtx]);
	});
});

describe("createToolDefinitionFromAgentTool", () => {
	it("maps name, label, description, parameters", () => {
		const tool = makeAgentTool({
			name: "my_agent_tool",
			label: "My Agent Tool",
			description: "Agent tool desc",
			parameters: Type.Object({ y: Type.Boolean() }),
		});
		const def = createToolDefinitionFromAgentTool(tool);
		expect(def.name).toBe("my_agent_tool");
		expect(def.label).toBe("My Agent Tool");
		expect(def.description).toBe("Agent tool desc");
		expect(def.parameters).toBe(tool.parameters);
	});

	it("maps prepareArguments", () => {
		const prepareArguments = (args: unknown) => args as any;
		const tool = makeAgentTool({ prepareArguments });
		const def = createToolDefinitionFromAgentTool(tool);
		expect(def.prepareArguments).toBe(prepareArguments);
	});

	it("maps executionMode", () => {
		const tool = makeAgentTool({ executionMode: "parallel" });
		const def = createToolDefinitionFromAgentTool(tool);
		expect(def.executionMode).toBe("parallel");
	});

	it("execute delegates to AgentTool.execute without ctx", async () => {
		let capturedArgs: unknown[] = [];
		const tool = makeAgentTool({
			execute: async (toolCallId, params, signal, onUpdate) => {
				capturedArgs = [toolCallId, params, signal, onUpdate];
				return { content: [{ type: "text", text: "from agent" }], details: undefined };
			},
		});
		const def = createToolDefinitionFromAgentTool(tool);
		const signal = new AbortController().signal;
		const onUpdate = () => {};
		const result = await def.execute("tc-1", { input: "x" }, signal, onUpdate);
		expect(result.content[0]).toEqual({ type: "text", text: "from agent" });
		expect(capturedArgs[0]).toBe("tc-1");
		expect(capturedArgs[1]).toEqual({ input: "x" });
		expect(capturedArgs[2]).toBe(signal);
		expect(capturedArgs[3]).toBe(onUpdate);
	});

	it("does not include renderCall or renderResult", () => {
		const tool = makeAgentTool();
		const def = createToolDefinitionFromAgentTool(tool);
		expect((def as any).renderCall).toBeUndefined();
		expect((def as any).renderResult).toBeUndefined();
	});
});
