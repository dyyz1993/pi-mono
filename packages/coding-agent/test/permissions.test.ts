import { describe, expect, it } from "vitest";
import { checkToolPermission } from "../src/core/permissions.ts";

describe("checkToolPermission: allowlist (AgentConfig.tools)", () => {
	it("allows listed tools", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["read", "grep", "find", "ls"],
		});
		expect(result).toBeNull();
	});

	it("blocks tools not in the allowlist", () => {
		const result = checkToolPermission({
			toolName: "write",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["read", "grep"],
		});
		expect(result).not.toBeNull();
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("write");
	});

	it("supports tool name wildcard", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["*"],
		});
		expect(result).toBeNull();
	});

	it("supports tool(input) glob patterns for command", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "git status" },
			permissionMode: "normal",
			allowedTools: ["bash(git *)"],
		});
		expect(result).toBeNull();
	});

	it("blocks when tool(input) glob does not match", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			allowedTools: ["bash(git *)"],
		});
		expect(result?.block).toBe(true);
	});

	// GAP 3: empty allowedTools array
	it("treats empty allowedTools array as no allowlist", () => {
		const result = checkToolPermission({
			toolName: "write",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: [],
		});
		expect(result).toBeNull();
	});
});

describe("checkToolPermission: blocklist (AgentConfig.disallowedTools)", () => {
	it("blocks tools in the blocklist", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: ["edit", "write"],
		});
		expect(result?.block).toBe(true);
	});

	it("allows tools not in the blocklist", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: ["edit", "write"],
		});
		expect(result).toBeNull();
	});

	it("blocks tool with matching input pattern", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			disallowedTools: ["bash(rm*)"],
		});
		expect(result?.block).toBe(true);
	});

	// GAP 4: empty disallowedTools array
	it("treats empty disallowedTools array as no blocklist", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: [],
		});
		expect(result).toBeNull();
	});
});

describe("checkToolPermission: dangerous bash (normal mode)", () => {
	it("blocks rm -rf in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /tmp/data" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	it("blocks git push --force in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "git push --force origin main" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	it("blocks sudo in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "sudo apt install foo" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	it("blocks .env access in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "cat .env" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	// GAP 5a: --no-verify
	it("blocks --no-verify in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "git commit --no-verify -m x" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	// GAP 5b: chmod 777
	it("blocks chmod 777 in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "chmod 777 /tmp/data" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	// GAP 5c: credentials
	it("blocks credentials in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "cat credentials.json" },
			permissionMode: "normal",
		});
		expect(result?.block).toBe(true);
	});

	// GAP 1: safe bash command in normal mode
	it("allows safe bash command in normal mode", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "echo hello" },
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	// GAP 2: non-string command
	it("allows bash with undefined command", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: {},
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	it("allows bash with non-string command (number)", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: 42 },
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	it("allows bash with null command", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: null },
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	it("yolo mode skips dangerous-bash blocking", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /tmp/data" },
			permissionMode: "yolo",
		});
		expect(result).toBeNull();
	});

	it("yolo mode still enforces blocklist", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "yolo",
			disallowedTools: ["edit"],
		});
		expect(result?.block).toBe(true);
	});

	it("non-bash tools are not dangerous-bash checked", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/etc/passwd" },
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});
});

