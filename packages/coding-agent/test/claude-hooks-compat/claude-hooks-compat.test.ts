import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	interpretHookOutput,
	replaceEnvVarsInHeaders,
	replaceInputPlaceholders,
	replaceVariables,
	runHandler,
} from "../../extensions/claude-hooks-compat/handler-runner.js";
import { matchesIfClause, parseIfClause } from "../../extensions/claude-hooks-compat/if-parser.js";
import { matchesMatcher } from "../../extensions/claude-hooks-compat/matcher.js";
import { buildStdinData } from "../../extensions/claude-hooks-compat/stdin-builder.js";
import type { HookOutput, HookStdinData } from "../../extensions/claude-hooks-compat/types.js";

describe("matchesMatcher", () => {
	it("matches all when matcher is undefined", () => {
		expect(matchesMatcher(undefined, "Bash")).toBe(true);
	});

	it("matches all when matcher is empty", () => {
		expect(matchesMatcher("", "Bash")).toBe(true);
	});

	it("matches all when matcher is *", () => {
		expect(matchesMatcher("*", "Bash")).toBe(true);
	});

	it("matches exact tool name", () => {
		expect(matchesMatcher("Bash", "Bash")).toBe(true);
		expect(matchesMatcher("Bash", "Edit")).toBe(false);
	});

	it("matches pipe-separated names", () => {
		expect(matchesMatcher("Bash|Edit|Write", "Edit")).toBe(true);
		expect(matchesMatcher("Bash|Edit|Write", "Read")).toBe(false);
	});

	it("matches regex pattern", () => {
		expect(matchesMatcher("mcp__memory__.*", "mcp__memory__store")).toBe(true);
		expect(matchesMatcher("mcp__memory__.*", "Bash")).toBe(false);
	});

	it("handles invalid regex gracefully", () => {
		expect(matchesMatcher("[invalid", "Bash")).toBe(false);
	});
});

describe("parseIfClause", () => {
	it("parses Bash(rm *)", () => {
		const result = parseIfClause("Bash(rm *)");
		expect(result).toEqual({ tool: "Bash", pattern: "rm *" });
	});

	it("parses Edit(src/**/*.ts)", () => {
		const result = parseIfClause("Edit(src/**/*.ts)");
		expect(result).toEqual({ tool: "Edit", pattern: "src/**/*.ts" });
	});

	it("returns null for malformed clause", () => {
		expect(parseIfClause("no parens")).toBeNull();
		expect(parseIfClause("")).toBeNull();
	});
});

describe("matchesIfClause", () => {
	it("returns true when no if clause", () => {
		expect(matchesIfClause(undefined, "Bash", { command: "rm -rf /" })).toBe(true);
	});

	it("matches Bash command pattern", () => {
		expect(matchesIfClause("Bash(rm *)", "Bash", { command: "rm -rf /tmp" })).toBe(true);
		expect(matchesIfClause("Bash(rm *)", "Bash", { command: "ls" })).toBe(false);
	});

	it("matches Edit file path pattern", () => {
		expect(matchesIfClause("Edit(src/**)", "Edit", { file_path: "src/foo.ts" })).toBe(true);
		expect(matchesIfClause("Edit(src/**)", "Edit", { file_path: "lib/bar.ts" })).toBe(false);
	});

	it("skips when tool name does not match", () => {
		expect(matchesIfClause("Bash(rm *)", "Edit", { command: "rm -rf /" })).toBe(false);
	});

	it("matches case-sensitively", () => {
		expect(matchesIfClause("Bash(rm *)", "bash", { command: "rm -rf /tmp" })).toBe(false);
		expect(matchesIfClause("Bash(rm *)", "Bash", { command: "rm -rf /tmp" })).toBe(true);
	});
});

describe("buildStdinData", () => {
	it("builds correct structure", () => {
		const data = buildStdinData("PreToolUse", {
			toolName: "Bash",
			toolInput: { command: "ls" },
			cwd: "/home/user",
			sessionId: "sess-1",
		});
		expect(data.hook_event_name).toBe("PreToolUse");
		expect(data.tool_name).toBe("Bash");
		expect(data.tool_input).toEqual({ command: "ls" });
		expect(data.cwd).toBe("/home/user");
		expect(data.session_id).toBe("sess-1");
	});

	it("includes tool_output when provided", () => {
		const data = buildStdinData("PostToolUse", {
			toolName: "Bash",
			toolInput: { command: "ls" },
			toolOutput: "file1.txt\nfile2.txt",
			cwd: "/home/user",
		});
		expect(data.tool_output).toBe("file1.txt\nfile2.txt");
	});
});

