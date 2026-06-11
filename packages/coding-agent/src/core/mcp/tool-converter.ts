import { Type } from "@dyyz1993/pi-ai";
import { asRecord } from "../../utils/type-helpers.ts";
import { defineTool } from "../extensions/types.ts";
import type { McpManager } from "./mcp-manager.ts";
import type { DiscoveredTool } from "./types.ts";

export function createMcpToolDefinition(tool: DiscoveredTool, manager: McpManager): ReturnType<typeof defineTool> {
	return defineTool({
		name: tool.fullName,
		label: `${tool.serverName}/${tool.originalName}`,
		description: tool.description || `MCP tool: ${tool.originalName} (from ${tool.serverName})`,
		// MCP servers return JSON Schema which may not conform to TypeBox's stricter
		// internal representation. Using Type.Unsafe preserves the schema for runtime
		// validation while bridging the type gap.
		parameters: Type.Unsafe(tool.inputSchema),
		async execute(_toolCallId, params) {
			try {
				const result = (await manager.callTool(tool.fullName, asRecord(params))) as {
					content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
				};
				return formatResult(result);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return { content: [{ type: "text", text: `MCP error: ${msg}` }], details: undefined };
			}
		},
	});
}

function formatResult(result: { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }): {
	content: Array<{ type: "text"; text: string }>;
	details: undefined;
} {
	if (result?.content && Array.isArray(result.content)) {
		const text = result.content
			.map((c) => {
				if (c.type === "text") return c.text ?? "";
				if (c.type === "image" && c.data) return `[image: ${c.mimeType}]`;
				return JSON.stringify(c);
			})
			.join("\n");
		return { content: [{ type: "text", text }], details: undefined };
	}
	return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: undefined };
}
