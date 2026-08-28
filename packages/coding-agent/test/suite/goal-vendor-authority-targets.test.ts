import { describe, expect, it } from "vitest";
import {
	validateCommandAuthorityDefinition,
	validateDraftCommandAuthorities,
} from "../../extensions/goal-vendor/authority.ts";
import { normalizeDraft } from "../../extensions/goal-vendor/evaluator.ts";
import {
	createGoalState,
	normalizeDraftAuthorityTargets,
	normalizeWorkspaceRoots,
} from "../../extensions/goal-vendor/state.ts";

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
		expect(state.authorities[0]!.targets).toEqual([{ path: "cwd", equals: state.workspaceRoots[0] }]);
		const errors = state.authorities.flatMap((a) =>
			validateCommandAuthorityDefinition(a, state.cwd, state.workspaceRoots),
		);
		expect(errors).toEqual([]);
	});

	it("validator still rejects the raw absolute-path form before normalization", () => {
		const draft = normalizeDraft(
			{
				outcome: "build a hello page",
				criteria: ["index.html exists"],
				phases: [{ id: "P1", title: "build", criterionIds: ["AC1"] }],
				verificationChecks: [{ id: "V1", kind: "command_exit", label: "check", command: "node check.mjs" }],
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
			},
			"test",
			"/tmp/goal-targets-test",
		);
		draft.workspaceRoots = normalizeWorkspaceRoots("/tmp/goal-targets-test", draft.workspaceRoots);
		expect(
			validateDraftCommandAuthorities(draft, "/tmp/goal-targets-test", draft.workspaceRoots).length,
		).toBeGreaterThan(0);
	});

	it("passes validateDraftCommandAuthorities after pre-validation normalization (real submit order)", () => {
		// Mirrors the exact sequence in the pi_goal_submit_contract tool handler:
		// normalizeDraft → normalizeWorkspaceRoots → normalizeAuthorityToolNames →
		// normalizeDraftAuthorityTargets → validateDraftCommandAuthorities, with no
		// createGoalState in between. Normalizing only inside createGoalState (the
		// original fix placement) leaves the validator rejecting the raw form first.
		const draft = normalizeDraft(
			{
				outcome: "build a hello page",
				criteria: ["index.html exists"],
				phases: [{ id: "P1", title: "build", criterionIds: ["AC1"] }],
				verificationChecks: [{ id: "V1", kind: "command_exit", label: "check", command: "node check.mjs" }],
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
			},
			"test",
			"/tmp/goal-targets-test",
		);
		draft.workspaceRoots = normalizeWorkspaceRoots("/tmp/goal-targets-test", draft.workspaceRoots);
		normalizeDraftAuthorityTargets(draft);
		expect(validateDraftCommandAuthorities(draft, "/tmp/goal-targets-test", draft.workspaceRoots)).toEqual([]);
	});
});
