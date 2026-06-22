import { describe, expect, it } from "vitest";
import {
	createStoredDecisionProvider,
	defaultStoredDecisionCandidates,
	type PermissionContext,
	type PermissionRuleDecision,
	type PermissionRuleMatchInput,
	PermissionRuntime,
} from "../src/core/permissions/index.ts";

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
	return {
		sessionId: "session-1",
		cwd: "/project",
		permissionProfile: "normal",
		toolName: "bash",
		toolCallId: "toolu-1",
		input: { command: "npm install lodash" },
		...overrides,
	};
}

function makeDecision(action: "allow" | "deny", id = `perm_${action}`): PermissionRuleDecision {
	return {
		action,
		rule: {
			id,
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm install *",
			action,
			scope: "project",
			createdAt: "2026-06-21T00:00:00.000Z",
		},
	};
}

describe("stored-decision provider", () => {
	it("passes when no stored decision matches", async () => {
		const seen: PermissionRuleMatchInput[] = [];
		const provider = createStoredDecisionProvider({
			store: {
				findDecision(input) {
					seen.push(input);
					return undefined;
				},
			},
		});

		expect(await provider.check(makeContext())).toEqual({ type: "pass" });
		expect(seen).toEqual([
			{
				provider: "dangerous-command",
				subject: "command.run",
				value: "npm install lodash",
				scope: "project",
			},
		]);
	});

	it("returns allow when a stored allow rule matches", async () => {
		const provider = createStoredDecisionProvider({
			store: { findDecision: () => makeDecision("allow", "perm_allow_npm") },
		});

		expect(await provider.check(makeContext())).toEqual({
			type: "allow",
			reason: "Allowed by stored permission rule perm_allow_npm",
		});
	});

	it("returns deny when a stored deny rule matches", async () => {
		const provider = createStoredDecisionProvider({
			store: { findDecision: () => makeDecision("deny", "perm_deny_npm") },
		});

		expect(await provider.check(makeContext())).toEqual({
			type: "deny",
			reason: "Denied by stored permission rule perm_deny_npm",
		});
	});

	it("stops the runtime pipeline on stored decisions", async () => {
		const runtime = new PermissionRuntime({
			providers: [
				createStoredDecisionProvider({
					store: { findDecision: () => makeDecision("allow", "perm_allow") },
				}),
				{ name: "after", check: () => ({ type: "deny", reason: "should not run" }) },
			],
		});

		await expect(runtime.evaluate(makeContext())).resolves.toEqual({
			type: "allow",
			reason: "Allowed by stored permission rule perm_allow",
		});
	});

	it("derives path-access file candidates from read and write tools", () => {
		expect(
			defaultStoredDecisionCandidates(makeContext({ toolName: "write", input: { path: "src/app.ts" } })),
		).toEqual([
			{
				provider: "path-access",
				subject: "file.write",
				value: "src/app.ts",
				scope: "project",
			},
		]);
		expect(
			defaultStoredDecisionCandidates(makeContext({ toolName: "read", input: { file_path: "src/app.ts" } })),
		).toEqual([
			{
				provider: "path-access",
				subject: "file.read",
				value: "src/app.ts",
				scope: "project",
			},
		]);
	});

	it("adds a normalized command candidate when bash command whitespace differs", () => {
		expect(
			defaultStoredDecisionCandidates(
				makeContext({
					input: { command: "git   commit   --no-verify   -m x" },
				}),
			),
		).toEqual([
			{
				provider: "dangerous-command",
				subject: "command.run",
				value: "git   commit   --no-verify   -m x",
				scope: "project",
			},
			{
				provider: "dangerous-command",
				subject: "command.run",
				value: "git commit --no-verify -m x",
				scope: "project",
			},
		]);
	});

	it("allows custom candidate resolution for extension providers", async () => {
		const seen: PermissionRuleMatchInput[] = [];
		const provider = createStoredDecisionProvider({
			resolveCandidates: () => [
				{
					provider: "custom-provider",
					subject: "custom.subject",
					value: "custom-value",
					scope: "project",
				},
			],
			store: {
				findDecision(input) {
					seen.push(input);
					return undefined;
				},
			},
		});

		await provider.check(makeContext());

		expect(seen).toEqual([
			{
				provider: "custom-provider",
				subject: "custom.subject",
				value: "custom-value",
				scope: "project",
			},
		]);
	});
});
