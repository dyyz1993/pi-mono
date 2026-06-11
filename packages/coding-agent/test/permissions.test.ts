import { describe, expect, it } from "vitest";
import { type CorePermissionMode, checkToolPermission } from "../src/core/permissions.ts";

interface Expected {
	block?: boolean;
	reasonContains?: string | string[];
}

type Entry = {
	description: string;
	toolName: string;
	input: unknown;
	permissionMode?: CorePermissionMode;
	allowedTools?: string[];
	disallowedTools?: string[];
	paths?: Record<string, string[] | undefined>;
	expected: Expected;
};
describe("permissionMode field", () => {
	it.each([
		{
			description: "allows normal mode by default",
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "yolo mode skips dangerous-bash blocking",
			toolName: "bash",
			input: { command: "rm -rf /tmp/data" },
			permissionMode: "yolo",
			expected: {},
		},
		{
			description: "yolo mode still enforces blocklist",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "yolo",
			disallowedTools: ["edit"],
			expected: { block: true },
		},
		{
			description: "undefined permissionMode does not block dangerous bash",
			toolName: "bash",
			input: { command: "rm -rf /tmp/data" },
			permissionMode: undefined,
			expected: {},
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("tools field", () => {
	it.each([
		{
			description: "allows listed tools",
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["read", "grep", "find", "ls"],
			expected: {},
		},
		{
			description: "blocks tools not in the allowlist",
			toolName: "write",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["read", "grep"],
			expected: { block: true, reasonContains: "write" },
		},
		{
			description: "supports tool name wildcard",
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["*"],
			expected: {},
		},
		{
			description: "supports tool(input) glob patterns for command",
			toolName: "bash",
			input: { command: "git status" },
			permissionMode: "normal",
			allowedTools: ["bash(git *)"],
			expected: {},
		},
		{
			description: "blocks when tool(input) glob does not match",
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			allowedTools: ["bash(git *)"],
			expected: { block: true },
		},
		{
			description: "treats empty allowedTools array as no allowlist",
			toolName: "write",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: [],
			expected: {},
		},
		{
			description: "undefined allowedTools is treated as no allowlist",
			toolName: "write",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: undefined,
			expected: {},
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("disallowedTools field", () => {
	it.each([
		{
			description: "blocks tools in the blocklist",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: ["edit", "write"],
			expected: { block: true },
		},
		{
			description: "allows tools not in the blocklist",
			toolName: "read",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: ["edit", "write"],
			expected: {},
		},
		{
			description: "blocks tool with matching input pattern",
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			disallowedTools: ["bash(rm*)"],
			expected: { block: true },
		},
		{
			description: "treats empty disallowedTools array as no blocklist",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: [],
			expected: {},
		},
		{
			description: "undefined disallowedTools is treated as no blocklist",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			disallowedTools: undefined,
			expected: {},
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("paths.write field", () => {
	it.each([
		{
			description: "allows write to path matching write pattern",
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "accepts filePath parameter name",
			toolName: "edit",
			input: { filePath: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "accepts path parameter name",
			toolName: "edit",
			input: { path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "does not block when file_path is empty",
			toolName: "edit",
			input: { file_path: "" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "allows write tool inside allowed write paths",
			toolName: "write",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "allows write tool with no path argument in input",
			toolName: "edit",
			input: {},
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "allows write when paths.write is empty array",
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: [] },
			expected: {},
		},
		{
			description: "allows write when paths.write is undefined",
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: undefined },
			expected: {},
		},
		{
			description: "normalizes file:// URLs for path checking",
			toolName: "edit",
			input: { file_path: "file:///project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "paths.write ** wildcard allows all write paths",
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["**"] },
			expected: {},
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});

	it.each([
		{
			description: "blocks write to path not in write patterns",
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true, reasonContains: ["write", "src/index.ts"] },
		},
		{
			description: "blocks path traversal that escapes allowed dir",
			toolName: "edit",
			input: { file_path: "/project/docs/../../etc/passwd" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "blocks write tool outside allowed write paths",
			toolName: "write",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "blocks multiedit tool outside allowed write paths",
			toolName: "multiedit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "blocks patch tool outside allowed write paths",
			toolName: "patch",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "blocks file:// URLs outside allowed paths",
			toolName: "edit",
			input: { file_path: "file:///project/src/index.ts" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "does not crash on invalid glob pattern",
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["[invalid"] },
			expected: { block: true },
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("paths.read field", () => {
	it.each([
		{
			description: "blocks read to path not in read patterns",
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
			expected: { block: true },
		},
		{
			description: "allows read to path matching read pattern",
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
			paths: { read: ["src/**"] },
			expected: {},
		},
		{
			description: "allows read when paths.read is undefined",
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
			permissionMode: "normal",
			paths: { read: undefined },
			expected: {},
		},
		{
			description: "handles relative paths for read constraints",
			toolName: "read",
			input: { file_path: "docs/readme.md" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
			expected: {},
		},
		{
			description: "paths.read empty array allows all reads",
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
			permissionMode: "normal",
			paths: { read: [] },
			expected: {},
		},
		{
			description: "paths.read ** wildcard allows all read paths",
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
			permissionMode: "normal",
			paths: { read: ["**"] },
			expected: {},
		},
	] as Entry[])("$description", (data: Entry) => {
		const result = checkToolPermission({
			toolName: data.toolName,
			input: data.input,
			permissionMode: data.permissionMode as CorePermissionMode,
			allowedTools: data.allowedTools,
			disallowedTools: data.disallowedTools,
			paths: data.paths,
		});
		if (data.expected?.block) {
			expect(result?.block).toBe(true);
			if (data.expected?.reasonContains) {
				const checks = Array.isArray(data.expected.reasonContains)
					? data.expected.reasonContains
					: [data.expected.reasonContains];
				for (const rc of checks) {
					expect(result?.reason).toContain(rc);
				}
			}
		} else {
			expect(result).toBeNull();
		}
	});
});

describe("paths.bash field", () => {
	it.each([
		{
			description: "paths.bash undefined does not block bash",
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
			permissionMode: "normal",
			paths: { bash: undefined },
			expected: {},
		},
		{
			description: "paths.bash empty array does not block bash",
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
			permissionMode: "normal",
			paths: { bash: [] },
			expected: {},
		},
		{
			description: "paths.bash with specific glob does not block bash (bash is not path-checked)",
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
			permissionMode: "normal",
			paths: { bash: ["/tmp/**"] },
			expected: {},
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("dangerous bash patterns", () => {
	it.each([
		{
			description: "blocks rm -rf in normal mode",
			toolName: "bash",
			input: { command: "rm -rf /tmp/data" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks git push --force in normal mode",
			toolName: "bash",
			input: { command: "git push --force origin main" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks sudo in normal mode",
			toolName: "bash",
			input: { command: "sudo apt install foo" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks .env access in normal mode",
			toolName: "bash",
			input: { command: "cat .env" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks --no-verify in normal mode",
			toolName: "bash",
			input: { command: "git commit --no-verify -m x" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks chmod 777 in normal mode",
			toolName: "bash",
			input: { command: "chmod 777 /tmp/data" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "blocks credentials in normal mode",
			toolName: "bash",
			input: { command: "cat credentials.json" },
			permissionMode: "normal",
			expected: { block: true },
		},
		{
			description: "path check does not interfere with dangerous bash blocking",
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: { block: true, reasonContains: "dangerous bash" },
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);

	it.each([
		{
			description: "allows safe bash command in normal mode",
			toolName: "bash",
			input: { command: "echo hello" },
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "allows bash with undefined command",
			toolName: "bash",
			input: {},
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "allows bash with non-string command (number)",
			toolName: "bash",
			input: { command: 42 },
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "allows bash with null command",
			toolName: "bash",
			input: { command: null },
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "non-bash tools are not dangerous-bash checked",
			toolName: "read",
			input: { file_path: "/etc/passwd" },
			permissionMode: "normal",
			expected: {},
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("tools vs disallowedTools conflict", () => {
	it.each([
		{
			description: "allowlist check runs before blocklist",
			toolName: "bash",
			input: { command: "echo hi" },
			permissionMode: "normal",
			allowedTools: ["read"],
			disallowedTools: ["write"],
			expected: { block: true, reasonContains: "not in allowed tools" },
		},
		{
			description: "blocklist wins when tool is in both allowlist and blocklist",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["edit", "write"],
			disallowedTools: ["edit"],
			expected: { block: true, reasonContains: "disallowed" },
		},
		{
			description: "blocklist still works when allowlist is empty (no allowlist)",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: [],
			disallowedTools: ["edit"],
			expected: { block: true, reasonContains: "disallowed" },
		},
		{
			description: "blocklist still works when allowlist is wildcard",
			toolName: "edit",
			input: { file_path: "/x" },
			permissionMode: "normal",
			allowedTools: ["*"],
			disallowedTools: ["edit"],
			expected: { block: true, reasonContains: "disallowed" },
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("matchToolName patterns", () => {
	it.each([
		{
			description: "matches wildcard tool name *(rm*) against bash",
			toolName: "bash",
			input: { command: "rm -rf /" },
			permissionMode: "normal",
			disallowedTools: ["*(rm*)"],
			expected: { block: true },
		},
		{
			description: "blocks bash matching either alternative in git*|rm*",
			toolName: "bash",
			input: { command: "rm -rf /tmp" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
			expected: { block: true },
		},
		{
			description: "blocks bash matching second alternative in git*|rm*",
			toolName: "bash",
			input: { command: "git push" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
			expected: { block: true },
		},
		{
			description: "allows bash not matching any alternative",
			toolName: "bash",
			input: { command: "echo hello" },
			permissionMode: "normal",
			disallowedTools: ["bash(git*|rm*)"],
			expected: {},
		},
		{
			description: "allows tool() with empty parens",
			toolName: "bash",
			input: { command: "anything" },
			permissionMode: "normal",
			allowedTools: ["bash()"],
			expected: {},
		},
		{
			description: "allows tool(*) with star glob",
			toolName: "bash",
			input: { command: "anything" },
			permissionMode: "normal",
			allowedTools: ["bash(*)"],
			expected: {},
		},
		{
			description: "blocks when tool(glob) has no matching input fields",
			toolName: "bash",
			input: {},
			permissionMode: "normal",
			disallowedTools: ["bash(rm*)"],
			expected: {},
		},
		{
			description: "matches ** double-star pattern as wildcard",
			toolName: "read",
			input: {},
			permissionMode: "normal",
			allowedTools: ["**"],
			expected: {},
		},
		{
			description: "matches *tool suffix pattern",
			toolName: "my_read",
			input: {},
			permissionMode: "normal",
			allowedTools: ["*read"],
			expected: {},
		},
		{
			description: "blocks non-matching *tool suffix pattern",
			toolName: "my_write",
			input: {},
			permissionMode: "normal",
			allowedTools: ["*read"],
			expected: { block: true },
		},
		{
			description: "matches tool* prefix pattern",
			toolName: "read_file",
			input: {},
			permissionMode: "normal",
			allowedTools: ["read*"],
			expected: {},
		},
		{
			description: "blocks non-matching tool* prefix pattern",
			toolName: "write_file",
			input: {},
			permissionMode: "normal",
			allowedTools: ["read*"],
			expected: { block: true },
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("inputToRecord parsing", () => {
	it.each([
		{
			description: "handles null input without crashing",
			toolName: "read",
			input: null,
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "handles array input without crashing",
			toolName: "read",
			input: [1, 2, 3],
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "handles string input without crashing",
			toolName: "read",
			input: "just a string",
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "handles number input without crashing",
			toolName: "read",
			input: 42,
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "handles undefined input without crashing",
			toolName: "read",
			input: undefined,
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "handles boolean input without crashing",
			toolName: "read",
			input: false,
			permissionMode: "normal",
			expected: {},
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("checkPathPermission", () => {
	it.each([
		{
			description: "allows grep/find/ls without path check",
			toolName: "grep",
			input: { pattern: "secret" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
			expected: {},
		},
		{
			description: "bash is not path-checked",
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "write tool with no paths config is not blocked by path check",
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
			permissionMode: "normal",
			expected: {},
		},
		{
			description: "read tool with no paths config is not blocked by path check",
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
			permissionMode: "normal",
			expected: {},
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});

describe("normalizeFilePath", () => {
	it.each([
		{
			description: "normalizes relative path for path matching",
			toolName: "read",
			input: { file_path: "docs/readme.md" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
			expected: {},
		},
		{
			description: "normalizes absolute path correctly",
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
			permissionMode: "normal",
			paths: { write: ["docs/**"] },
			expected: {},
		},
		{
			description: "normalizes CWD-prefixed path for path matching",
			toolName: "read",
			input: { file_path: "./docs/readme.md" },
			permissionMode: "normal",
			paths: { read: ["docs/**"] },
			expected: {},
		},
		{
			description: "normalizes trailing slash for path matching",
			toolName: "edit",
			input: { file_path: "/project/docs/" },
			permissionMode: "normal",
			paths: { write: ["project/**"] },
			expected: {},
		},
	] as Entry[])(
		"$description",
		({ description: _desc, toolName, input, permissionMode, allowedTools, disallowedTools, paths, expected }) => {
			const result = checkToolPermission({
				toolName,
				input,
				permissionMode: permissionMode as CorePermissionMode,
				allowedTools,
				disallowedTools,
				paths,
			});
			if (expected?.block) {
				expect(result?.block).toBe(true);
				if (expected?.reasonContains) {
					const checks = Array.isArray(expected.reasonContains)
						? expected.reasonContains
						: [expected.reasonContains];
					for (const rc of checks) {
						expect(result?.reason).toContain(rc);
					}
				}
			} else {
				expect(result).toBeNull();
			}
		},
	);
});
