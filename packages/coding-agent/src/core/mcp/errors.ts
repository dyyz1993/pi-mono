export class McpError extends Error {
	readonly code: string;
	readonly serverName?: string;
	readonly toolName?: string;

	constructor(code: string, message: string, serverName?: string, toolName?: string) {
		super(message);
		this.code = code;
		this.serverName = serverName;
		this.toolName = toolName;
		this.name = "McpError";
	}
}

export class McpConnectionError extends McpError {
	constructor(serverName: string, message: string) {
		super("CONNECTION_ERROR", message, serverName);
		this.name = "McpConnectionError";
	}
}

export class McpToolCallError extends McpError {
	constructor(serverName: string, toolName: string, message: string) {
		super("TOOL_CALL_ERROR", message, serverName, toolName);
		this.name = "McpToolCallError";
	}
}

export class McpTimeoutError extends McpError {
	constructor(operation: string, serverName: string, timeoutMs: number) {
		super("TIMEOUT", `${operation} timed out after ${timeoutMs}ms`, serverName);
		this.name = "McpTimeoutError";
	}
}
