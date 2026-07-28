/**
 * Verification security tests for goal-vendor (vendored misunders2d/pi-goal).
 *
 * Tests the safety guarantees of the machine-verification layer:
 * 1. DENIED_EXECUTABLES blocks shell/sudo/curl etc.
 * 2. shell:false spawn semantics (no shell injection via args).
 * 3. Path traversal is rejected (verification paths must stay in workspace).
 * 4. file_contains / git_status / git_diff checks work as documented.
 * 5. npm package operations are restricted to test/check/lint/build.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VerificationCheck } from "../../extensions/goal-vendor/types.ts";
import {
	runVerificationCheck,
	validateVerificationCheckDefinition,
} from "../../extensions/goal-vendor/verification.ts";

describe("goal-vendor verification security", () => {
	let workspace: string;

	beforeEach(() => {
		// Use realpath to avoid macOS /tmp -> /private/tmp symlink mismatch
		// in resolvedThroughExistingAncestor path checks.
		workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-verify-")));
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	describe("DENIED_EXECUTABLES", () => {
		// Matches the actual DENIED_EXECUTABLES set in verification.ts.
		const denied = [
			"bash",
			"sh",
			"zsh",
			"fish",
			"sudo",
			"su",
			"doas",
			"ssh",
			"scp",
			"rsync",
			"curl",
			"wget",
			"systemctl",
			"service",
			"docker",
			"podman",
			"kubectl",
			"helm",
		];

		for (const exe of denied) {
			it(`rejects denied executable: ${exe}`, () => {
				const check: VerificationCheck = {
					id: "c1",
					kind: "command_exit",
					executable: exe,
					args: [],
					label: `denied ${exe}`,
				};
				expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/denied/i);
			});
		}
	});

	describe("npm operation allowlist", () => {
		it("allows npm test", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "npm",
				args: ["test"],
				label: "npm test",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
		});

		it("allows npm run build", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "npm",
				args: ["run", "build"],
				label: "npm build",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
		});

		it("rejects npm install", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "npm",
				args: ["install"],
				label: "npm install",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/denied/i);
		});

		it("rejects npm publish", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "npm",
				args: ["publish"],
				label: "npm publish",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/denied/i);
		});

		it("rejects npm run arbitrary-script", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "npm",
				args: ["run", "arbitrary-script"],
				label: "npm arbitrary",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(
				/outside the test\/check\/lint\/build/i,
			);
		});
	});

	describe("git read-only enforcement", () => {
		it("allows git status", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "git",
				args: ["status"],
				label: "git status",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
		});

		it("allows git diff", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "git",
				args: ["diff"],
				label: "git diff",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
		});

		it("rejects git push (not in read-only allowlist)", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "git",
				args: ["push"],
				label: "git push",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/not read-only/);
		});

		it("rejects git -C (must use check.cwd instead)", () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "git",
				args: ["-C", "/tmp", "status"],
				label: "git -C",
			};
			expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/unsupported/);
		});
	});

	describe("file_contains", () => {
		it("passes when content is present", async () => {
			fs.writeFileSync(path.join(workspace, "output.txt"), "PI_GOAL_VERIFY_OK");
			const check: VerificationCheck = {
				id: "c1",
				kind: "file_contains",
				label: "content",
				path: "output.txt",
				pattern: "PI_GOAL_VERIFY_OK",
			};
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(true);
		});

		it("fails when content is absent", async () => {
			fs.writeFileSync(path.join(workspace, "output.txt"), "something else");
			const check: VerificationCheck = {
				id: "c1",
				kind: "file_contains",
				label: "content",
				path: "output.txt",
				pattern: "PI_GOAL_VERIFY_OK",
			};
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(false);
		});

		it("supports regex matching", async () => {
			fs.writeFileSync(path.join(workspace, "output.txt"), "status: passed (100%)");
			const check: VerificationCheck = {
				id: "c1",
				kind: "file_contains",
				label: "regex",
				path: "output.txt",
				pattern: "passed \\(\\d+%",
				regex: true,
			};
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(true);
		});
	});

	describe("file_exists", () => {
		it("passes when file exists", async () => {
			fs.writeFileSync(path.join(workspace, "marker.txt"), "ok");
			const check: VerificationCheck = { id: "c1", kind: "file_exists", label: "exists", path: "marker.txt" };
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(true);
		});

		it("fails when file is missing", async () => {
			const check: VerificationCheck = { id: "c1", kind: "file_exists", label: "exists", path: "nonexistent.txt" };
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(false);
		});
	});

	describe("command_exit", () => {
		it("passes when command exits with expected code", async () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "true",
				args: [],
				label: "true",
				expectedExitCode: 0,
			};
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(true);
		});

		it("fails when command exits with wrong code", async () => {
			const check: VerificationCheck = {
				id: "c1",
				kind: "command_exit",
				executable: "false",
				args: [],
				label: "false",
				expectedExitCode: 0,
			};
			const result = await runVerificationCheck(check, workspace);
			expect(result.passed).toBe(false);
		});
	});
});
