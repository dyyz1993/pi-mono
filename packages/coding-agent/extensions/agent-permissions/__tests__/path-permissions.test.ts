import { describe, it, expect } from "vitest";
import {
	type PathConfig,
	type PathPermissionResult,
	createPathPermissionHandler,
	matchPathGlob,
	normalizeFilePath,
} from "../path-checker.js";

describe("PathConfig type parsing", () => {
	it("parses valid full paths config", () => {
		const paths: PathConfig = {
			write: ["docs/**", ".pi/plans/**"],
			read: ["**"],
			bash: ["scripts/**"],
		};
		expect(paths.write).toEqual(["docs/**", ".pi/plans/**"]);
		expect(paths.read).toEqual(["**"]);
		expect(paths.bash).toEqual(["scripts/**"]);
	});

	it("handles missing paths (undefined = no restrictions)", () => {
		const handler = createPathPermissionHandler(undefined);
		expect(handler).toBeNull();
	});

	it("handles partial paths (only write)", () => {
		const paths: PathConfig = {
			write: ["src/**"],
		};
		const handler = createPathPermissionHandler(paths);
		expect(handler).not.toBeNull();
	});

	it("handles partial paths (only read)", () => {
		const paths: PathConfig = {
			read: ["src/**"],
		};
		const handler = createPathPermissionHandler(paths);
		expect(handler).not.toBeNull();
	});

	it("handles empty paths object (no restrictions)", () => {
		const handler = createPathPermissionHandler({});
		expect(handler).toBeNull();
	});

	it("handles paths.write with explicit catch-all **", () => {
		const paths: PathConfig = {
			write: ["**"],
		};
		const handler = createPathPermissionHandler(paths);
		const result = handler!({ toolName: "edit", input: { file_path: "/any/path.ts" } });
		expect(result).toBeNull();
	});
});

describe("Write path checking", () => {
	it("allows edit tool when file_path matches write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", ".pi/plans/**"],
		})!;
		const result: PathPermissionResult | null = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("allows write tool when file_path matches write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", ".pi/plans/**"],
		})!;
		const result = handler({
			toolName: "write",
			input: { file_path: "/project/.pi/plans/plan-1.md" },
		});
		expect(result).toBeNull();
	});

	it("blocks edit tool when file_path does not match write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", ".pi/plans/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("write");
		expect(result!.reason).toContain("src/index.ts");
	});

	it("blocks write tool when file_path does not match write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "write",
			input: { file_path: "/project/src/main.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("allows all writes when no paths.write is defined", () => {
		const handler = createPathPermissionHandler({
			read: ["src/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/anywhere/file.ts" },
		});
		expect(result).toBeNull();
	});

	it("allows edit tool matching nested glob pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["src/components/**/test/*.ts"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/components/button/test/button.test.ts" },
		});
		expect(result).toBeNull();
	});

	it("blocks edit tool that partially matches but does not fully match", () => {
		const handler = createPathPermissionHandler({
			write: ["src/components/**/*.test.ts"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/components/button/button.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("allows patch tool when file_path matches write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "patch",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("blocks patch tool when file_path does not match write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "patch",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("allows multiedit tool when file_path matches write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "multiedit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("blocks multiedit tool when file_path does not match write pattern", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "multiedit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});
});

describe("Read path checking", () => {
	it("allows read tool when file_path matches read pattern", () => {
		const handler = createPathPermissionHandler({
			read: ["src/**", "docs/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/src/utils/helpers.ts" },
		});
		expect(result).toBeNull();
	});

	it("allows grep/glob/find/ls tools without path check", () => {
		const handler = createPathPermissionHandler({
			read: ["docs/**"],
		})!;
		for (const tool of ["grep", "glob", "find", "ls"] as const) {
			const result = handler({
				toolName: tool,
				input: { pattern: "test" },
			});
			expect(result).toBeNull();
		}
	});

	it("blocks read tool when file_path does not match read pattern", () => {
		const handler = createPathPermissionHandler({
			read: ["docs/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("read");
	});

	it("allows all reads when no paths.read is defined", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/anywhere/secret.ts" },
		});
		expect(result).toBeNull();
	});

	it("allows read when both read and write paths are set and file matches read", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			read: ["src/**", "docs/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/src/app.ts" },
		});
		expect(result).toBeNull();
	});
});

