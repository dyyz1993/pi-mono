import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	parseHooks,
	matchesCondition,
	executeCommand,
	parseStdout,
} from "../../extensions/hooks-engine/index.js";

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

		it("should be case-sensitive", () => {
			const condition = "bash";
			expect(matchesCondition(condition, { toolName: "Bash" })).toBe(false);
			expect(matchesCondition(condition, { toolName: "bash" })).toBe(true);
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
				},
				sessionId: "session_456",
				cwd: "/workspace",
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

		it("should handle timeout by killing process and returning exit code 0", async () => {
			// Command that sleeps longer than timeout
			const command = "sleep 10; echo 'should not see this'";
			const result = await executeCommand(command, {}, 100); // 100ms timeout
			expect(result.exitCode).toBe(0);
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
	});

	describe("parseHooks", () => {
		it("should parse valid JSON hooks", () => {
			const raw = JSON.stringify({
				on_tool_start: [
					{ type: "command", command: "test", if: "Bash" },
				],
			});
			const result = parseHooks(raw);
			expect(result).toEqual({
				on_tool_start: [
					{ type: "command", command: "test", if: "Bash" },
				],
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
				// Timeout should return exitCode 0 (allow) and empty stdout
				expect(exitCode).toBe(0);
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