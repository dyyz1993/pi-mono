import { describe, expect, it } from "vitest";
import {
	computeRuleStats,
	extractSnippet,
	type HookLogEntry,
	RingBuffer,
	truncateMiddle,
} from "../../extensions/claude-hooks-compat/hooks-log.js";

describe("RingBuffer", () => {
	it("should push and snapshot items", () => {
		const buf = new RingBuffer<number>(5);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		expect(buf.snapshot()).toEqual([1, 2, 3]);
		expect(buf.size).toBe(3);
		expect(buf.total).toBe(3);
	});

	it("should overwrite oldest when capacity exceeded", () => {
		const buf = new RingBuffer<number>(3);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		buf.push(4);
		buf.push(5);
		expect(buf.snapshot()).toEqual([3, 4, 5]);
		expect(buf.size).toBe(3);
		expect(buf.total).toBe(5);
	});

	it("should respect limit in snapshot", () => {
		const buf = new RingBuffer<number>(10);
		for (let i = 0; i < 10; i++) buf.push(i);
		expect(buf.snapshot(3)).toEqual([7, 8, 9]);
	});

	it("should return empty for empty buffer", () => {
		const buf = new RingBuffer<number>(5);
		expect(buf.snapshot()).toEqual([]);
		expect(buf.size).toBe(0);
	});

	it("should clear the buffer", () => {
		const buf = new RingBuffer<number>(5);
		buf.push(1);
		buf.push(2);
		buf.clear();
		expect(buf.snapshot()).toEqual([]);
		expect(buf.size).toBe(0);
		expect(buf.total).toBe(0);
	});

	it("should handle exact capacity wrap-around", () => {
		const buf = new RingBuffer<number>(3);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		// Buffer is full, head wraps to 0
		buf.push(4);
		expect(buf.snapshot()).toEqual([2, 3, 4]);
	});
});

describe("truncateMiddle", () => {
	it("should not truncate short strings", () => {
		expect(truncateMiddle("hello", 10)).toBe("hello");
	});

	it("should truncate with ... in middle", () => {
		const result = truncateMiddle("abcdefghijklmnopqrstuvwxyz", 10);
		expect(result.length).toBe(10);
		expect(result).toContain("...");
	});

	it("should handle exact length", () => {
		expect(truncateMiddle("12345", 5)).toBe("12345");
	});
});

describe("extractSnippet", () => {
	it("should extract command from bash input", () => {
		expect(extractSnippet({ command: "git status" })).toBe("git status");
	});

	it("should extract path from read input", () => {
		expect(extractSnippet({ filePath: "/foo/bar.ts" })).toBe("/foo/bar.ts");
	});

	it("should extract path from edit input", () => {
		expect(extractSnippet({ path: "/foo/baz.ts" })).toBe("/foo/baz.ts");
	});

	it("should truncate long commands", () => {
		const longCmd = "a".repeat(200);
		const result = extractSnippet({ command: longCmd });
		expect(result.length).toBe(120);
		expect(result).toContain("...");
	});

	it("should fallback to JSON for unknown input", () => {
		const result = extractSnippet({ foo: "bar" });
		expect(result).toContain("foo");
	});
});

describe("computeRuleStats", () => {
	it("should aggregate stats by rule", () => {
		const entries: HookLogEntry[] = [
			makeEntry("PreToolUse", "Bash", "command", "bash guard.sh", "allow"),
			makeEntry("PreToolUse", "Bash", "command", "bash guard.sh", "block"),
			makeEntry("PreToolUse", "Bash", "command", "bash guard.sh", "allow"),
			makeEntry("PostToolUse", "Bash", "command", "bash log.sh", "allow"),
		];

		const stats = computeRuleStats(entries);
		expect(stats).toHaveLength(2);

		const bashGuard = stats.find((s) => s.command === "bash guard.sh");
		expect(bashGuard).toBeDefined();
		expect(bashGuard!.allowCount).toBe(2);
		expect(bashGuard!.blockCount).toBe(1);
		expect(bashGuard!.askCount).toBe(0);

		const bashLog = stats.find((s) => s.command === "bash log.sh");
		expect(bashLog).toBeDefined();
		expect(bashLog!.allowCount).toBe(1);
	});

	it("should return empty for empty entries", () => {
		expect(computeRuleStats([])).toEqual([]);
	});

	it("should sort by event then matcher", () => {
		const entries: HookLogEntry[] = [
			makeEntry("PreToolUse", "Read", "command", "cmd", "allow"),
			makeEntry("PreToolUse", "Bash", "command", "cmd", "allow"),
			makeEntry("PostToolUse", "Bash", "command", "cmd", "allow"),
		];

		const stats = computeRuleStats(entries);
		// Sorted: PostToolUse < PreToolUse alphabetically, Bash < Read within same event
		expect(stats[0].event).toBe("PostToolUse");
		expect(stats[0].matcher).toBe("Bash");
		expect(stats[1].event).toBe("PreToolUse");
		expect(stats[1].matcher).toBe("Bash");
		expect(stats[2].event).toBe("PreToolUse");
		expect(stats[2].matcher).toBe("Read");
	});
});

function makeEntry(
	event: string,
	matcher: string,
	hookType: "command" | "http" | "prompt" | "agent" | "mcp_tool",
	command: string,
	decision: "allow" | "block" | "ask",
): HookLogEntry {
	return {
		id: 0,
		timestamp: Date.now(),
		durationMs: 10,
		event,
		toolName: "bash",
		matcher,
		hookType,
		command,
		decision,
		reason: decision === "block" ? "blocked" : "",
		exitCode: decision === "block" ? 2 : 0,
		source: "global",
		snippet: "test",
	};
}
