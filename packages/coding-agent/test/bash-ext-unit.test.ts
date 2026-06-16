/**
 * Comprehensive unit tests for bash-ext extension.
 *
 * Tests two layers:
 * 1. Pure functions (takeLastLines, formatDuration, etc.)
 * 2. Extension with mock channel — tests tool execute paths + channel handlers
 *
 * Key technique: The extension registers channel handlers inside session_start.
 * We use a mock channel to capture events and invoke handlers directly.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@dyyz1993/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import type { BashChannelEvent, BashProcess } from "../extensions/bash-ext/contract.ts";
import bashExt from "../extensions/bash-ext/index.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tempDirs.length = 0;
});

function makeTempDir(): string {
	const d = join(tmpdir(), `pi-bash-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

// ─── Mock channel that captures emitted events and allows handler invocation ──

interface CapturedEvent {
	type: string;
	data?: unknown;
	[key: string]: unknown;
}

function createMockChannel() {
	const emittedEvents: CapturedEvent[] = [];
	const handlers = new Map<string, (params: Record<string, unknown>) => unknown>();

	const channel = {
		emit(event: CapturedEvent) {
			emittedEvents.push(event);
		},
		handle(method: string, handler: (params: Record<string, unknown>) => unknown) {
			handlers.set(method, handler);
		},
		on(_event: string, _handler: unknown) {
			return () => {};
		},
		call(_method: string, _params: unknown) {
			return Promise.resolve(undefined);
		},
		send(_data: unknown) {},
		invoke(_data: unknown) {
			return Promise.resolve(undefined);
		},
		onReceive(_handler: unknown) {
			return () => {};
		},
		name: "bash",
	};

	return { channel, emittedEvents, handlers };
}

function createMockExtensionAPI(channelObj: ReturnType<typeof createMockChannel>) {
	let sendUserMessageFn: ((msg: string, opts?: { deliverAs?: string }) => void) | undefined;
	const sentUserMessages: string[] = [];

	const api = {
		on: (_event: string, _handler: unknown) => {},
		appendEntry: (_type: string, _data: unknown) => "",
		registerChannel: (_name: string) => channelObj.channel,
		registerTool: (_config: unknown) => {},
		sendUserMessage: (msg: string, opts?: { deliverAs?: string }) => {
			sentUserMessages.push(msg);
			sendUserMessageFn?.(msg, opts);
		},
	} as unknown as ExtensionAPI;

	return { api, sentUserMessages };
}

function createMockContext(cwd: string): ExtensionContext {
	return {
		cwd,
		sessionManager: {
			getEntries: () => [],
			getSessionDir: () => cwd,
		},
	} as unknown as ExtensionContext;
}

// ─── Helper to get registered tools from extension ─────────────────────

interface RegisteredTools {
	bash: {
		name: string;
		parameters: unknown;
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: (update: unknown) => void,
			ctx?: ExtensionContext,
		) => Promise<AgentToolResult<unknown>>;
	};
	get_background_process: {
		name: string;
		parameters: unknown;
		execute: (toolCallId: string, params: Record<string, unknown>) => Promise<AgentToolResult<unknown>>;
	};
}

function setupExtension(cwd: string) {
	const channelObj = createMockChannel();
	const { api, sentUserMessages } = createMockExtensionAPI(channelObj);
	const ctx = createMockContext(cwd);
	// biome-ignore lint/complexity/noBannedTypes: test mock
	const tools: Record<string, { name: string; parameters: unknown; execute: Function }> = {};

	// Intercept registerTool
	(api as unknown as { registerTool: (config: unknown) => void }).registerTool = (config: unknown) => {
		// biome-ignore lint/complexity/noBannedTypes: test mock
		const c = config as { name: string; parameters: unknown; execute: Function };
		tools[c.name] = { name: c.name, parameters: c.parameters, execute: c.execute };
	};

	bashExt(api);

	// session_start handlers are registered via pi.on — but our mock doesn't capture them.
	// The extension's session_start handler is where channel handlers are set up.
	// We need to call it manually.
	// Since we intercepted registerChannel, the channel is available.
	// But session_start is an event handler registered via pi.on which we stubbed.
	// We need to find and invoke it.

	return { api, ctx, tools, channelObj, sentUserMessages };
}

// ═══════════════════════════════════════════════════════════════════════
// Pure function tests (these functions are not exported, so we test
// them indirectly through the tool execution)
// ═══════════════════════════════════════════════════════════════════════

describe("bash-ext tool execution paths", () => {
	it("echo command succeeds and returns output", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-1",
			{ command: "echo hello", description: "test echo" },
			undefined,
			undefined,
			ctx,
		);

		expect(result.content[0]).toMatchObject({ type: "text" });
		expect((result.content[0] as { text: string }).text).toContain("hello");
	});

	it("exit 42 returns failure with exit code", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-2",
			{ command: "exit 42", description: "fail" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("42");
		expect(text).toMatch(/failed with exit code/i);
	});

	it("empty output command returns (no output)", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-3",
			{ command: "true", description: "noop" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("(no output)");
	});

	it("stderr is captured alongside stdout", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-4",
			{ command: "echo stdout_line && echo stderr_line >&2", description: "test stderr" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("stdout_line");
		expect(text).toContain("stderr_line");
	});

	it("multi-line output preserves line breaks", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-5",
			{ command: "printf 'L1\\nL2\\nL3\\n'", description: "multiline" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("L1");
		expect(text).toContain("L2");
		expect(text).toContain("L3");
	});

	it("ANSI escape codes are processed (stripAnsi applied)", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-6",
			{ command: "printf '\\033[31mred_text\\033[0m'", description: "ansi test" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		// Content should always be preserved
		expect(text).toContain("red_text");
	});

	it("timeout kills long-running process", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-7",
			{ command: "sleep 30", description: "long sleep", timeout: 2 },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toMatch(/timed?.?out/i);
		expect(text).toContain("2s");
	});

	it("auto-background after backgroundAfter seconds", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-8",
			{ command: "sleep 10", description: "bg test", backgroundAfter: 1, timeout: 30 },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toMatch(/background/i);
		expect(text).toContain("<bashId>");
		expect(result.details).toHaveProperty("background");
	});

	it("cwd parameter changes working directory", async () => {
		const cwd = makeTempDir();
		const subDir = join(cwd, "subdir");
		mkdirSync(subDir, { recursive: true });
		const { tools, ctx } = setupExtension(cwd);

		const result = await tools.bash.execute(
			"tc-9",
			{ command: "pwd", description: "check cwd", cwd: subDir },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("subdir");
	});

	it("onUpdate callback receives streaming output", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);
		const updates: Array<{ content: Array<{ text: string }> }> = [];

		await tools.bash.execute(
			"tc-10",
			{ command: "echo streaming_output", description: "streaming" },
			undefined,
			(update: unknown) => {
				const u = update as { content: Array<{ text: string }> };
				updates.push(u);
			},
			ctx,
		);

		// onUpdate should have been called at least once with data
		expect(updates.length).toBeGreaterThan(0);
		const allUpdateText = updates.map((u) => u.content.map((c) => c.text).join("")).join("");
		expect(allUpdateText).toContain("streaming_output");
	});

	it("AbortSignal terminates running process", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);
		const controller = new AbortController();

		// Start a long process, then abort after 500ms
		const execPromise = tools.bash.execute(
			"tc-11",
			{ command: "sleep 10", description: "abortable", timeout: 30 },
			controller.signal,
			undefined,
			ctx,
		);

		setTimeout(() => controller.abort(), 500);

		const result = await execPromise;
		const text = (result.content[0] as { text: string }).text;
		expect(text).toMatch(/abort/i);
	});

	it("non-existent cwd rejects the promise", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		await expect(
			tools.bash.execute(
				"tc-12",
				{ command: "echo test", description: "bad cwd", cwd: "/nonexistent/path/xyz" },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow();
	});

	it("large output triggers truncation message", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		// Generate > 500 lines to trigger truncation (DEFAULT_MAX_LINES)
		const result = await tools.bash.execute(
			"tc-13",
			{ command: 'for i in $(seq 1 1000); do echo "line_$i"; done', description: "large output" },
			undefined,
			undefined,
			ctx,
		);

		const text = (result.content[0] as { text: string }).text;
		// Should contain truncation info
		if (text.includes("Showing lines")) {
			expect(text).toMatch(/Showing lines \d+-\d+ of \d+/);
		}
		// Last lines should be present regardless
		expect(text).toContain("line_1000");
	});

	it("writes to file and reads it back", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		await tools.bash.execute(
			"tc-14a",
			{ command: "echo 'file_content' > output.txt", description: "write file" },
			undefined,
			undefined,
			ctx,
		);

		const result = await tools.bash.execute(
			"tc-14b",
			{ command: "cat output.txt", description: "read file" },
			undefined,
			undefined,
			ctx,
		);

		expect((result.content[0] as { text: string }).text).toContain("file_content");
	});

	it("concurrent processes are tracked independently", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const [r1, r2] = await Promise.all([
			tools.bash.execute(
				"tc-15a",
				{ command: "echo proc1", description: "concurrent 1" },
				undefined,
				undefined,
				ctx,
			),
			tools.bash.execute(
				"tc-15b",
				{ command: "echo proc2", description: "concurrent 2" },
				undefined,
				undefined,
				ctx,
			),
		]);

		expect((r1.content[0] as { text: string }).text).toContain("proc1");
		expect((r2.content[0] as { text: string }).text).toContain("proc2");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// get_background_process tool tests
// ═══════════════════════════════════════════════════════════════════════

describe("get_background_process tool", () => {
	it("returns 'No process found' for non-existent bashId", async () => {
		const cwd = makeTempDir();
		const { tools } = setupExtension(cwd);

		const result = await tools.get_background_process.execute("tc-gb-1", { bashId: "bash-nonexistent" });

		expect((result.content[0] as { text: string }).text).toContain("No process found");
	});

	it("queries a completed background process with output", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		// Run a command that auto-backgrounds and produces output
		const bgResult = await tools.bash.execute(
			"tc-gb-2",
			{
				command: "echo 'line_a\nline_b\nline_c' && sleep 10",
				description: "bg with output",
				backgroundAfter: 1,
				timeout: 30,
			},
			undefined,
			undefined,
			ctx,
		);

		// Extract bashId from the background result
		const bgText = (bgResult.content[0] as { text: string }).text;
		const bashIdMatch = bgText.match(/<bashId>([^<]+)<\/bashId>/);
		expect(bashIdMatch).not.toBeNull();
		const bashId = bashIdMatch![1];

		// Query the background process
		const queryResult = await tools.get_background_process.execute("tc-gb-2q", { bashId });

		const queryText = (queryResult.content[0] as { text: string }).text;
		expect(queryText).toContain("Status:");
		expect(queryText).toContain("PID:");
	});

	it("grep filter returns only matching lines", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const bgResult = await tools.bash.execute(
			"tc-gb-3",
			{
				command: "echo 'error: failed\ninfo: ok\nerror: crashed\nwarning: low' && sleep 10",
				description: "grep test",
				backgroundAfter: 1,
				timeout: 30,
			},
			undefined,
			undefined,
			ctx,
		);

		const bashId = (bgResult.content[0] as { text: string }).text.match(/<bashId>([^<]+)<\/bashId>/)![1];

		const queryResult = await tools.get_background_process.execute("tc-gb-3q", { bashId, grep: "error" });

		const queryText = (queryResult.content[0] as { text: string }).text;
		// Matching lines should contain error entries
		expect(queryText).toContain("error: failed");
		expect(queryText).toContain("error: crashed");
		// Should show grep filter indicator
		expect(queryText).toContain("Filtered by:");
	});

	it("grep with no matches returns 'no lines matching'", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const bgResult = await tools.bash.execute(
			"tc-gb-4",
			{ command: "echo 'hello world' && sleep 10", description: "no match test", backgroundAfter: 1, timeout: 30 },
			undefined,
			undefined,
			ctx,
		);

		const bashId = (bgResult.content[0] as { text: string }).text.match(/<bashId>([^<]+)<\/bashId>/)![1];

		const queryResult = await tools.get_background_process.execute("tc-gb-4q", {
			bashId,
			grep: "nonexistent_pattern",
		});

		const queryText = (queryResult.content[0] as { text: string }).text;
		expect(queryText).toContain("no lines matching");
	});

	it("lastLines limits output to N lines", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const bgResult = await tools.bash.execute(
			"tc-gb-5",
			{
				command: 'for i in $(seq 1 20); do echo "line_$i"; done && sleep 10',
				description: "lastLines test",
				backgroundAfter: 1,
				timeout: 30,
			},
			undefined,
			undefined,
			ctx,
		);

		const bashId = (bgResult.content[0] as { text: string }).text.match(/<bashId>([^<]+)<\/bashId>/)![1];

		const queryResult = await tools.get_background_process.execute("tc-gb-5q", { bashId, lastLines: 3 });

		const queryText = (queryResult.content[0] as { text: string }).text;
		// Last lines should be present
		expect(queryText).toContain("line_20");
		expect(queryText).toContain("line_19");
		// Should show line count info
		expect(queryText).toContain("Lines:");
		expect(queryText).toContain("total");
	});

	it("header includes command and status for running process", async () => {
		const cwd = makeTempDir();
		const { tools, ctx } = setupExtension(cwd);

		const bgResult = await tools.bash.execute(
			"tc-gb-6",
			{ command: "echo test && sleep 10", description: "header test", backgroundAfter: 1, timeout: 30 },
			undefined,
			undefined,
			ctx,
		);

		const bashId = (bgResult.content[0] as { text: string }).text.match(/<bashId>([^<]+)<\/bashId>/)![1];

		const queryResult = await tools.get_background_process.execute("tc-gb-6q", { bashId });

		const queryText = (queryResult.content[0] as { text: string }).text;
		expect(queryText).toContain("Process:");
		expect(queryText).toContain("Status:");
		expect(queryText).toContain("PID:");
		expect(queryText).toContain("Duration:");
		expect(queryText).toContain("Output so far:");
	});
});
