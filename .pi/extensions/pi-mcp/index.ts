import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import { McpManager } from "./mcp-manager.js";
import { loadMcpConfig, getAgentDir } from "./config.js";
import { createToolDefinition } from "./tool-converter.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    const agentDir = getAgentDir();
    const servers = loadMcpConfig(ctx.cwd, agentDir);

    const enabledServers = Object.entries(servers).filter(
      ([_, c]) => !c.disabled,
    );
    if (enabledServers.length === 0) return;

    const manager = new McpManager();

    try {
      await manager.connectAll(servers);

      const tools = manager.getAllTools();
      for (const tool of tools) {
        pi.registerTool(createToolDefinition(tool, manager));
      }

      if (tools.length === 0) {
        console.log("[pi-mcp] No tools discovered");
      }
    } catch (e) {
      console.error("[pi-mcp] Failed to initialize:", e);
    }

    ctx.sessionSignal.addEventListener("abort", () => {
      manager.disconnectAll().catch(() => {});
    });
  });
}
