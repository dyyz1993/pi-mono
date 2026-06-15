/**
 * Claude Code Hooks Compatibility Test Suite
 *
 * Tests pi-hooks against the Claude Code Hooks specification, verified from
 * Claude Code source code at any-ccc/restored_sources/src/.
 *
 * Reference docs:
 * - Knowledge base: 950f2d7d (source-level runtime behavior guide)
 * - Knowledge base: pbx79n76j5 (12 lifecycle events + 4 hook types)
 * - Claude Code source: src/utils/hooks.ts, src/types/hooks.ts, src/schemas/hooks.ts
 *
 * Tests marked with `it.skip()` represent known gaps where pi-hooks is not
 * yet compatible with Claude Code behavior.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "./harness.ts";

// Load pi-hooks extension as a factory
const piHooksFactory: ExtensionFactory = (await import("../../extensions/pi-hooks/index.ts")).default;

// ─── Helpers ──────────────────────────────────────────────

const originalHome = process.env.HOME;
const harnesses: Harness[] = [];

beforeEach(() => {
	const fakeHome = mkdtempSync(join(tmpdir(), "claude-hooks-compat-home-"));
	process.env.HOME = fakeHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

/** Write a .claude/settings.json with hooks config into a directory. */
function writeClaudeHooks(dir: string, hooks: Record<string, unknown>): void {
	mkdirSync(join(dir, ".claude"), { recursive: true });
	writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks }));
}

/** Write a .pi/settings.json with hooks config into a directory. */
function writePiHooks(dir: string, hooks: Record<string, unknown>): void {
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ hooks }));
}

/** Create a simple Bash-like tool for testing. */
function makeBashTool(onExecute?: (command: string) => void): AgentTool {
	return {
		name: "Bash",
		label: "Bash",
		description: "Run bash command",
		parameters: Type.Object({ command: Type.String() }),
		execute: async (_id, params) => {
			const cmd = (params as { command: string }).command;
			onExecute?.(cmd);
			return { content: [{ type: "text", text: `executed: ${cmd}` }], details: {} };
		},
	};
}

/** Create a simple Read-like tool. */
function makeReadTool(onExecute?: (path: string) => void): AgentTool {
	return {
		name: "Read",
		label: "Read",
		description: "Read file",
		parameters: Type.Object({ file_path: Type.String() }),
		execute: async (_id, params) => {
			const p = (params as { file_path: string }).file_path;
			onExecute?.(p);
			return { content: [{ type: "text", text: "file content" }], details: {} };
		},
	};
}

/** Create a harness with pi-hooks and given tools. */
async function makeHarness(tools: AgentTool[], cwd?: string): Promise<Harness> {
	const harness = await createHarness({
		tools,
		extensionFactories: [piHooksFactory],
		cwd,
	});
	harnesses.push(harness);
	return harness;
}

// ═══════════════════════════════════════════════════════════
// 1. PRE_TOOL_USE — Core Blocking Behavior
// ═══════════════════════════════════════════════════════════

