export interface McpStdioServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	disabled?: boolean;
}

export interface McpSseServerConfig {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
	disabled?: boolean;
}

export interface McpStreamableHttpServerConfig {
	type: "streamable-http";
	url: string;
	headers?: Record<string, string>;
	disabled?: boolean;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig | McpStreamableHttpServerConfig;

export interface McpManagerOptions {
	logLevel?: "debug" | "info" | "warn" | "error";
	connectTimeoutMs?: number;
	callTimeoutMs?: number;
	maxReconnectAttempts?: number;
	maxConcurrentCalls?: number;
}

export interface McpSettings {
	servers?: Record<string, McpServerConfig>;
	options?: Omit<McpManagerOptions, "maxConcurrentCalls">;
}

export interface DiscoveredTool {
	serverName: string;
	originalName: string;
	fullName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export type ConnectionStatus = "connecting" | "connected" | "error" | "disconnected";

export interface McpConnection {
	name: string;
	config: McpServerConfig;
	status: ConnectionStatus;
	error?: string;
	tools: DiscoveredTool[];
}

export interface McpManagerEvents {
	onConnectionChange?: (connection: McpConnection) => void;
}
