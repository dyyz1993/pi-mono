import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpConfig, McpServerConfig } from "./types.js";

const CONFIG_FILENAME = "mcp.json";

export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    return envDir.startsWith("~") ? envDir.replace("~", homedir()) : envDir;
  }
  return join(homedir(), ".pi", "agent");
}

export function loadMcpConfig(
  cwd: string,
  agentDir: string,
): Record<string, McpServerConfig> {
  const globalServers = readConfigFile(join(agentDir, CONFIG_FILENAME));
  const projectServers = readConfigFile(join(cwd, ".pi", CONFIG_FILENAME));
  return { ...globalServers, ...projectServers };
}

function readConfigFile(filePath: string): Record<string, McpServerConfig> {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    const config: McpConfig = JSON.parse(content);
    return config.mcpServers ?? {};
  } catch {
    return {};
  }
}