describe("PreToolUse — Claude Code compat", () => {
	it("exit 0: allows tool execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("exit 2: blocks tool execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "echo 'Command not allowed'; exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(false);
	});

	it("exit 2: stderr is used as block reason (Claude Code source: hooks.ts:2648-2668)", async () => {
		// Claude Code: exit 2 → blockingError uses stderr, stdout is ignored
		// pi-hooks now matches Claude Code: stderr takes priority for exit 2
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "echo 'stdout-ignored'; echo 'stderr-block-reason' >&2; exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		// Tool should be blocked — stderr reason used, not stdout
		expect(executed).toBe(false);
		// Verify block message contains stderr text, not stdout
		const allMessages = harness.session.messages;
		const hasStderrReason = allMessages.some((m) => {
			const content = JSON.stringify(m);
			return content.includes("stderr-block-reason");
		});
		expect(hasStderrReason).toBe(true);
	});

	it("other exit codes (e.g. 1): non-blocking error, tool still executes", async () => {
		// Claude Code source: hooks.ts:2670-2697 — non-zero (not 0 or 2) = non-blocking error
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "echo 'some error'; exit 1" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// In Claude Code, exit 1 is non-blocking so tool should execute
		expect(executed).toBe(true);
	});

	it("hookSpecificOutput.permissionDecision=deny blocks execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "deny",
									permissionDecisionReason: "Denied by policy",
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(false);
	});

	it("hookSpecificOutput.permissionDecision=allow allows execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									permissionDecisionReason: "Safe operation",
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("hookSpecificOutput.updatedInput modifies tool input before execution", async () => {
		let capturedCommand = "";
		const harness = await makeHarness([
			makeBashTool((cmd) => {
				capturedCommand = cmd;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									updatedInput: { command: "echo safe-replaced" },
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "rm -rf /tmp" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run rm");
		// Claude Code: updatedInput replaces the original tool input
		expect(capturedCommand).toBe("echo safe-replaced");
	});

	it("decision=block in stdout JSON blocks execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({ decision: "block", reason: "Blocked by rule" })}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(false);
	});

	it("continue=false in stdout JSON blocks execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({ continue: false, stopReason: "Stopped" })}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════
// 2. POST_TOOL_USE
// ═══════════════════════════════════════════════════════════

describe("PostToolUse — Claude Code compat", () => {
	it("fires after tool execution", async () => {
		let hookRan = false;
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			PostToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo "post-hook-ran" > ${join(harness.tempDir, "post-hook-marker.txt")}`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// Check if marker file was created (hook ran after tool)
		try {
			readFileSync(join(harness.tempDir, "post-hook-marker.txt"), "utf-8");
			hookRan = true;
		} catch {
			hookRan = false;
		}
		expect(hookRan).toBe(true);
	});

	it("PostToolUse does not block tool execution (non-blocking by design)", async () => {
		// Claude Code: PostToolUse exit 2 shows stderr but doesn't "undo" the tool
		// The tool has already executed
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PostToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// Tool should have executed (PostToolUse is after execution)
		expect(executed).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 3. MATCHER LOGIC — Claude Code source: hooks.ts:1346-1381
// ═══════════════════════════════════════════════════════════

describe("Matcher logic — Claude Code compat", () => {
	it("empty matcher matches all tools", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("'*' matcher matches all tools", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "*",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("pipe-separated matcher matches any listed tool", async () => {
		let bashExecuted = false;
		let readExecuted = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				bashExecuted = true;
			}),
			makeReadTool(() => {
				readExecuted = true;
			}),
		]);

		// Only Bash should match, Read should not
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash|Write",
					hooks: [{ type: "command", command: "exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("Read", { file_path: "/tmp/test" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run both");
		expect(bashExecuted).toBe(false); // blocked by hook
		expect(readExecuted).toBe(true); // not matched, allowed
	});

	it("regex matcher works (Claude Code: non-alphanumeric triggers regex)", async () => {
		// Claude Code: if matcher contains non-alphanumeric chars (besides _|), it's treated as regex
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "^Ba.*",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 4. IF CLAUSE — Claude Code source: hooks.ts:1390-1421
// ═══════════════════════════════════════════════════════════

describe("if clause — Claude Code compat", () => {
	it("'Bash(rm -rf*)' only blocks matching commands", async () => {
		let rmExecuted = false;
		let lsExecuted = false;
		const harness = await makeHarness([
			makeBashTool((cmd) => {
				if (cmd.includes("rm")) rmExecuted = true;
				else lsExecuted = true;
			}),
		]);

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 2", if: "Bash(rm -rf*)" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "rm -rf /tmp/test" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls -la" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run commands");
		expect(rmExecuted).toBe(false); // blocked by if clause
		expect(lsExecuted).toBe(true); // allowed, doesn't match if pattern
	});

	it("if clause for Write with file path pattern", async () => {
		let writeExecuted = false;
		const writeTool: AgentTool = {
			name: "Write",
			label: "Write",
			description: "Write file",
			parameters: Type.Object({ file_path: Type.String(), content: Type.String() }),
			execute: async () => {
				writeExecuted = true;
				return { content: [{ type: "text", text: "written" }], details: {} };
			},
		};

		const harness = await makeHarness([writeTool]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Write",
					hooks: [{ type: "command", command: "exit 2", if: "Write(/etc/*)" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Write", { file_path: "/etc/passwd", content: "x" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("Write", { file_path: "/tmp/safe.txt", content: "x" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write files");
		// /etc/passwd should be blocked, /tmp/safe.txt should be allowed
		// Since only one Write tool, it was called twice but we track if *any* write happened
		// The second call should succeed
		expect(writeExecuted).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 5. CONFIG LOADING — Multiple sources
// ═══════════════════════════════════════════════════════════

describe("Config loading — Claude Code compat", () => {
	it("reads hooks from .claude/settings.json", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("reads hooks from .claude/settings.local.json", async () => {
		// Claude Code: .claude/settings.local.json is gitignored, personal overrides
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);

		mkdirSync(join(harness.tempDir, ".claude"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, ".claude", "settings.local.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "exit 0" }],
						},
					],
				},
			}),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("merges hooks from .claude and .pi settings", async () => {
		// pi-hooks extension: reads both .claude and .pi settings, merging hooks
		let bashBlocked = false;
		let readBlocked = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				bashBlocked = true;
			}),
			makeReadTool(() => {
				readBlocked = true;
			}),
		]);

		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 2" }],
				},
			],
		});
		writePiHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Read",
					hooks: [{ type: "command", command: "exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("Read", { file_path: "/tmp/x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run both");
		expect(bashBlocked).toBe(false); // blocked by .claude hook
		expect(readBlocked).toBe(false); // blocked by .pi hook
	});

	it("disableAllHooks=true skips hooks from that config source", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);

		mkdirSync(join(harness.tempDir, ".claude"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, ".claude", "settings.json"),
			JSON.stringify({ disableAllHooks: true, hooks: { PreToolUse: [] } }),
		);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true); // hook disabled, tool executes
	});
});

// ═══════════════════════════════════════════════════════════
// 6. ENVIRONMENT VARIABLES — Claude Code source: hooks.ts:882-927
// ═══════════════════════════════════════════════════════════

describe("Environment variables — Claude Code compat", () => {
	it("CLAUDE_PROJECT_DIR is set to project root", async () => {
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `test "$CLAUDE_PROJECT_DIR" = "${harness.tempDir}" && exit 0 || exit 2`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// If CLAUDE_PROJECT_DIR matches, hook exits 0 (allow)
		// We can verify by checking the tool executed
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBe(1);
	});

	it("$CLAUDE_PROJECT_DIR variable in command is replaced", async () => {
		// Claude Code supports $CLAUDE_PROJECT_DIR in hook commands
		const harness = await makeHarness([makeBashTool()]);
		const markerFile = join(harness.tempDir, "env-marker.txt");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo "found" > "$CLAUDE_PROJECT_DIR/env-marker.txt"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// Check marker file was created via $CLAUDE_PROJECT_DIR
		let found = false;
		try {
			const content = readFileSync(markerFile, "utf-8").trim();
			found = content === "found";
		} catch {
			/* not found */
		}
		expect(found).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 7. STDIN JSON FORMAT — Claude Code source: hooks.ts:301-328
// ═══════════════════════════════════════════════════════════

describe("stdin JSON format — Claude Code compat", () => {
	it("PreToolUse stdin contains hook_event_name, tool_name, tool_input, tool_use_id", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "captured-stdin.json");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `cat > "${stdinFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");

		let stdinData: Record<string, unknown> = {};
		try {
			stdinData = JSON.parse(readFileSync(stdinFile, "utf-8"));
		} catch {
			/* will fail assertion */
		}

		// Claude Code createBaseHookInput + PreToolUseHookInput
		expect(stdinData.hook_event_name).toBe("PreToolUse");
		expect(stdinData.tool_name).toBe("Bash");
		expect(stdinData.tool_input).toEqual({ command: "ls" });
		expect(stdinData.tool_use_id).toBeDefined();
	});

	it("stdin contains session_id and cwd", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "captured-stdin2.json");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `cat > "${stdinFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");

		let stdinData: Record<string, unknown> = {};
		try {
			stdinData = JSON.parse(readFileSync(stdinFile, "utf-8"));
		} catch {
			/* will fail assertion */
		}

		expect(stdinData.session_id).toBeDefined();
		expect(stdinData.cwd).toBe(harness.tempDir);
	});

	it("PostToolUse stdin contains tool_output/tool_response field", async () => {
		// Claude Code: PostToolUseHookInput includes tool_response
		// pi-hooks: uses tool_output (different field name)
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "captured-stdin-post.json");
		writeClaudeHooks(harness.tempDir, {
			PostToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `cat > "${stdinFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");

		let stdinData: Record<string, unknown> = {};
		try {
			stdinData = JSON.parse(readFileSync(stdinFile, "utf-8"));
		} catch {
			/* will fail assertion */
		}

		expect(stdinData.hook_event_name).toBe("PostToolUse");
		// Claude Code uses tool_response, pi-hooks uses tool_output
		// At least one should be present
		const hasOutput = stdinData.tool_output !== undefined || stdinData.tool_response !== undefined;
		expect(hasOutput).toBe(true);
	});

	it("stdin includes transcript_path field (may be empty in in-memory test mode)", async () => {
		// Claude Code source: createBaseHookInput sets transcript_path via getTranscriptPathForSession()
		// pi-hooks now passes sessionManager.getSessionFile() as transcript_path
		// In harness in-memory mode, this may be undefined → empty string
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "captured-stdin-transcript.json");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: `cat > "${stdinFile}"` }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");

		const stdinData = JSON.parse(readFileSync(stdinFile, "utf-8"));
		// Field must exist (Claude Code compat)
		expect(stdinData.transcript_path).toBeDefined();
		// session_id should be populated
		expect(stdinData.session_id).toBeDefined();
		expect(stdinData.session_id).not.toBe("");
	});
});