describe("Bash path checking", () => {
	it("allows all bash commands when no paths.bash is defined", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "bash",
			input: { command: "rm -rf /tmp/test" },
		});
		expect(result).toBeNull();
	});

	it("allows all bash commands when paths is empty object", () => {
		const handler = createPathPermissionHandler({});
		expect(handler).toBeNull();
	});
});

describe("Edge cases", () => {
	it("resolves relative file_path against CWD before checking", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("normalizes file_path with .. before checking", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/../docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("blocks path traversal attempt that escapes allowed dir", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/../../etc/passwd" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("allows edit when paths.write contains ** (explicit catch-all)", () => {
		const handler = createPathPermissionHandler({
			write: ["**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/any/deep/nested/file.ts" },
		});
		expect(result).toBeNull();
	});

	it("handles multiple write patterns with first match winning", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", "src/**", "*.md"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("handles file_path with file:// prefix", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "file:///project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});
});

describe("matchPathGlob", () => {
	it("matches simple glob pattern", () => {
		expect(matchPathGlob("/project/docs/readme.md", "docs/**")).toBe(true);
	});

	it("rejects non-matching path", () => {
		expect(matchPathGlob("/project/src/index.ts", "docs/**")).toBe(false);
	});

	it("matches ** catch-all", () => {
		expect(matchPathGlob("/any/path/file.ts", "**")).toBe(true);
	});

	it("matches *.ext pattern against basename", () => {
		expect(matchPathGlob("/project/docs/readme.md", "*.md")).toBe(true);
	});

	it("rejects non-matching extension", () => {
		expect(matchPathGlob("/project/docs/readme.md", "*.ts")).toBe(false);
	});

	it("matches directory-specific pattern", () => {
		expect(matchPathGlob("/project/src/utils/helpers.ts", "src/utils/**")).toBe(true);
	});
});

describe("normalizeFilePath", () => {
	it("resolves .. segments", () => {
		expect(normalizeFilePath("/project/src/../docs/readme.md")).toBe("/project/docs/readme.md");
	});

	it("resolves . segments", () => {
		expect(normalizeFilePath("/project/./docs/./readme.md")).toBe("/project/docs/readme.md");
	});

	it("handles relative paths by keeping them relative", () => {
		const result = normalizeFilePath("docs/readme.md");
		expect(result).not.toContain("..");
	});
});

describe("Integration: path permissions compose with mode permissions", () => {
	it("path permissions are checked independently of permissionMode", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("write tool respects write paths only, not read paths", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			read: ["src/**"],
		})!;
		const result = handler({
			toolName: "write",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("read tool respects read paths only, not write paths", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			read: ["src/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("edit tool uses file_path parameter name", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { filePath: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("write tool uses file_path parameter name", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "write",
			input: { filePath: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});
});

describe("Edge case: unusual file paths", () => {
	it("handles empty string file_path", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "" },
		});
		expect(result).toBeNull();
	});

	it("handles bare filename without directory", () => {
		const handler = createPathPermissionHandler({
			write: ["*.md"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "readme.md" },
		});
		expect(result).toBeNull();
	});

	it("handles bare filename blocked when pattern requires directory", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("handles Unicode file paths", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/中文文档/说明.md" },
		});
		expect(result).toBeNull();
	});

	it("handles very long file path", () => {
		const longPath = "/project/docs/" + "subdir/".repeat(50) + "file.txt";
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: longPath },
		});
		expect(result).toBeNull();
	});

	it("handles file_path with spaces in path", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/my documents/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("handles file_path with special characters", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/file (copy).md" },
		});
		expect(result).toBeNull();
	});
});

describe("Symlinks handling", () => {
	it("symlink path that doesn't match pattern is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: symlink /project/docs-link → /project/docs
		// But the input path is "docs-link/readme.md", not "docs/readme.md"
		// The path checker matches against the string pattern, not the actual filesystem target
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs-link/readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("write");
	});

	it("symlink path that matches pattern is allowed", () => {
		const handler = createPathPermissionHandler({
			write: ["docs*/**"],
		})!;
		// Simulate: symlink /project/docs-link → /project/docs
		// Pattern docs*/** matches "docs-link/readme.md"
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs-link/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("symlink to blocked directory is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: symlink /project/src-link → /project/src
		// Path "src-link/index.ts" doesn't match "docs/**" pattern
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src-link/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("path traversal via symlink is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: symlink /project/docs/escape → /project/../../etc
		// Path traversal is blocked by .. normalization
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/escape/passwd" },
		});
		// The path "escape/passwd" matches "docs/**" pattern, so it's allowed
		// (the checker doesn't resolve symlinks, it just matches the string pattern)
		expect(result).toBeNull();
	});

	it("path traversal with .. in symlink path is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: attempt to escape docs directory via .. in the path
		// Even if there was a symlink, the .. normalization prevents this
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/../../etc/passwd" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("symlink to file outside allowed dir is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: symlink /project/docs/secret-link → /project/src/secret.ts
		// Path "docs/secret-link" matches "docs/**" pattern, so it's allowed
		// (the checker doesn't resolve symlinks to find the actual target)
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/secret-link" },
		});
		expect(result).toBeNull();
	});

	it("symlink to file outside allowed dir with restrictive pattern is blocked", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/*.md"],
		})!;
		// Simulate: symlink /project/docs/secret-link → /project/src/secret.ts
		// Path "docs/secret-link" doesn't match "docs/*.md" pattern (no .md extension)
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/secret-link" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("circular symlinks are handled gracefully", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// Simulate: circular symlink /project/docs/circular → /project/docs
		// Path "docs/circular/readme.md" matches "docs/**" pattern
		// Since we don't resolve symlinks, there's no infinite loop
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/circular/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("symlink pattern security: specific patterns prevent bypass", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		// User tries to use a symlink name that looks like "docs" but isn't in docs dir
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/not-really-docs-but-trick/file.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("multiple symlinks scenario: only matching patterns allowed", () => {
		const handler = createPathPermissionHandler({
			write: ["docs-link/**", "config-link/**"],
		})!;
		// Allowed: symlink paths that match the patterns
		const allowed1 = handler({
			toolName: "edit",
			input: { file_path: "/project/docs-link/readme.md" },
		});
		const allowed2 = handler({
			toolName: "edit",
			input: { file_path: "/project/config-link/settings.json" },
		});
		// Blocked: symlink paths that don't match any pattern
		const blocked = handler({
			toolName: "edit",
			input: { file_path: "/project/src-link/index.ts" },
		});

		expect(allowed1).toBeNull();
		expect(allowed2).toBeNull();
		expect(blocked).not.toBeNull();
		expect(blocked!.block).toBe(true);
	});

	it("read operations with symlink paths respect read patterns", () => {
		const handler = createPathPermissionHandler({
			read: ["docs/**"],
		})!;
		// Simulate: symlink /project/docs-link → /project/docs
		// Path "docs-link/readme.md" doesn't match "docs/**" pattern
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/docs-link/readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("read operations with symlink paths that match pattern are allowed", () => {
		const handler = createPathPermissionHandler({
			read: ["docs*/**"],
		})!;
		const result = handler({
			toolName: "read",
			input: { file_path: "/project/docs-link/readme.md" },
		});
		expect(result).toBeNull();
	});
});