describe("interpretHookOutput", () => {
	it("exit code 2 = block", () => {
		const result = interpretHookOutput({ exitCode: 2, stdout: "", stderr: "blocked" });
		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("blocked");
	});

	it("exit code 0 with no stdout = pass", () => {
		const result = interpretHookOutput({ exitCode: 0, stdout: "", stderr: "" });
		expect(result.shouldBlock).toBe(false);
	});

	it("parsed continue:false = block", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: '{"continue":false,"stopReason":"nope"}',
			stderr: "",
			parsed: { continue: false, stopReason: "nope" },
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("nope");
	});

	it("parsed decision:block = block", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: '{"decision":"block","reason":"dangerous"}',
			stderr: "",
			parsed: { decision: "block", reason: "dangerous" },
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("dangerous");
	});

	it("parsed ok:false = block", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: '{"ok":false,"reason":"unsafe"}',
			stderr: "",
			parsed: { ok: false, reason: "unsafe" },
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("unsafe");
	});

	it("parsed ok:true = pass", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: '{"ok":true}',
			stderr: "",
			parsed: { ok: true },
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(false);
	});

	it("parsed permissionDecision:deny = block", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: "",
			stderr: "",
			parsed: {
				hookSpecificOutput: {
					permissionDecision: "deny",
					permissionDecisionReason: "not allowed",
				},
			},
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("not allowed");
	});

	it("parsed allow with updatedInput", () => {
		const updatedInput = { command: "ls -la" };
		const output: HookOutput = {
			exitCode: 0,
			stdout: "",
			stderr: "",
			parsed: {
				hookSpecificOutput: {
					permissionDecision: "allow",
					updatedInput,
					additionalContext: "context",
				},
			},
		};
		const result = interpretHookOutput(output);
		expect(result.shouldBlock).toBe(false);
		expect(result.updatedInput).toEqual(updatedInput);
		expect(result.additionalContext).toBe("context");
	});

	it("supports modifiedToolInput as alias for updatedInput", () => {
		const modified = { command: "ls -la" };
		const output: HookOutput = {
			exitCode: 0,
			stdout: "",
			stderr: "",
			parsed: {
				hookSpecificOutput: {
					modifiedToolInput: modified,
				},
			},
		};
		const result = interpretHookOutput(output);
		expect(result.updatedInput).toEqual(modified);
	});

	it("extracts systemMessage and suppressOutput", () => {
		const output: HookOutput = {
			exitCode: 0,
			stdout: "",
			stderr: "",
			parsed: {
				systemMessage: "important note",
				suppressOutput: true,
				hookSpecificOutput: {},
			},
		};
		const result = interpretHookOutput(output);
		expect(result.systemMessage).toBe("important note");
		expect(result.suppressOutput).toBe(true);
	});
});

describe("replaceVariables", () => {
	const stdin: HookStdinData = {
		session_id: "s1",
		transcript_path: "",
		cwd: "/project",
		permission_mode: "default",
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command: "rm -rf /tmp" },
	};

	it("replaces $CLAUDE_PROJECT_DIR", () => {
		expect(replaceVariables("$CLAUDE_PROJECT_DIR/hooks.sh", stdin, "/project")).toBe("/project/hooks.sh");
	});

	it("replaces $TOOL", () => {
		expect(replaceVariables("tool=$TOOL", stdin, "/project")).toBe("tool=Bash");
	});

	it("replaces $BASH_COMMAND", () => {
		expect(replaceVariables("cmd=$BASH_COMMAND", stdin, "/project")).toBe("cmd=rm -rf /tmp");
	});

	it("replaces $ARGUMENTS with JSON", () => {
		const result = replaceVariables("args=$ARGUMENTS", stdin, "/project");
		expect(result).toContain('"command"');
	});
});

describe("replaceInputPlaceholders", () => {
	it("replaces ${tool_input.file_path}", () => {
		const stdin = buildStdinData("PostToolUse", {
			toolName: "Edit",
			toolInput: { file_path: "/src/foo.ts" },
			cwd: "/project",
		});
		const result = replaceInputPlaceholders({ path: "${tool_input.file_path}" }, stdin);
		expect(result.path).toBe("/src/foo.ts");
	});

	it("handles nested objects", () => {
		const result = replaceInputPlaceholders({ nested: { deep: "${tool_name}" } }, {
			tool_name: "Bash",
		} as HookStdinData);
		expect(result.nested).toEqual({ deep: "Bash" });
	});
});

