export class McpError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly serverName?: string,
		public readonly toolName?: string,
	) {
		super(message);
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
