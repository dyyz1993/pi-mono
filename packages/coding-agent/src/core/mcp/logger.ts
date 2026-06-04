export type LogLevel = "debug" | "info" | "warn" | "error";

export class McpLogger {
	private minLevel: LogLevel;
	private readonly levels: Record<LogLevel, number> = {
		debug: 0,
		info: 1,
		warn: 2,
		error: 3,
	};

	constructor(minLevel: LogLevel = "info") {
		this.minLevel = minLevel;
	}

	debug(server: string, msg: string, ...args: unknown[]): void {
		this.log("debug", server, msg, ...args);
	}

	info(server: string, msg: string, ...args: unknown[]): void {
		this.log("info", server, msg, ...args);
	}

	warn(server: string, msg: string, ...args: unknown[]): void {
		this.log("warn", server, msg, ...args);
	}

	error(server: string, msg: string, ...args: unknown[]): void {
		this.log("error", server, msg, ...args);
	}

	private log(level: LogLevel, server: string, msg: string, ...args: unknown[]): void {
		if (this.levels[level] < this.levels[this.minLevel]) return;
		const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
		fn(`[mcp:${level}] [${server}] ${msg}`, ...args);
	}
}