describe("checkToolPermission: path constraints", () => {
	it("blocks write to path not in write patterns", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("write");
		expect(result?.reason).toContain("src/index.ts");
	});

	it("allows write to path matching write pattern", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("blocks read to path not in read patterns", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	it("allows read to path matching read pattern", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
			paths: { read: ["src/**"] },
		});
		expect(result).toBeNull();
	});

	it("accepts filePath parameter name", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { filePath: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("accepts path parameter name", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("allows grep/find/ls without path check", () => {
		const result = checkToolPermission({
			toolName: "grep",
			input: { pattern: "secret" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("bash is not path-checked", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("blocks path traversal that escapes allowed dir", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/docs/../../etc/passwd" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	it("does not block when file_path is empty", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	// GAP 6: "write" tool
	it("blocks write tool outside allowed write paths", () => {
		const result = checkToolPermission({
			toolName: "write",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	it("allows write tool inside allowed write paths", () => {
		const result = checkToolPermission({
			toolName: "write",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	// GAP 7: "multiedit" and "patch" tools
	it("blocks multiedit tool outside allowed write paths", () => {
		const result = checkToolPermission({
			toolName: "multiedit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	it("blocks patch tool outside allowed write paths", () => {
		const result = checkToolPermission({
			toolName: "patch",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	// GAP 8: write tool with no path arg
	it("allows write tool with no path argument in input", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: {},
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	// GAP 9: paths.write is empty array
	it("allows write when paths.write is empty array", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: [] },
		});
		expect(result).toBeNull();
	});

	// GAP 10: paths.write is undefined
	it("allows write when paths.write is undefined", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: undefined },
		});
		expect(result).toBeNull();
	});

	it("allows read when paths.read is undefined", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
			paths: { read: undefined },
		});
		expect(result).toBeNull();
	});

	// GAP 15: file:// URL normalization
	it("normalizes file:// URLs for path checking", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "file:///project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	it("blocks file:// URLs outside allowed paths", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "file:///project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
	});

	// GAP 16: relative paths
	it("handles relative paths for read constraints", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "docs/readme.md" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
		});
		expect(result).toBeNull();
	});

	// GAP 17: minimatch invalid pattern resilience
	it("does not crash on invalid glob pattern", () => {
		const result = checkToolPermission({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["[invalid"] },
		});
		// Should not throw; minimatch error is caught, treated as no match → block
		expect(result?.block).toBe(true);
	});
});

describe("checkToolPermission: tool pattern matching", () => {
	// GAP 11: wildcard tool name with paren glob
	it("matches wildcard tool name *(rm*) against bash", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			disallowedTools: ["*(rm*)"],
		});
		expect(result?.block).toBe(true);
	});

	// GAP 12: multi-alternative pattern with |
	it("blocks bash matching either alternative in git*|rm*", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /tmp" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
		});
		expect(result?.block).toBe(true);
	});

	it("blocks bash matching second alternative in git*|rm*", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "git push" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
		});
		expect(result?.block).toBe(true);
	});

	it("allows bash not matching any alternative", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "echo hello" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
		});
		expect(result).toBeNull();
	});

	// GAP 13a: tool() empty parens
	it("allows tool() with empty parens", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "anything" },
			permissionMode: "normal",
			allowedTools: ["bash()"],
		});
		expect(result).toBeNull();
	});

	// GAP 13b: tool(*) star glob
	it("allows tool(*) with star glob", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "anything" },
			permissionMode: "normal",
			allowedTools: ["bash(*)"],
		});
		expect(result).toBeNull();
	});

	// GAP 14: tool(glob) where input has no relevant fields
	it("blocks when tool(glob) has no matching input fields", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: {},
			permissionMode: "normal",
			disallowedTools: ["bash(rm*)"],
		});
		expect(result).toBeNull();
	});

	// matchToolName branches
	it("matches ** double-star pattern as wildcard", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: {},
			permissionMode: "normal",
			allowedTools: ["**"],
		});
		expect(result).toBeNull();
	});

	it("matches *tool suffix pattern", () => {
		const result = checkToolPermission({
			toolName: "my_read",
			input: {},
			permissionMode: "normal",
			allowedTools: ["*read"],
		});
		expect(result).toBeNull();
	});

	it("blocks non-matching *tool suffix pattern", () => {
		const result = checkToolPermission({
			toolName: "my_write",
			input: {},
			permissionMode: "normal",
			allowedTools: ["*read"],
		});
		expect(result?.block).toBe(true);
	});

	it("matches tool* prefix pattern", () => {
		const result = checkToolPermission({
			toolName: "read_file",
			input: {},
			permissionMode: "normal",
			allowedTools: ["read*"],
		});
		expect(result).toBeNull();
	});

	it("blocks non-matching tool* prefix pattern", () => {
		const result = checkToolPermission({
			toolName: "write_file",
			input: {},
			permissionMode: "normal",
			allowedTools: ["read*"],
		});
		expect(result?.block).toBe(true);
	});
});

describe("checkToolPermission: input edge cases", () => {
	// inputToRecord with null
	it("handles null input without crashing", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: null,
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	// inputToRecord with array
	it("handles array input without crashing", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: [1, 2, 3],
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	// inputToRecord with primitive
	it("handles string input without crashing", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: "just a string",
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	it("handles number input without crashing", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: 42,
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});

	it("handles undefined input without crashing", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: undefined,
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});
});

describe("checkToolPermission: precedence", () => {
	it("allowlist check runs before blocklist", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "echo hi" },
			permissionMode: "normal",
			allowedTools: ["read"],
			disallowedTools: ["write"],
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("not in allowed tools");
	});

	it("path check runs before dangerous-bash check", () => {
		const result = checkToolPermission({
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("dangerous bash");
	});

	it("returns null when nothing blocks", () => {
		const result = checkToolPermission({
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
		});
		expect(result).toBeNull();
	});
});
