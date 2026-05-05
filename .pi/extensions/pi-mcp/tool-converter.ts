import { Type } from "@dyyz1993/pi-ai";
import { defineTool } from "@dyyz1993/pi-coding-agent";
import type { DiscoveredTool } from "./types.js";
import type { McpManager } from "./mcp-manager.js";

export function createToolDefinition(
  tool: DiscoveredTool,
  manager: McpManager,
) {
  return defineTool({
    name: tool.fullName,
    label: `${tool.serverName}/${tool.originalName}`,
    description:
      tool.description || `MCP tool: ${tool.originalName} (from ${tool.serverName})`,
    parameters: Type.Unsafe(tool.inputSchema) as any,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await manager.callTool(
          tool.fullName,
          params as Record<string, unknown>,
        );
        return formatResult(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `MCP error: ${msg}` }],
        };
      }
    },
  });
}

function formatResult(result: any) {
  if (result?.content && Array.isArray(result.content)) {
    const text = result.content
      .map((c: any) => {
        if (c.type === "text") return c.text;
        if (c.type === "image" && c.data) return `[image: ${c.mimeType}]`;
        return JSON.stringify(c);
      })
      .join("\n");
    return { content: [{ type: "text" as const, text }] };
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result, null, 2) },
    ],
  };
}
