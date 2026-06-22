import { describe, expect, it } from "vitest";
import {
	createDangerousCommandPatternSuggestions,
	createDangerousCommandProvider,
	findDangerousCommandMatch,
	type PermissionContext,
} from "../src/core/permissions/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "normal",
		toolName: "bash",
		toolCallId: "toolu-1",
		input: { command: "rm -rf /tmp/data" },
		...overrides,
	};
}

describe("dangerous-command provider", () => {
	it.each([
		["recursive rm", "rm -rf /tmp/data", "recursive-rm"],
		["recursive rm short flag order", "rm -fr /tmp/data", "recursive-rm"],
		["recursive rm long flag", "rm --recursive /tmp/data", "recursive-rm"],
		["force push", "git push --force origin main", "git-push-force"],
		["skip verification", "git commit --no-verify -m x", "skip-verification"],
		["sudo", "sudo apt install foo", "sudo"],
		["chmod 777", "chmod 777 /tmp/data", "chmod-777"],
		["env file", "cat .env", "env-file"],
		["credentials", "cat credentials.json", "credentials"],
	])("detects %s", (_name, command, expectedId) => {
		expect(findDangerousCommandMatch(command)?.id).toBe(expectedId);
	});

	it("passes safe bash commands", async () => {
		const provider = createDangerousCommandProvider();

		expect(await provider.check(makeContext({ input: { command: "git status --short" } }))).toEqual({
			type: "pass",
		});
	});

	it("passes non-bash tools", async () => {
		const provider = createDangerousCommandProvider();

		expect(await provider.check(makeContext({ toolName: "read", input: { file_path: "README.md" } }))).toEqual({
			type: "pass",
		});
	});

	it("denies dangerous bash commands in normal profile by default", async () => {
		const provider = createDangerousCommandProvider();

		expect(await provider.check(makeContext({ input: { command: "rm -rf /tmp/data" } }))).toEqual({
			type: "deny",
			reason: "Blocked dangerous bash command: recursive removal can delete many files.",
		});
	});

	it("passes dangerous bash commands outside configured profiles", async () => {
		const provider = createDangerousCommandProvider();

		expect(
			await provider.check(
				makeContext({
					permissionProfile: "yolo",
					input: { command: "rm -rf /tmp/data" },
				}),
			),
		).toEqual({ type: "pass" });
	});

	it("can ask instead of deny when configured", async () => {
		const provider = createDangerousCommandProvider({
			action: "ask",
			createRequestId: () => "perm-danger-1",
			now: () => new Date("2026-06-21T00:00:00.000Z"),
		});

		const decision = await provider.check(makeContext({ input: { command: "sudo apt install foo" } }));

		expect(decision.type).toBe("ask");
		if (decision.type === "ask") {
			expect(decision.request).toMatchObject({
				requestId: "perm-danger-1",
				sessionId: "session-1",
				toolCallId: "toolu-1",
				provider: "dangerous-command",
				subject: "command.run",
				title: "Confirm command",
				actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
				metadata: {
					command: "sudo apt install foo",
					patternId: "sudo",
				},
				createdAt: "2026-06-21T00:00:00.000Z",
			});
			expect(decision.request.rememberOptions).toEqual([
				expect.objectContaining({
					id: "allow-command-exact",
					action: "allow",
					pattern: "sudo apt install foo",
				}),
				expect.objectContaining({
					id: "deny-command-exact",
					action: "deny",
					pattern: "sudo apt install foo",
				}),
			]);
		}
	});

	it("suggests reusable command patterns for lower-risk dangerous command families", async () => {
		expect(
			createDangerousCommandPatternSuggestions({
				command: "git commit --no-verify -m 'wip'",
				patternId: "skip-verification",
			}),
		).toEqual([
			expect.objectContaining({
				id: "command-exact",
				pattern: "git commit --no-verify -m 'wip'",
			}),
			expect.objectContaining({
				id: "command-family-git-commit-no-verify",
				pattern: "git commit *--no-verify*",
			}),
		]);
	});

	it("does not suggest broad reusable patterns for destructive commands", () => {
		expect(
			createDangerousCommandPatternSuggestions({
				command: "rm -rf /tmp/data",
				patternId: "recursive-rm",
			}),
		).toEqual([
			expect.objectContaining({
				id: "command-exact",
				pattern: "rm -rf /tmp/data",
			}),
		]);
	});
});