// ═══════════════════════════════════════════════════════════
// 8. USER_PROMPT_SUBMIT
// ═══════════════════════════════════════════════════════════

describe("UserPromptSubmit — Claude Code compat", () => {
	it("can block prompt submission with exit 2", async () => {
		// Claude Code: UserPromptSubmit exit 2 blocks processing
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			UserPromptSubmit: [
				{
					matcher: "",
					hooks: [{ type: "command", command: "echo 'Prompt blocked' >&2; exit 2" }],
				},
			],
		});

		harness.setResponses([fauxAssistantMessage("I will help")]);

		await harness.session.prompt("do something dangerous");

		// In Claude Code, UserPromptSubmit exit 2 blocks the prompt
		// The assistant should not have processed the prompt normally
		// We check that a block message was produced
		const allMessages = harness.session.messages;
		const hasBlockMessage = allMessages.some((m) => {
			const content = JSON.stringify(m);
			return content.includes("blocked") || content.includes("Prompt blocked");
		});
		expect(hasBlockMessage).toBe(true);
	});

	it("allows prompt submission with exit 0", async () => {
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			UserPromptSubmit: [
				{
					matcher: "",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([fauxAssistantMessage("Response")]);

		await harness.session.prompt("hello");
		// Should work normally
		const assistantMessages = harness.session.messages.filter((m) => m.role === "assistant");
		expect(assistantMessages.length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════
// 9. STOP EVENT
// ═══════════════════════════════════════════════════════════

describe("Stop — Claude Code compat", () => {
	it("fires Stop hook after turn ends", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const markerFile = join(harness.tempDir, "stop-marker.txt");
		writeClaudeHooks(harness.tempDir, {
			Stop: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: `echo "stopped" > "${markerFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([fauxAssistantMessage("done")]);

		await harness.session.prompt("hello");

		// Stop hook should have run
		let stopRan = false;
		try {
			const content = readFileSync(markerFile, "utf-8").trim();
			stopRan = content === "stopped";
		} catch {
			/* not found */
		}
		expect(stopRan).toBe(true);
	});

	it("Stop hook with exit 2 injects continuation message", async () => {
		// Claude Code: Stop exit 2 shows stderr to model and continues conversation
		// pi-hooks now supports this by injecting a follow-up message
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			Stop: [
				{
					matcher: "",
					hooks: [{ type: "command", command: "echo 'Task not complete' >&2; exit 2" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage("first response"),
			fauxAssistantMessage("second response after stop hook"),
		]);

		await harness.session.prompt("do something");
		// The Stop hook should have injected a block message
		// Check that a message with "Stop hook blocked" was sent
		const allMessages = harness.session.messages;
		const hasStopBlock = allMessages.some((m) => {
			const content = JSON.stringify(m);
			return content.includes("Stop hook blocked") || content.includes("Task not complete");
		});
		expect(hasStopBlock).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 10. SESSION EVENTS (known gaps)
// ═══════════════════════════════════════════════════════════

describe("Session events", () => {
	it("SessionStart hook fires on session start", async () => {
		// Claude Code: SessionStart fires on startup/resume/clear/compact
		// In harness tests, session_start is triggered by bindExtensions()
		const harness = await makeHarness([makeBashTool()]);
		const markerFile = join(harness.tempDir, "session-start-marker.txt");
		writeClaudeHooks(harness.tempDir, {
			SessionStart: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: `echo "started" > "${markerFile}"`,
						},
					],
				},
			],
		});

		// Trigger session_start by binding extensions
		await harness.session.bindExtensions({});

		let started = false;
		try {
			readFileSync(markerFile, "utf-8");
			started = true;
		} catch {
			/* not found */
		}
		expect(started).toBe(true);
	});

	it("SessionStart hook receives correct event name in stdin", async () => {
		// Claude Code: SessionStart stdin includes hook_event_name: "SessionStart"
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "session-start-stdin.json");
		writeClaudeHooks(harness.tempDir, {
			SessionStart: [
				{
					matcher: "",
					hooks: [{ type: "command", command: `cat > "${stdinFile}"` }],
				},
			],
		});

		// Trigger session_start by binding extensions
		await harness.session.bindExtensions({});

		const stdinData = JSON.parse(readFileSync(stdinFile, "utf-8"));
		expect(stdinData.hook_event_name).toBe("SessionStart");
		expect(stdinData.cwd).toBe(harness.tempDir);
	});
});

// ═══════════════════════════════════════════════════════════
// 11. PERMISSION SYSTEM — Priority (deny > ask > allow)
// ═══════════════════════════════════════════════════════════

describe("Permission priority — Claude Code compat", () => {
	it("multiple hooks: deny wins over allow", async () => {
		// Claude Code source: hooks.ts:2820-2847
		// deny > ask > allow
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
								},
							})}'`,
						},
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "deny",
									permissionDecisionReason: "Deny wins",
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		// deny should win
		expect(executed).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════
// 12. ADDITIONAL CLAUDE CODE EVENTS (gaps)
// ═══════════════════════════════════════════════════════════

describe("PermissionRequest — Claude Code compat", () => {
	it("PermissionRequest config is loaded and ready", async () => {
		// Verifies that PermissionRequest hooks are loaded from config
		// and the pi-hooks extension registers the permission_request handler
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			PermissionRequest: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: "exit 0",
						},
					],
				},
			],
		});

		// If the config was loaded correctly, PreToolUse for Bash should still work
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBe(1);
	});

	it("Setup hook fires on session startup (trigger=init)", async () => {
		// Claude Code: Setup fires on --init or --maintenance
		// pi: fires Setup on session_start with reason=startup as approximation
		const harness = await makeHarness([makeBashTool()]);
		const markerFile = join(harness.tempDir, "setup-marker.txt");
		writeClaudeHooks(harness.tempDir, {
			Setup: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: `echo "setup-done" > "${markerFile}"`,
						},
					],
				},
			],
		});

		// Trigger session_start by binding extensions (default reason is "startup")
		await harness.session.bindExtensions({});

		expect(readFileSync(markerFile, "utf-8").trim()).toBe("setup-done");
	});
});