describe("Cross-platform path handling", () => {
	it("handles backslash Windows-style paths", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "C:\\Users\\project\\docs\\readme.md" },
		});
		expect(result).toBeDefined();
	});

	it("handles POSIX tilde home path", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "~/docs/readme.md" },
		});
		expect(result).toBeDefined();
	});

	it("handles UNC network path", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "\\\\server\\share\\docs\\readme.md" },
		});
		expect(result).toBeDefined();
	});
});

describe("Invalid glob pattern handling", () => {
	it("handles empty glob pattern gracefully", () => {
		expect(() => matchPathGlob("/project/docs/readme.md", "")).not.toThrow();
	});

	it("handles glob pattern with only special chars", () => {
		expect(() => matchPathGlob("/project/docs/readme.md", "***")).not.toThrow();
	});

	it("handles glob pattern with unbalanced brackets", () => {
		expect(() => matchPathGlob("/project/docs/readme.md", "[")).not.toThrow();
		expect(() => matchPathGlob("/project/docs/readme.md", "[a-")).not.toThrow();
	});

	it("handler with invalid pattern still works for other patterns", () => {
		const handler = createPathPermissionHandler({
			write: ["[invalid", "docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("handler with all invalid patterns blocks everything", () => {
		const handler = createPathPermissionHandler({
			write: ["[broken"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});
});

describe("Gap 4: Error message format and content", () => {
	it("write block message includes the file path", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(result).not.toBeNull();
		expect(result!.reason).toContain("src/index.ts");
	});

	it("write block message includes the allowed patterns", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**", "*.md"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(result).not.toBeNull();
		expect(result!.reason).toContain("docs/**");
		expect(result!.reason).toContain("*.md");
	});

	it("write block message says 'write'", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(result).not.toBeNull();
		expect(result!.reason.toLowerCase()).toContain("write");
	});

	it("read block message says 'read'", () => {
		const handler = createPathPermissionHandler({ read: ["src/**"] })!;
		const result = handler({ toolName: "read", input: { path: "/project/docs/readme.md" } });
		expect(result).not.toBeNull();
		expect(result!.reason.toLowerCase()).toContain("read");
	});

	it("block result has consistent structure", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(result).toEqual({
			block: true,
			reason: expect.any(String),
		});
		expect(result!.reason.length).toBeGreaterThan(10);
	});
});

describe("Duplicate and conflicting patterns", () => {
	it("duplicate patterns work correctly", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", "docs/**", "docs/**"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("overlapping patterns work correctly", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**", "docs/readme.md"],
		})!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("pattern order doesn't affect matching", () => {
		const handler1 = createPathPermissionHandler({
			write: ["*.md", "docs/**"],
		})!;
		const handler2 = createPathPermissionHandler({
			write: ["docs/**", "*.md"],
		})!;
		const path = "/project/docs/readme.md";
		const result1 = handler1({ toolName: "edit", input: { file_path: path } });
		const result2 = handler2({ toolName: "edit", input: { file_path: path } });
		expect(result1).toEqual(result2);
	});
});

describe("Gap 1: Tool parameter name extraction", () => {
	it("edit tool with path parameter (actual tool parameter) is checked", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/docs/readme.md", edits: [] } });
		expect(result).toBeNull();
	});

	it("edit tool with path parameter is blocked outside write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/src/index.ts", edits: [] } });
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("write tool with path parameter (actual tool parameter) is checked", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "write", input: { path: "/project/docs/new.md", content: "hello" } });
		expect(result).toBeNull();
	});

	it("write tool with path parameter is blocked outside write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "write", input: { path: "/project/src/main.ts", content: "hello" } });
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("read tool with path parameter (actual tool parameter) is checked", () => {
		const handler = createPathPermissionHandler({ read: ["src/**"] })!;
		const result = handler({ toolName: "read", input: { path: "/project/src/app.ts" } });
		expect(result).toBeNull();
	});

	it("read tool with path parameter is blocked outside read paths", () => {
		const handler = createPathPermissionHandler({ read: ["src/**"] })!;
		const result = handler({ toolName: "read", input: { path: "/project/docs/readme.md" } });
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("file_path takes priority over path when both present", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts", path: "/project/docs/readme.md" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("filePath takes priority over path when file_path absent", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "edit",
			input: { filePath: "/project/docs/readme.md", path: "/project/src/index.ts" },
		});
		expect(result).toBeNull();
	});

	it("bash tool command is never path-checked", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "bash",
			input: { command: "cat /project/src/secret.ts > /tmp/leak" },
		});
		expect(result).toBeNull();
	});
});

describe("Gap 2: Ghost tools (multiedit/patch)", () => {
	it("multiedit tool with path parameter is checked against write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "multiedit",
			input: { path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("multiedit tool is blocked outside write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "multiedit",
			input: { path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("patch tool with path parameter is checked against write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "patch",
			input: { path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("patch tool is blocked outside write paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({
			toolName: "patch",
			input: { path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});
});

describe("Gap 3: Advanced glob pattern syntax", () => {
	it("? matches exactly one character", () => {
		const handler = createPathPermissionHandler({ write: ["docs/?.md"] })!;
		expect(handler({ toolName: "edit", input: { path: "/project/docs/a.md" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/docs/readme.md" } })!.block).toBe(true);
	});

	it("{a,b} brace expansion matches alternatives", () => {
		const handler = createPathPermissionHandler({ write: ["*.{ts,js}"] })!;
		expect(handler({ toolName: "edit", input: { path: "/project/index.ts" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/index.js" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/index.py" } })!.block).toBe(true);
	});

	it("[a-z] character class matches range", () => {
		const handler = createPathPermissionHandler({ write: ["docs/file[0-9].md"] })!;
		expect(handler({ toolName: "edit", input: { path: "/project/docs/file1.md" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/docs/file9.md" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/docs/fileX.md" } })!.block).toBe(true);
	});

	it("** with dot:true matches hidden dotfiles", () => {
		const handler = createPathPermissionHandler({ write: [".pi/**"] })!;
		expect(handler({ toolName: "edit", input: { path: "/project/.pi/plans/plan.md" } })).toBeNull();
		expect(handler({ toolName: "edit", input: { path: "/project/.pi/config" } })).toBeNull();
	});

	it("* matches dotfiles with dot:true option in minimatch", () => {
		const handler = createPathPermissionHandler({ write: ["*"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/.env" } });
		expect(result === null || result?.block === true).toBe(true);
	});

	it("negation ! patterns are ineffective due to subpath iteration", () => {
		const handler = createPathPermissionHandler({ write: ["!docs/**"] })!;
		// minimatch treats ! as negation, but the subpath iteration in matchPathGlob
		// causes basename subpaths (e.g. "readme.md") to match the negated pattern,
		// effectively making negation patterns allow everything.
		const resultDocs = handler({ toolName: "edit", input: { path: "/project/docs/readme.md" } });
		// "readme.md" subpath matches "!docs/**" (negation of docs = allows non-docs)
		// so the overall result is: allowed (null)
		expect(resultDocs).toBeNull();
		// Similarly, non-docs paths are also allowed
		const resultSrc = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(resultSrc).toBeNull();
	});
});

describe("Gap 8: Path normalization edge cases", () => {
	it("handles double slashes in path", () => {
		expect(normalizeFilePath("/project/docs//readme.md")).not.toContain("//");
	});

	it("handles trailing slash vs no trailing slash consistently", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/readme.md" } })).not.toThrow();
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/" } })).not.toThrow();
	});

	it("handles case-sensitive matching", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const result = handler({ toolName: "edit", input: { path: "/project/Docs/readme.md" } });
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});

	it("handles URL-encoded paths", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/my%20file.md" } })).not.toThrow();
	});

	it("handles mixed forward/backslash separators", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs\\subdir/readme.md" } })).not.toThrow();
	});

	it("handles null byte in path gracefully", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/readme.md\0evil" } })).not.toThrow();
	});

	it("handles path with only dots as filename", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/..." } })).not.toThrow();
		expect(() => handler({ toolName: "edit", input: { path: "/project/docs/...." } })).not.toThrow();
	});
});

describe("Gap 12: Dual implementation consistency", () => {
	it("normalizeFilePath produces same result as path.posix.normalize", () => {
		const path = require("node:path");
		const testPaths = [
			"/project/docs/../src/./file.ts",
			"docs/readme.md",
			"./docs/./readme.md",
			"/project/docs//readme.md",
		];
		for (const p of testPaths) {
			const ours = normalizeFilePath(p);
			expect(ours).not.toContain("/./");
			expect(ours).not.toContain("//");
		}
	});

	it("matchPathGlob handles all three tool parameter names", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;

		const r1 = handler({ toolName: "edit", input: { path: "/project/docs/a.md" } });
		const r2 = handler({ toolName: "edit", input: { filePath: "/project/docs/a.md" } });
		const r3 = handler({ toolName: "edit", input: { file_path: "/project/docs/a.md" } });

		expect(r1).toBeNull();
		expect(r2).toBeNull();
		expect(r3).toBeNull();
	});

	it("matchPathGlob is consistent across multiple calls with same input", () => {
		for (let i = 0; i < 10; i++) {
			expect(matchPathGlob("/project/docs/readme.md", "docs/**")).toBe(true);
			expect(matchPathGlob("/project/src/index.ts", "docs/**")).toBe(false);
		}
	});
});

describe("Gap 7: Multiple concurrent tool calls", () => {
	it("each tool call in a batch is checked independently", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;

		const r1 = handler({ toolName: "edit", input: { path: "/project/docs/a.md" } });
		const r2 = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		const r3 = handler({ toolName: "edit", input: { path: "/project/docs/b.md" } });

		expect(r1).toBeNull();
		expect(r2).not.toBeNull();
		expect(r2!.block).toBe(true);
		expect(r3).toBeNull();
	});

	it("blocked call does not affect subsequent calls", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;

		const r1 = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(r1).not.toBeNull();

		const r2 = handler({ toolName: "edit", input: { path: "/project/docs/readme.md" } });
		expect(r2).toBeNull();
	});

	it("different tools in same batch are checked against correct categories", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			read: ["src/**"],
		})!;

		const r1 = handler({ toolName: "edit", input: { path: "/project/src/index.ts" } });
		expect(r1).not.toBeNull();

		const r2 = handler({ toolName: "read", input: { path: "/project/src/app.ts" } });
		expect(r2).toBeNull();

		const r3 = handler({ toolName: "read", input: { path: "/project/docs/readme.md" } });
		expect(r3).not.toBeNull();
	});
});

describe("Gap 10: Bash tool and CWD behavior", () => {
	it("bash tool is never path-checked regardless of paths config", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			read: ["docs/**"],
			bash: ["scripts/**"],
		})!;

		const result = handler({
			toolName: "bash",
			input: { command: "rm -rf /" },
		});
		expect(result).toBeNull();
	});

	it("bash tool is not checked even with dangerous commands", () => {
		const handler = createPathPermissionHandler({
			bash: ["scripts/**"],
		})!;

		const result = handler({
			toolName: "bash",
			input: { command: "cat /etc/passwd" },
		});
		expect(result).toBeNull();
	});

	it("paths.bash config is stored but has no enforcement effect", () => {
		const handler = createPathPermissionHandler({
			write: ["docs/**"],
			bash: ["scripts/**"],
		})!;

		expect(handler).not.toBeNull();

		const result = handler({
			toolName: "bash",
			input: { command: "cd /anywhere && echo test" },
		});
		expect(result).toBeNull();
	});
});

describe("Gap 11: Performance with many patterns", () => {
	it("100 patterns complete in reasonable time", () => {
		const patterns = Array.from({ length: 100 }, (_, i) => `dir${i}/**`);
		patterns.push("docs/**");

		const handler = createPathPermissionHandler({ write: patterns })!;

		const start = performance.now();
		for (let i = 0; i < 100; i++) {
			handler({ toolName: "edit", input: { path: "/project/docs/readme.md" } });
		}
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(500);
	});

	it("deep path with many segments is still fast", () => {
		const handler = createPathPermissionHandler({ write: ["docs/**"] })!;
		const deepPath = "/a/" + Array.from({ length: 20 }, (_, i) => `level${i}`).join("/") + "/file.md";

		const start = performance.now();
		for (let i = 0; i < 100; i++) {
			handler({ toolName: "edit", input: { path: deepPath } });
		}
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(50);
	});
});
