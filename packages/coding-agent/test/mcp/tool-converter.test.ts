import { describe, expect, it, vi } from "vitest";
import type { McpManager } from "../../src/core/mcp/mcp-manager.js";
import { createMcpToolDefinition } from "../../src/core/mcp/tool-converter.js";
import type { DiscoveredTool } from "../../src/core/mcp/types.js";

function makeTool(overrides: Partial<DiscoveredTool> = {}): DiscoveredTool {
	return {
		serverName: "test-server",
		originalName: "testTool",
		fullName: "mcp__test-server__testTool",
		description: "A test tool",
		inputSchema: { type: "object", properties: {} },
		...overrides,
	};
}

describe("createMcpToolDefinition", () => {
	it("returns correct name, label, description", () => {
		const tool = makeTool();
		const manager = { callTool: vi.fn() } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);

		expect(def.name).toBe("mcp__test-server__testTool");
		expect(def.label).toBe("test-server/testTool");
		expect(def.description).toBe("A test tool");
		expect(def.parameters).toBeDefined();
	});

	it("uses fallback description when empty", () => {
		const tool = makeTool({ description: "" });
		const manager = { callTool: vi.fn() } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);

		expect(def.description).toBe("MCP tool: testTool (from test-server)");
	});

	it("execute calls manager.callTool and returns text result", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "hello world" }],
		});
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", { key: "val" }, undefined, undefined, undefined as any);

		expect(callTool).toHaveBeenCalledWith("mcp__test-server__testTool", { key: "val" });
		expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
	});

	it("execute handles image content", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({
			content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
		});
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: "[image: image/png]" }]);
	});

	it("execute handles non-standard content with JSON.stringify", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({
			content: [{ type: "resource", uri: "file:///test" }],
		});
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: '{"type":"resource","uri":"file:///test"}' }]);
	});

	it("execute joins multiple content items with newline", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({
			content: [
				{ type: "text", text: "line1" },
				{ type: "text", text: "line2" },
			],
		});
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: "line1\nline2" }]);
	});

	it("execute handles result without content array", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({ some: "data" });
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: '{\n  "some": "data"\n}' }]);
	});

	it("execute handles manager.callTool Error", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockRejectedValue(new Error("server down"));
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: "MCP error: server down" }]);
	});

	it("execute handles non-Error thrown value", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockRejectedValue("string error");
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.content).toEqual([{ type: "text", text: "MCP error: string error" }]);
	});

	it("execute returns details as undefined", async () => {
		const tool = makeTool();
		const callTool = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});
		const manager = { callTool } as unknown as McpManager;
		const def = createMcpToolDefinition(tool, manager);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as any);

		expect(result.details).toBeUndefined();
	});
});
