export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}

export interface McpRemoteConfig {
  type: "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export type McpServerConfig = McpStdioConfig | McpRemoteConfig;

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface DiscoveredTool {
  serverName: string;
  originalName: string;
  fullName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface McpConnection {
  name: string;
  config: McpServerConfig;
  status: ConnectionStatus;
  error?: string;
  tools: DiscoveredTool[];
}