describe("replaceEnvVarsInHeaders", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, MY_TOKEN: "secret123" };
	});

	it("replaces allowed env vars in header values", () => {
		const result = replaceEnvVarsInHeaders({ Authorization: "Bearer $MY_TOKEN", "X-Other": "$OTHER" }, ["MY_TOKEN"]);
		expect(result.Authorization).toBe("Bearer secret123");
		expect(result["X-Other"]).toBe("$OTHER");
	});

	it("supports ${VAR} syntax", () => {
		const result = replaceEnvVarsInHeaders({ Authorization: "Bearer ${MY_TOKEN}" }, ["MY_TOKEN"]);
		expect(result.Authorization).toBe("Bearer secret123");
	});

	it("returns headers as-is when no allowedEnvVars", () => {
		const headers = { Authorization: "Bearer $MY_TOKEN" };
		const result = replaceEnvVarsInHeaders(headers, undefined);
		expect(result).toEqual(headers);
	});
});

describe("runHandler - command (integration)", () => {
	it("executes a command and parses JSON output", async () => {
		const handler = {
			type: "command" as const,
			command: "cat",
		};
		const stdinData = buildStdinData("PreToolUse", {
			toolName: "Bash",
			toolInput: { command: "ls" },
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false });
		expect(output.exitCode).toBe(0);
		expect(output.stdout).toBeTruthy();
		const parsed = JSON.parse(output.stdout);
		expect(parsed.hook_event_name).toBe("PreToolUse");
		expect(parsed.tool_name).toBe("Bash");
	});

	it("returns exit code 2 for blocking command", async () => {
		const handler = {
			type: "command" as const,
			command: "echo 'blocked' >&2 && exit 2",
		};
		const stdinData = buildStdinData("PreToolUse", {
			toolName: "Bash",
			toolInput: {},
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false });
		expect(output.exitCode).toBe(2);
		expect(output.stderr).toContain("blocked");
	});
});

describe("runHandler - prompt", () => {
	it("calls callLLM and returns parsed output", async () => {
		const callLLM = vi.fn(async () => JSON.stringify({ ok: true })) as unknown as ReturnType<
			typeof vi.fn<() => Promise<string>>
		>;
		const handler = {
			type: "prompt" as const,
			prompt: "Is this safe? $ARGUMENTS",
		};
		const stdinData = buildStdinData("PreToolUse", {
			toolName: "Bash",
			toolInput: { command: "ls" },
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false }, callLLM as any);
		expect(output.exitCode).toBe(0);
		expect(output.parsed?.ok).toBe(true);
		expect(callLLM).toHaveBeenCalled();
		const callArg = (callLLM as any).mock.calls[0][0];
		expect(callArg.messages[0].content).toContain("ls");
	});
});

describe("runHandler - agent", () => {
	it("calls callLLM with tools enabled", async () => {
		const callLLM = vi.fn<() => Promise<string>>(async () => JSON.stringify({ ok: true }));
		const handler = {
			type: "agent" as const,
			prompt: "Check if $ARGUMENTS is safe",
		};
		const stdinData = buildStdinData("PreToolUse", {
			toolName: "Bash",
			toolInput: { command: "ls" },
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false }, callLLM as any);
		expect(output.exitCode).toBe(0);
		const callArg = (callLLM as any).mock.calls[0][0];
		expect(callArg.maxTurns).toBe(50);
	});
});

describe("runHandler - http SSRF protection", () => {
	it("rejects HTTP (non-HTTPS) URLs", async () => {
		const handler = {
			type: "http" as const,
			url: "http://example.com/webhook",
		};
		const stdinData = buildStdinData("Notification", {
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false });
		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("HTTPS");
	});

	it("rejects localhost", async () => {
		const handler = {
			type: "http" as const,
			url: "https://localhost:3000/webhook",
		};
		const stdinData = buildStdinData("Notification", {
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false });
		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("private");
	});

	it("rejects 127.0.0.1", async () => {
		const handler = {
			type: "http" as const,
			url: "https://127.0.0.1:3000/webhook",
		};
		const stdinData = buildStdinData("Notification", {
			cwd: "/tmp",
		});
		const output = await runHandler(handler, stdinData, { cwd: "/tmp", hasUI: false });
		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("private");
	});
});
