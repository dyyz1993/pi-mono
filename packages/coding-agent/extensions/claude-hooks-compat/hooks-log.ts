/**
 * Hooks execution log — in-memory ring buffer for hook execution records.
 *
 * Session-scoped: lives as long as the claude-hooks-compat extension instance.
 * No persistence, no disk I/O. GC'd when the session ends.
 */

/** Single hook execution record */
export interface HookLogEntry {
	/** Monotonically increasing ID */
	id: number;
	/** Unix timestamp (ms) */
	timestamp: number;
	/** Execution duration in ms */
	durationMs: number;
	/** Hook event name: "PreToolUse", "PostToolUse", "Stop", etc. */
	event: string;
	/** Tool name that triggered this hook: "bash", "read", "*", "" */
	toolName: string;
	/** Matcher pattern from the config group: "Bash", "Read|Write|Edit", "" */
	matcher: string;
	/** Hook handler type */
	hookType: "command" | "http" | "prompt" | "agent" | "mcp_tool";
	/** Actual command/URL/prompt executed (truncated if too long) */
	command: string;
	/** Hook decision */
	decision: "allow" | "block" | "ask";
	/** Block/ask reason (if any) */
	reason: string;
	/** Subprocess exit code */
	exitCode: number;
	/** Config source scope */
	source: "policy" | "global" | "project" | "local" | "unknown";
	/** Snippet of tool input (e.g. bash command, first 120 chars) */
	snippet: string;
}

/** Aggregated stats per rule */
export interface HookRuleStats {
	/** Matcher pattern */
	matcher: string;
	/** Hook event name */
	event: string;
	/** Handler type */
	hookType: string;
	/** Command/URL/prompt (may be truncated) */
	command: string;
	/** Config source */
	source: string;
	/** Total allow count */
	allowCount: number;
	/** Total block count */
	blockCount: number;
	/** Total ask count */
	askCount: number;
}

/** Config file info */
export interface HookConfigSource {
	/** File path */
	path: string;
	/** Scope */
	scope: "policy" | "global" | "project" | "local";
	/** Whether the file exists */
	exists: boolean;
	/** Whether hooks are disabled in this file */
	disabled: boolean;
}

/** Full config snapshot */
export interface HookConfigSnapshot {
	sources: HookConfigSource[];
	events: {
		name: string;
		groups: {
			matcher: string;
			source: string;
			hooks: {
				type: string;
				command?: string;
				url?: string;
				prompt?: string;
				timeout?: number;
				async?: boolean;
				once?: boolean;
				if?: string;
			}[];
		}[];
	}[];
}

/** Response for getLog */
export interface HookLogResult {
	entries: HookLogEntry[];
	ruleStats: HookRuleStats[];
	totalExecutions: number;
	configSnapshot: HookConfigSnapshot;
}

const MAX_SNIPPET_LEN = 120;
const MAX_COMMAND_DISPLAY_LEN = 200;

/**
 * Fixed-capacity ring buffer. FIFO, overwrites oldest when full.
 */
export class RingBuffer<T> {
	private buf: (T | undefined)[];
	private head = 0;
	private totalCount = 0;

	constructor(private readonly capacity: number) {
		this.buf = new Array(capacity);
	}

	push(item: T): void {
		this.buf[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		this.totalCount++;
	}

	/** Return the most recent `limit` items in chronological order (oldest first) */
	snapshot(limit?: number): T[] {
		const size = this.size;
		const take = limit !== undefined ? Math.min(limit, size) : size;
		const start = this.head - take;
		const result: T[] = [];
		for (let i = 0; i < take; i++) {
			const idx = ((start + i) % this.capacity + this.capacity) % this.capacity;
			const item = this.buf[idx];
			if (item !== undefined) result.push(item);
		}
		return result;
	}

	clear(): void {
		this.buf = new Array(this.capacity);
		this.head = 0;
		this.totalCount = 0;
	}

	get size(): number {
		return Math.min(this.totalCount, this.capacity);
	}

	get total(): number {
		return this.totalCount;
	}
}

/** Truncate a string to maxLen, inserting "..." in the middle if needed */
export function truncateMiddle(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	const prefixLen = Math.floor((maxLen - 3) / 2);
	const suffixLen = maxLen - 3 - prefixLen;
	return str.slice(0, prefixLen) + "..." + str.slice(str.length - suffixLen);
}

/** Extract a snippet from tool input (e.g. bash command) */
export function extractSnippet(toolInput: Record<string, unknown>): string {
	const cmd = toolInput.command as string | undefined;
	if (cmd) return truncateMiddle(cmd, MAX_SNIPPET_LEN);
	const path = (toolInput.filePath ?? toolInput.path) as string | undefined;
	if (path) return truncateMiddle(path, MAX_SNIPPET_LEN);
	return truncateMiddle(JSON.stringify(toolInput), MAX_SNIPPET_LEN);
}

/** Compute aggregated stats from log entries */
export function computeRuleStats(entries: HookLogEntry[]): HookRuleStats[] {
	const map = new Map<string, HookRuleStats>();

	for (const entry of entries) {
		const key = `${entry.event}|${entry.matcher}|${entry.hookType}|${entry.command}|${entry.source}`;
		let stats = map.get(key);
		if (!stats) {
			stats = {
				matcher: entry.matcher,
				event: entry.event,
				hookType: entry.hookType,
				command: entry.command,
				source: entry.source,
				allowCount: 0,
				blockCount: 0,
				askCount: 0,
			};
			map.set(key, stats);
		}
		if (entry.decision === "allow") stats.allowCount++;
		else if (entry.decision === "block") stats.blockCount++;
		else if (entry.decision === "ask") stats.askCount++;
	}

	return Array.from(map.values()).sort((a, b) => {
		// Sort by event name, then matcher
		if (a.event !== b.event) return a.event.localeCompare(b.event);
		return a.matcher.localeCompare(b.matcher);
	});
}