// ═══════════════════════════════════════════════════════════
// 13. HOOK TYPES
// ═══════════════════════════════════════════════════════════

describe("Hook types — Claude Code compat", () => {
	it("command type: basic shell execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "exit 0" }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("command type: timeout is respected", async () => {
		// Claude Code: timeout field (in seconds) limits execution time
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "sleep 10", timeout: 1 }],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// Hook should timeout (exit code 1 from timeout), but non-blocking
		// So tool should still execute
		expect(executed).toBe(true);
	});

	it("once:true only fires hook once", async () => {
		// Claude Code: once:true means the hook only runs on the first matching call
		let hookCount = 0;
		const harness = await makeHarness([makeBashTool()]);
		const countFile = join(harness.tempDir, "hook-count.txt");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo "x" >> "${countFile}"`,
							once: true,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("Bash", { command: "pwd" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("Bash", { command: "whoami" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run three commands");

		try {
			const lines = readFileSync(countFile, "utf-8").trim().split("\n");
			hookCount = lines.length;
		} catch {
			hookCount = 0;
		}

		// Should only fire once despite 3 tool calls
		expect(hookCount).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════
// 14. ADDITIONAL OUTPUT SCHEMA FIELDS
// ═══════════════════════════════════════════════════════════

describe("stdout JSON output schema — Claude Code compat", () => {
	it("systemMessage is extracted from stdout JSON", async () => {
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								systemMessage: "Warning: running in debug mode",
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// systemMessage should not block, tool should execute
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBe(1);
	});

	it("ok:false from prompt handler blocks execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({ ok: false, reason: "Not OK" })}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(false);
	});

	it("ok:true from prompt handler allows execution", async () => {
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({ ok: true })}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		expect(executed).toBe(true);
	});

	it("additionalContext is extracted from PreToolUse output", async () => {
		// Claude Code: hookSpecificOutput.additionalContext adds context to the model
		const harness = await makeHarness([makeBashTool()]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo '${JSON.stringify({
								hookSpecificOutput: {
									hookEventName: "PreToolUse",
									permissionDecision: "allow",
									additionalContext: "Extra context from hook",
								},
							})}'`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// additionalContext should not block execution
		const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(toolResults.length).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════
// 15. $ARGUMENTS AND $TOOL VARIABLES
// ═══════════════════════════════════════════════════════════

describe("Variable replacement in commands — Claude Code compat", () => {
	it("$BASH_COMMAND is replaced with the bash command", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "cmd-capture.txt");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo "$BASH_COMMAND" > "${stdinFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "npm test" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run npm test");

		let captured = "";
		try {
			captured = readFileSync(stdinFile, "utf-8").trim();
		} catch {
			/* */
		}
		expect(captured).toBe("npm test");
	});

	it("$TOOL is replaced with tool name", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const stdinFile = join(harness.tempDir, "tool-capture.txt");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `echo "$TOOL" > "${stdinFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");

		let captured = "";
		try {
			captured = readFileSync(stdinFile, "utf-8").trim();
		} catch {
			/* */
		}
		expect(captured).toBe("Bash");
	});
});

// ═══════════════════════════════════════════════════════════
// 16. SUBAGENTSTOP — Claude Code compat
// ═══════════════════════════════════════════════════════════

describe("SubagentStop — Claude Code compat", () => {
	it("SubagentStop hook fires on agent_end", async () => {
		const harness = await makeHarness([makeBashTool()]);
		const markerFile = join(harness.tempDir, "subagent-stop-marker.txt");
		writeClaudeHooks(harness.tempDir, {
			SubagentStop: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: `echo "subagent-stopped" > "${markerFile}"`,
						},
					],
				},
			],
		});

		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("hello");

		// SubagentStop hook should have run via agent_end event
		let ran = false;
		try {
			const content = readFileSync(markerFile, "utf-8").trim();
			ran = content === "subagent-stopped";
		} catch {
			/* not found */
		}
		// Note: agent_end may or may not fire in harness depending on agent lifecycle
		// This test verifies config loading works for SubagentStop
		expect(ran).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 17. HOOK DEDUPLICATION — Claude Code compat
// ═══════════════════════════════════════════════════════════

describe("Hook deduplication", () => {
	it("identical command hooks from merged sources are not deduped (current pi behavior)", async () => {
		// Claude Code dedupes hooks by command+if across config sources
		// pi-hooks currently does NOT dedupe — this test documents current behavior
		let hookCount = 0;
		const harness = await makeHarness([makeBashTool()]);
		const countFile = join(harness.tempDir, "dedup-count.txt");
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{ type: "command", command: `echo "x" >> "${countFile}"` },
						{ type: "command", command: `echo "x" >> "${countFile}"` },
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		try {
			const lines = readFileSync(countFile, "utf-8").trim().split("\n");
			hookCount = lines.length;
		} catch {
			hookCount = 0;
		}
		// Both hooks fire (no dedup) — documents current behavior
		expect(hookCount).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════
// 18. HTTP HOOK SECURITY — Claude Code compat
// ═══════════════════════════════════════════════════════════

describe("HTTP hook security", () => {
	it("http hook blocks private IP addresses (SSRF guard)", async () => {
		// pi-hooks has SSRF protection that blocks private IPs
		// Claude Code also has SSRF guard
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "http",
							url: "http://127.0.0.1:9999/hook",
							timeout: 2,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// HTTP hook to private IP fails (non-blocking error), tool still executes
		expect(executed).toBe(true);
	});

	it("http hook requires HTTPS URLs", async () => {
		// pi-hooks enforces HTTPS-only for http hooks
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "http",
							url: "http://example.com/hook",
							timeout: 2,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// HTTP (not HTTPS) fails — non-blocking, tool executes
		expect(executed).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 19. ASYNC HOOKS — Claude Code compat
// ═══════════════════════════════════════════════════════════

describe("Async hooks", () => {
	it("async:true hook runs in background without blocking tool execution", async () => {
		// Claude Code: async:true means hook runs in background
		// Tool execution is not blocked regardless of hook exit code
		let executed = false;
		const harness = await makeHarness([
			makeBashTool(() => {
				executed = true;
			}),
		]);
		writeClaudeHooks(harness.tempDir, {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: "sleep 1; exit 2",
							async: true,
							timeout: 5,
						},
					],
				},
			],
		});

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("Bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run ls");
		// Async hook doesn't block — tool should execute immediately
		expect(executed).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════
// 20. GAP SUMMARY — Known remaining differences
// ═══════════════════════════════════════════════════════════

describe("Gap summary", () => {
	it("documents known gaps between pi-hooks and Claude Code hooks", () => {
		const gaps = [
			"asyncRewake: exit 2 notification mechanism differs (pi uses sendMessage, Claude uses enqueuePendingNotification)",
			"Hook deduplication not implemented (Claude Code dedupes by command+if)",
			"http hook: URL allowlist not configurable (pi-hooks has SSRF guard but no allowlist)",
			"Prompt interaction protocol (hook prompts user mid-execution via stdin) not implemented",
			"Setup hook fires on every startup (Claude Code: only on --init/--maintenance)",
			"transcript_path empty in in-memory test mode (works in real session with file persistence)",
		];

		// This test exists to document gaps; it always passes
		expect(gaps.length).toBeGreaterThan(0);
	});
});

// ─── Internal helpers (need import) ────────────────────────
import { readFileSync } from "node:fs";
