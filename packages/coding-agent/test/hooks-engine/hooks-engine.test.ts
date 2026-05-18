import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCommand, matchesCondition, parseHooks, parseStdout } from "../../extensions/hooks-engine/index.js";

describe("hooks-engine", () => {
	describe("parseStdout", () => {
		it("should parse valid JSON with deny action", () => {
			const output = '{"action":"deny","reason":"blocked by policy"}';
			const result = parseStdout(output);
			expect(result).toEqual({
				action: "deny",
				reason: "blocked by policy",
			});
		});

		it("should parse valid JSON with ask action", () => {
			const output = '{"action":"ask","question":"confirm?","options":["yes","no"]}';
			const result = parseStdout(output);
			expect(result).toEqual({
				action: "ask",
				question: "confirm?",
				options: ["yes", "no"],
			});
		});

		it("should parse valid JSON with allow action and message", () => {
			const output = '{"action":"allow","message":"proceed with caution"}';
			const result = parseStdout(output);
			expect(result).toEqual({
				action: "allow",
				message: "proceed with caution",
			});
		});

		it("should return null for empty stdout", () => {
			const result = parseStdout("");
			expect(result).toBeNull();
		});

		it("should return null for whitespace-only stdout", () => {
			const result = parseStdout("   \n\t  ");
			expect(result).toBeNull();
		});

		it("should return null for invalid JSON", () => {
			const result = parseStdout("plain text output");
			expect(result).toBeNull();
		});

		it("should return null for malformed JSON", () => {
			const result = parseStdout('{"action": invalid}');
			expect(result).toBeNull();
		});

		it("should handle JSON with extra whitespace", () => {
			const output = '  { "action" : "deny" , "reason" : "test" }  \n';
			const result = parseStdout(output);
			expect(result).toEqual({
				action: "deny",
				reason: "test",
			});
		});
	});

	describe("matchesCondition", () => {
		it("should match single tool name exactly", () => {
			const condition = "Bash";
			const event = { toolName: "Bash" };
			expect(matchesCondition(condition, event)).toBe(true);
		});

		it("should not match different tool name", () => {
			const condition = "Bash";
			const event = { toolName: "Edit" };
			expect(matchesCondition(condition, event)).toBe(false);
		});

		it("should match one of multiple tools (OR logic)", () => {
			const condition = "Edit|Write";
			expect(matchesCondition(condition, { toolName: "Edit" })).toBe(true);
			expect(matchesCondition(condition, { toolName: "Write" })).toBe(true);
		});

		it("should not match none of multiple tools", () => {
			const condition = "Edit|Write";
			expect(matchesCondition(condition, { toolName: "Bash" })).toBe(false);
		});

		it("should handle multiple tools with whitespace", () => {
			const condition = "Edit | Write | Bash";
			expect(matchesCondition(condition, { toolName: "Write" })).toBe(true);
			expect(matchesCondition(condition, { toolName: "Bash" })).toBe(true);
		});

		it("should match everything when no condition is specified", () => {
			expect(matchesCondition(undefined, { toolName: "Any" })).toBe(true);
			expect(matchesCondition(undefined, { toolName: "" })).toBe(true);
		});

		it("should handle empty tool name", () => {
			const condition = "Bash";
			expect(matchesCondition(condition, {})).toBe(false);
		});

		it("should handle empty condition string", () => {
			expect(matchesCondition("", { toolName: "Bash" })).toBe(true);
		});

		it("should be case-insensitive", () => {
			const condition = "bash";
			expect(matchesCondition(condition, { toolName: "Bash" })).toBe(true);
			expect(matchesCondition(condition, { toolName: "bash" })).toBe(true);
			expect(matchesCondition(condition, { toolName: "BASH" })).toBe(true);
		});

		// --- Regex matching support ---

		it("should match tool name via regex pattern", () => {
			expect(matchesCondition("^bash$", { toolName: "Bash" })).toBe(true);
			expect(matchesCondition("^bash$", { toolName: "bashscript" })).toBe(false);
		});

		it("should match tool name via regex with flags-like characters", () => {
			expect(matchesCondition("bash|edit", { toolName: "bash" })).toBe(true);
			expect(matchesCondition("bash|edit", { toolName: "edit" })).toBe(true);
			expect(matchesCondition("bash|edit", { toolName: "read" })).toBe(false);
		});

		it("should support regex wildcards", () => {
			expect(matchesCondition(".*", { toolName: "bash" })).toBe(true);
			expect(matchesCondition("b.*", { toolName: "Bash" })).toBe(true);
			expect(matchesCondition("b.*", { toolName: "read" })).toBe(false);
		});

		it("should fallback to literal match for simple alphanumeric patterns", () => {
			// Simple alphanumeric|pattern should still use pipe-split logic
			expect(matchesCondition("Edit|Write", { toolName: "Edit" })).toBe(true);
			expect(matchesCondition("Edit|Write", { toolName: "Bash" })).toBe(false);
		});

		it("should return false for invalid regex", () => {
			expect(matchesCondition("[invalid", { toolName: "Bash" })).toBe(false);
		});
	});

	describe("executeCommand", () => {
		let originalEnv: NodeJS.ProcessEnv;

		beforeEach(() => {
			originalEnv = { ...process.env };
		});

		afterEach(() => {
			process.env = originalEnv;
		});

		it("should pass all PI_HOOK_* environment variables", async () => {
			const event = {
				toolName: "Bash",
				toolCallId: "call_123",
				input: { command: "ls -la" },
				variables: {
					agentName: "test-agent",
					permissionMode: "auto",
					allowedTools: "Bash,Read",
					disallowedTools: "Write",
					agentHooks: JSON.stringify({}),
					sessionId: "session_456",
					cwd: "/workspace",
				},
			};

			// Script that outputs all env vars
			const command = `echo "TOOL=$PI_HOOK_TOOL"; echo "CALL_ID=$PI_HOOK_TOOL_CALL_ID"; echo "INPUT=$PI_HOOK_INPUT"; echo "AGENT=$PI_HOOK_AGENT_NAME"; echo "MODE=$PI_HOOK_PERMISSION_MODE"; echo "ALLOWED=$PI_HOOK_ALLOWED_TOOLS"; echo "DISALLOWED=$PI_HOOK_DISALLOWED_TOOLS"; echo "SESSION=$PI_HOOK_SESSION_ID"; echo "CWD=$PI_HOOK_CWD"`;

			const result = await executeCommand(command, event);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("TOOL=Bash");
			expect(result.stdout).toContain("CALL_ID=call_123");
			expect(result.stdout).toContain('INPUT={"command":"ls -la"}');
			expect(result.stdout).toContain("AGENT=test-agent");
			expect(result.stdout).toContain("MODE=auto");
			expect(result.stdout).toContain("ALLOWED=Bash,Read");
			expect(result.stdout).toContain("DISALLOWED=Write");
			expect(result.stdout).toContain("SESSION=session_456");
			expect(result.stdout).toContain("CWD=/workspace");
		});

		it("should handle exit code 0 (allow)", async () => {
			const command = "exit 0";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(0);
		});

		it("should handle exit code 2 (deny)", async () => {
			const command = "echo 'blocked'; exit 2";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toContain("blocked");
		});

		it("should handle exit code 3 (ask)", async () => {
			const command = "echo 'confirm?'; exit 3";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(3);
			expect(result.stdout).toContain("confirm?");
		});

		it("should handle timeout by killing process and returning exit code 2 (deny)", async () => {
			// Command that sleeps longer than timeout
			const command = "sleep 10; echo 'should not see this'";
			const result = await executeCommand(command, {}, 100); // 100ms timeout
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
		});

		it("should capture stdout correctly", async () => {
			const command = "echo 'line1'; echo 'line2'";
			const result = await executeCommand(command, {});
			expect(result.stdout).toContain("line1");
			expect(result.stdout).toContain("line2");
		});

		it("should handle script that outputs JSON", async () => {
			const command = `echo '{"action":"deny","reason":"policy violation"}'; exit 2`;
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toContain('{"action":"deny","reason":"policy violation"}');
		});

		it("should handle script with ask confirmation", async () => {
			const command = `echo '{"action":"ask","question":"Delete file?"}'; exit 3`;
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(3);
			expect(result.stdout).toContain('{"action":"ask","question":"Delete file?"}');
		});

		it("should handle script that allows with message", async () => {
			const command = `echo '{"action":"allow","message":"proceed"}'; exit 0`;
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('{"action":"allow","message":"proceed"}');
		});

		it("should handle script errors gracefully", async () => {
			const command = "exit 1";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(1);
		});

		it("should handle missing event properties", async () => {
			const command = "echo 'test'";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("test");
		});

		it("should preserve process environment variables", async () => {
			process.env.TEST_VAR = "test_value";
			const command = "echo $TEST_VAR";
			const result = await executeCommand(command, {});
			expect(result.stdout).toContain("test_value");
		});

		// --- stdin JSON input support ---

		it("should pass JSON input to subprocess stdin", async () => {
			const event = {
				toolName: "Bash",
				toolCallId: "call_1",
				input: { command: "ls" },
				variables: { agentName: "test-agent", sessionId: "s1", cwd: "/workspace" },
			};
			// Command reads stdin and echoes it
			const command = "cat";
			const result = await executeCommand(command, event);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout);
			expect(parsed.toolName).toBe("Bash");
			expect(parsed.toolCallId).toBe("call_1");
			expect(parsed.input).toEqual({ command: "ls" });
			expect(parsed.sessionId).toBe("s1");
			expect(parsed.cwd).toBe("/workspace");
		});

		it("should pass JSON input alongside env vars", async () => {
			const event = {
				toolName: "Edit",
				input: { path: "/foo.ts" },
			};
			// Verify both: env var is set AND stdin has data (write stdin to a temp file to measure)
			const command = "echo \"ENV_TOOL=$PI_HOOK_TOOL\"; cat | wc -c | tr -d ' '";
			const result = await executeCommand(command, event);
			expect(result.stdout).toContain("ENV_TOOL=Edit");
			// The second line should be a number > 0 (stdin byte count)
			const lines = result.stdout.trim().split("\n");
			const stdinBytes = Number(lines[lines.length - 1].trim());
			expect(stdinBytes).toBeGreaterThan(0);
		});
	});

	describe("parseHooks", () => {
		it("should parse valid JSON hooks", () => {
			const raw = JSON.stringify({
				on_tool_start: [{ type: "command", command: "test", if: "Bash" }],
			});
			const result = parseHooks(raw);
			expect(result).toEqual({
				on_tool_start: [{ type: "command", command: "test", if: "Bash" }],
			});
		});

		it("should return null for undefined input", () => {
			const result = parseHooks(undefined);
			expect(result).toBeNull();
		});

		it("should return null for empty string", () => {
			const result = parseHooks("");
			expect(result).toBeNull();
		});

		it("should return null for invalid JSON", () => {
			const result = parseHooks("{invalid json}");
			expect(result).toBeNull();
		});

		it("should parse hooks with wildcard", () => {
			const raw = JSON.stringify({
				"*": [{ type: "prompt", prompt: "Be careful!" }],
			});
			const result = parseHooks(raw);
			expect(result).toEqual({
				"*": [{ type: "prompt", prompt: "Be careful!" }],
			});
		});
	});

	describe("Integration: Event Handler Flow", () => {
		it("should handle deny flow with JSON reason", async () => {
			const event = {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"deny","reason":"not allowed"}'; exit 2`,
								if: "Bash",
							},
						],
					}),
				},
			};

			const command = event.variables.agentHooks;
			const hooks = parseHooks(command);
			const hook = hooks?.on_tool_start?.[0];

			expect(hook).toBeDefined();
			if (hook && hook.type === "command") {
				const matches = matchesCondition(hook.if, event);
				expect(matches).toBe(true);

				const { exitCode, stdout } = await executeCommand(hook.command, event);
				expect(exitCode).toBe(2);

				const parsed = parseStdout(stdout);
				expect(parsed).toEqual({
					action: "deny",
					reason: "not allowed",
				});
			}
		});

		it("should handle ask flow with JSON question", async () => {
			const event = {
				toolName: "Write",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"ask","question":"Confirm write?"}'; exit 3`,
								if: "Write",
							},
						],
					}),
				},
			};

			const command = event.variables.agentHooks;
			const hooks = parseHooks(command);
			const hook = hooks?.on_tool_start?.[0];

			expect(hook).toBeDefined();
			if (hook && hook.type === "command") {
				const matches = matchesCondition(hook.if, event);
				expect(matches).toBe(true);

				const { exitCode, stdout } = await executeCommand(hook.command, event);
				expect(exitCode).toBe(3);

				const parsed = parseStdout(stdout);
				expect(parsed).toEqual({
					action: "ask",
					question: "Confirm write?",
				});
			}
		});

		it("should skip hook that does not match condition", async () => {
			const event = {
				toolName: "Read",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo 'should not execute'; exit 2`,
								if: "Bash|Write",
							},
						],
					}),
				},
			};

			const command = event.variables.agentHooks;
			const hooks = parseHooks(command);
			const hook = hooks?.on_tool_start?.[0];

			expect(hook).toBeDefined();
			if (hook && hook.type === "command") {
				const matches = matchesCondition(hook.if, event);
				expect(matches).toBe(false);
			}
		});

		it("should handle allow with message", async () => {
			const event = {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"allow","message":"proceeding"}'; exit 0`,
							},
						],
					}),
				},
			};

			const command = event.variables.agentHooks;
			const hooks = parseHooks(command);
			const hook = hooks?.on_tool_start?.[0];

			expect(hook).toBeDefined();
			if (hook && hook.type === "command") {
				const { exitCode, stdout } = await executeCommand(hook.command, event);
				expect(exitCode).toBe(0);

				const parsed = parseStdout(stdout);
				expect(parsed).toEqual({
					action: "allow",
					message: "proceeding",
				});
			}
		});

		it("should handle timeout scenario", async () => {
			const event = {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: "sleep 10; echo 'done'",
							},
						],
					}),
				},
			};

			const command = event.variables.agentHooks;
			const hooks = parseHooks(command);
			const hook = hooks?.on_tool_start?.[0];

			expect(hook).toBeDefined();
			if (hook && hook.type === "command") {
				const { exitCode, stdout } = await executeCommand(hook.command, event, 100);
				// Timeout should return exitCode 2 (deny) and empty stdout
				expect(exitCode).toBe(2);
				expect(stdout).toBe("");
			}
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty command gracefully", async () => {
			const result = await executeCommand("", {});
			expect(result.exitCode).toBe(0);
		});

		it("should handle command that writes to stderr", async () => {
			const command = "echo 'error message' >&2; exit 0";
			const result = await executeCommand(command, {});
			expect(result.exitCode).toBe(0);
			// stderr is captured but not returned
		});

		it("should handle command with special characters in input", async () => {
			const event = {
				input: { command: 'echo "test"; rm -rf /' },
			};
			const command = "echo $PI_HOOK_INPUT";
			const result = await executeCommand(command, event);
			// JSON string is escaped in environment variable
			expect(result.stdout).toContain('{"command":"echo \\"test\\"; rm -rf /"}');
		});

		it("should handle condition with pipe and whitespace", async () => {
			const condition = " Bash | Edit | Write ";
			const event1 = { toolName: "Bash" };
			const event2 = { toolName: "Edit" };
			const event3 = { toolName: "Write" };
			const event4 = { toolName: "Read" };

			expect(matchesCondition(condition, event1)).toBe(true);
			expect(matchesCondition(condition, event2)).toBe(true);
			expect(matchesCondition(condition, event3)).toBe(true);
			expect(matchesCondition(condition, event4)).toBe(false);
		});

		it("should handle JSON with extra fields", () => {
			const output = '{"action":"deny","reason":"test","extra":"ignored"}';
			const result = parseStdout(output);
			expect(result).toEqual({
				action: "deny",
				reason: "test",
				extra: "ignored",
			});
		});
	});
});

