import { describe, expect, it } from "vitest";
import { createGoalState } from "../../extensions/goal-vendor/state.ts";
import { validateCommandAuthorityDefinition } from "../../extensions/goal-vendor/authority.ts";

/**
 * Models frequently submit bash authorities with absolute-path targets
 * ({path: "/workspace", equals: "/workspace"}) instead of the canonical
 * {path: "cwd", equals: "<workspace root>"}. normalizeAuthority must rewrite
 * the absolute form (including symlinked spellings) so command-authority
 * validation accepts it instead of failing every contract submission.
 */
describe("goal authority target normalization", () => {
	it("rewrites absolute-path targets equal to the workspace root as cwd targets", () => {
		const draft = {
			outcome: "build a hello page",
			criteria: ["index.html exists"],
			phases: [{ id: "P1", title: "build", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "V1", kind: "bash" as const, label: "check", command: "node check.mjs" }],
			authorities: [
				{
					id: "A_NODE_CHECK",
					label: "node check",
					toolName: "bash",
					actionClass: "local_process",
					targets: [{ equals: "/tmp/goal-targets-test", path: "/tmp/goal-targets-test" }],
					command: { executable: "node", argsPrefix: ["check.mjs"], trailingArgs: "none" },
					maxUses: 10,
				},
			],
			workspaceRoots: [],
			constraints: [],
			nonGoals: [],
		};
		const ctx = {
			cwd: "/tmp/goal-targets-test",
			sessionManager: { getSessionId: () => "sess-targets-test" },
		};
		const state = createGoalState(draft as never, ctx as never, "test");
		expect(state.authorities[0]!.targets).toEqual([
			{ path: "cwd", equals: state.workspaceRoots[0] },
		]);
		const errors = state.authorities
			.map((a) => validateCommandAuthorityDefinition(a, state.cwd, state.workspaceRoots))
			.flat();
		expect(errors).toEqual([]);
	});
});