// ---------------------------------------------------------------------------
// Integration tests for the default-exported hooksEngine(pi) function
// ---------------------------------------------------------------------------
import hooksEngine from "../../extensions/hooks-engine/index.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: Record<string, unknown>, ctx: any) => Promise<any>>> = {};
	const sentMessages: Array<{ content: string; options?: { deliverAs?: string } }> = [];

	return {
		handlers,
		sentMessages: [] as Array<{ content: string; options?: { deliverAs?: string } }>,
		on: vi.fn((event: string, handler: (event: Record<string, unknown>, ctx: any) => Promise<any>) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		sendUserMessage: vi.fn((content: string, options?: { deliverAs?: string }) => {
			sentMessages.push({ content, options });
		}),
	};
}

type MockPi = ReturnType<typeof createMockPi>;

async function emitEvent(pi: MockPi, eventName: string, event: Record<string, unknown>, ctx?: any): Promise<any> {
	const list = pi.handlers[eventName];
	if (!list || list.length === 0) return undefined;
	// hooksEngine registers exactly one handler per event
	return list[0](event, ctx ?? {});
}

describe("hooksEngine (default function)", () => {
	let pi: MockPi;

	beforeEach(() => {
		pi = createMockPi();
		hooksEngine(pi as any);
	});

	it("should subscribe to all 6 EVENT_MAP events", () => {
		expect(pi.on).toHaveBeenCalledTimes(6);
		for (const name of [
			"tool_call",
			"tool_result",
			"agent_start",
			"agent_end",
			"session_start",
			"session_shutdown",
		]) {
			expect(pi.on).toHaveBeenCalledWith(name, expect.any(Function));
		}
	});

	it("should return undefined when event has no variables", async () => {
		const result = await emitEvent(pi, "tool_call", { toolName: "Bash" });
		expect(result).toBeUndefined();
	});

	it("should return undefined when variables has no agentHooks", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentName: "test" },
		});
		expect(result).toBeUndefined();
	});

	it("should return undefined when agentHooks is empty JSON", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: "{}" },
		});
		expect(result).toBeUndefined();
	});

	it("should return undefined when agentHooks is invalid JSON", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: "not-json" },
		});
		expect(result).toBeUndefined();
	});

	it("should return undefined when hooks exist for different event key", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_complete: [{ type: "command", command: "echo hello" }],
				}),
			},
		});
		expect(result).toBeUndefined();
	});

	// --- Command hooks: allow (exit 0) ---

	it("should allow when command exits 0 with no stdout", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "exit 0" }],
				}),
			},
		});
		expect(result).toBeUndefined();
	});

	it("should allow when command exits 0 with plain text stdout (log message)", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "echo 'plain message'" }],
				}),
			},
		});
		expect(result).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith("[hook] Message:", "plain message");
		consoleSpy.mockRestore();
	});

	it("should allow when command exits 0 with JSON allow+message", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "command",
							command: `echo '{"action":"allow","message":"ctx injection"}'; exit 0`,
						},
					],
				}),
			},
		});
		expect(result).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith("[hook] Context injection:", "ctx injection");
		consoleSpy.mockRestore();
	});

	// --- Command hooks: deny (exit 2) ---

	it("should block when command exits 2 with JSON reason", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "command",
							command: `echo '{"action":"deny","reason":"policy violation"}'; exit 2`,
						},
					],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: "policy violation",
		});
	});

	it("should block when command exits 2 with plain text stdout", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "echo 'denied!'; exit 2" }],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: "denied!",
		});
	});

	it("should block when command exits 2 with no stdout (fallback reason)", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "exit 2" }],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("[hook] Operation blocked by hook:"),
		});
	});

	// --- Command hooks: ask (exit 3) ---

	it("should block when command exits 3 and user denies (ui.confirm available)", async () => {
		const ctx = { ui: { confirm: vi.fn().mockResolvedValue(false) } };
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"ask","question":"Allow?"}'; exit 3`,
							},
						],
					}),
				},
			},
			ctx,
		);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Hook Confirmation", "Allow?");
		expect(result).toEqual({
			block: true,
			reason: "[hook] User denied: Allow?",
		});
	});

	it("should allow when command exits 3 and user confirms", async () => {
		const ctx = { ui: { confirm: vi.fn().mockResolvedValue(true) } };
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"ask","question":"Allow?"}'; exit 3`,
							},
						],
					}),
				},
			},
			ctx,
		);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Hook Confirmation", "Allow?");
		expect(result).toBeUndefined();
	});

	it("should block when command exits 3 with plain text and user denies", async () => {
		const ctx = { ui: { confirm: vi.fn().mockResolvedValue(false) } };
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'Please confirm'; exit 3" }],
					}),
				},
			},
			ctx,
		);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Hook Confirmation", "Please confirm");
		expect(result).toEqual({
			block: true,
			reason: "[hook] User denied: Please confirm",
		});
	});

	it("should block when command exits 3 with no stdout and user denies", async () => {
		const ctx = { ui: { confirm: vi.fn().mockResolvedValue(false) } };
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 3" }],
					}),
				},
			},
			ctx,
		);
		expect(ctx.ui.confirm).toHaveBeenCalledWith("Hook Confirmation", "Confirm this operation?");
		expect(result).toEqual({
			block: true,
			reason: "[hook] User denied: Confirm this operation?",
		});
	});

	it("should block when command exits 3 and ui.confirm is not available", async () => {
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 3" }],
					}),
				},
			},
			{},
		); // no ui.confirm
		expect(result).toEqual({
			block: true,
			reason: "[hook] Confirmation required (no UI available): Confirm this operation?",
		});
	});

	it("should include custom question in reason when exit 3 without UI", async () => {
		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Write",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"question":"Modifying package.json may break the build. Use npm pkg set instead."}'; exit 3`,
								if: "write",
							},
						],
					}),
				},
			},
			{},
		); // no ui.confirm
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("package.json may break the build");
		expect(result?.reason).toContain("npm pkg set");
	});

	// --- Prompt hooks ---

	it("should inject prompt hooks as followUp messages", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await emitEvent(pi, "tool_result", {
			toolName: "Edit",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_complete: [
						{ type: "prompt", prompt: "Remember to check for edge cases" },
						{ type: "prompt", prompt: "Run tests after edits" },
					],
				}),
			},
		});
		expect(result).toBeUndefined();
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(pi.sendUserMessage).toHaveBeenCalledWith("Remember to check for edge cases", { deliverAs: "followUp" });
		expect(pi.sendUserMessage).toHaveBeenCalledWith("Run tests after edits", { deliverAs: "followUp" });
		consoleSpy.mockRestore();
	});

	it("should not inject prompt when condition does not match", async () => {
		await emitEvent(pi, "tool_result", {
			toolName: "Read",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_complete: [{ type: "prompt", prompt: "be careful", if: "Write|Edit" }],
				}),
			},
		});
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	// --- Wildcard (*) hooks ---

	it("should fall back to * when no specific event key matches", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					"*": [{ type: "command", command: "echo 'wildcard hit'; exit 2" }],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: "wildcard hit",
		});
	});

	it("should prefer specific key over wildcard", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "echo 'specific'; exit 2" }],
					"*": [{ type: "command", command: "echo 'wildcard'; exit 2" }],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: "specific",
		});
	});

	// --- Condition filtering ---

	it("should skip command hook when condition does not match", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Read",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "command",
							command: "echo 'should not run'; exit 2",
							if: "Bash|Write",
						},
					],
				}),
			},
		});
		expect(result).toBeUndefined();
	});

	// --- Multiple hooks sequential execution ---

	it("should execute multiple hooks sequentially, first deny wins", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{ type: "command", command: "exit 0" },
						{ type: "command", command: "echo 'blocked'; exit 2" },
					],
				}),
			},
		});
		expect(result).toEqual({
			block: true,
			reason: "blocked",
		});
	});

	it("should mix command and prompt hooks, only prompt is injected if all commands allow", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await emitEvent(pi, "tool_result", {
			toolName: "Edit",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_complete: [
						{ type: "command", command: "exit 0" },
						{ type: "prompt", prompt: "check edge cases" },
					],
				}),
			},
		});
		expect(result).toBeUndefined();
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(pi.sendUserMessage).toHaveBeenCalledWith("check edge cases", { deliverAs: "followUp" });
		consoleSpy.mockRestore();
	});

	// --- All events share the same subscription logic ---

	it("should handle tool_result event with deny", async () => {
		const result = await emitEvent(pi, "tool_result", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_complete: [{ type: "command", command: "echo 'post-check failed'; exit 2" }],
				}),
			},
		});
		expect(result).toEqual({ block: true, reason: "post-check failed" });
	});

	it("should handle session_start event with wildcard", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await emitEvent(pi, "session_start", {
			variables: {
				agentHooks: JSON.stringify({
					"*": [{ type: "command", command: "echo 'session started'" }],
				}),
			},
		});
		expect(consoleSpy).toHaveBeenCalledWith("[hook] Message:", "session started");
		consoleSpy.mockRestore();
	});

	it("should handle session_shutdown event", async () => {
		const result = await emitEvent(pi, "session_shutdown", {
			variables: {
				agentHooks: JSON.stringify({
					on_session_end: [{ type: "command", command: "exit 2" }],
				}),
			},
		});
		expect(result).toEqual({ block: true, reason: expect.stringContaining("[hook] Operation blocked by hook:") });
	});

	// --- once dedup support ---

	it("should execute once:true hook only once across multiple events", async () => {
		const hooks = {
			on_tool_start: [
				{
					type: "command" as const,
					command: "echo 'first call'; exit 0",
					if: "Bash",
					once: true,
				},
			],
		};

		// First invocation - should execute
		const result1 = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: JSON.stringify(hooks) },
		});
		expect(result1).toBeUndefined();

		// Second invocation with same hooks config - should be skipped
		const result2 = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: JSON.stringify(hooks) },
		});
		expect(result2).toBeUndefined();
		// The console.log should have fired only once for "first call"
	});

	it("should execute once:true deny hook only once, then pass through", async () => {
		const hooks = {
			on_tool_start: [
				{
					type: "command" as const,
					command: "echo 'blocked'; exit 2",
					if: "Bash",
					once: true,
				},
			],
		};

		// First invocation - should block
		const result1 = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: JSON.stringify(hooks) },
		});
		expect(result1).toEqual({ block: true, reason: "blocked" });

		// Second invocation - once hook already fired, should pass through
		const result2 = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: { agentHooks: JSON.stringify(hooks) },
		});
		expect(result2).toBeUndefined();
	});

	// --- HTTP hooks support ---

	describe("executeHttp", () => {
		it("should POST JSON to URL and return result", async () => {
			// Use httpbin.org or a simple local server
			// For unit test, we mock fetch
		});
	});

	it("should handle http hook type (deny via 403)", async () => {
		// Mock fetch globally
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: () => Promise.resolve("blocked by policy"),
		} as Response);

		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "http",
							url: "http://localhost:9999/hook",
						},
					],
				}),
			},
		});

		expect(result).toEqual({
			block: true,
			reason: "blocked by policy",
		});

		globalThis.fetch = originalFetch;
	});

	it("should handle http hook type (allow via 200)", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(""),
		} as Response);

		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "http",
							url: "http://localhost:9999/hook",
						},
					],
				}),
			},
		});

		expect(result).toBeUndefined();

		globalThis.fetch = originalFetch;
	});

	it("should handle http hook type (allow with message)", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve('{"action":"allow","message":"proceed with caution"}'),
		} as Response);

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "http",
							url: "http://localhost:9999/hook",
						},
					],
				}),
			},
		});

		expect(result).toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith("[hook] Context injection:", "proceed with caution");

		consoleSpy.mockRestore();
		globalThis.fetch = originalFetch;
	});

	it("should handle http hook network error gracefully", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "http",
							url: "http://localhost:9999/hook",
						},
					],
				}),
			},
		});

		// Network error should not block the operation
		expect(result).toBeUndefined();

		globalThis.fetch = originalFetch;
	});

	it("should pass custom headers to http hook", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: () => Promise.resolve(""),
		} as Response);

		await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [
						{
							type: "http",
							url: "http://localhost:9999/hook",
							headers: { "X-Custom": "test-value" },
						},
					],
				}),
			},
		});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:9999/hook",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"X-Custom": "test-value",
				}),
			}),
		);

		globalThis.fetch = originalFetch;
	});

	// --- HookGroup + matcher support ---

	describe("HookGroup with matcher", () => {
		it("should support HookGroup format with matcher that matches tool name", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								matcher: "Bash",
								hooks: [{ type: "command", command: "echo 'group matched'; exit 2" }],
							},
						],
					}),
				},
			});
			expect(result).toEqual({ block: true, reason: "group matched" });
		});

		it("should skip HookGroup when matcher does not match tool name", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "Read",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								matcher: "Bash|Edit",
								hooks: [{ type: "command", command: "echo 'should not run'; exit 2" }],
							},
						],
					}),
				},
			});
			expect(result).toBeUndefined();
		});

		it("should match HookGroup matcher via regex", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "bashscript",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								matcher: "^bash",
								hooks: [{ type: "command", command: "echo 'regex match'; exit 2" }],
							},
						],
					}),
				},
			});
			expect(result).toEqual({ block: true, reason: "regex match" });
		});

		it("should execute HookGroup without matcher (matches all)", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "AnyTool",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								hooks: [{ type: "command", command: "echo 'no matcher'; exit 2" }],
							},
						],
					}),
				},
			});
			expect(result).toEqual({ block: true, reason: "no matcher" });
		});

		it("should support multiple HookGroups, first matching group wins on deny", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								matcher: "Edit",
								hooks: [{ type: "command", command: "echo 'edit group'; exit 2" }],
							},
							{
								matcher: "Bash",
								hooks: [{ type: "command", command: "echo 'bash group'; exit 2" }],
							},
						],
					}),
				},
			});
			// Edit group skipped, Bash group matches and denies
			expect(result).toEqual({ block: true, reason: "bash group" });
		});

		it("should mix flat hooks and HookGroups (flat first, then groups)", async () => {
			const result = await emitEvent(pi, "tool_call", {
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [
							// Flat hook
							{ type: "command", command: "exit 0" },
							// HookGroup
							{
								matcher: "Bash",
								hooks: [{ type: "command", command: "echo 'group hook'; exit 2" }],
							},
						],
					}),
				},
			});
			// Flat hook allows, then group hook denies
			expect(result).toEqual({ block: true, reason: "group hook" });
		});

		it("should support prompt hooks inside HookGroup", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			await emitEvent(pi, "tool_result", {
				toolName: "Edit",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_complete: [
							{
								matcher: "Edit|Write",
								hooks: [{ type: "prompt", prompt: "check for edge cases" }],
							},
						],
					}),
				},
			});
			expect(pi.sendUserMessage).toHaveBeenCalledWith("check for edge cases", { deliverAs: "followUp" });
			consoleSpy.mockRestore();
		});
	});
});
