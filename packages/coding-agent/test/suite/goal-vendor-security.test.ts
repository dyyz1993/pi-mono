import { describe, expect, it } from "vitest";
import { classifyToolCall } from "../../extensions/goal-vendor/security.ts";
import type { GoalState } from "../../extensions/goal-vendor/types.ts";

function interruptedState(): GoalState {
	// Partial fixture: only the fields classifyToolCall reads.
	return {
		goalId: "goal-1",
		cwd: "/tmp/project",
		workspaceRoots: ["/tmp/project"],
		status: "interrupted",
		phase: "blocked",
		continuationSequence: 1,
		generation: 1,
		turnCount: 1,
		objective: "test",
		outcome: { current: "test", amendments: [] },
		criteria: [],
		plan: [],
		verificationChecks: [],
		authorities: [],
		constraints: [],
		nonGoals: [],
		evidence: [],
		recoveryEvidence: [],
		interrupt: {
			class: "RISK",
			message: "approval pending",
			attempts: [],
			need: "approval",
			recommendation: "review",
			signature: "sig",
			createdAt: new Date().toISOString(),
			pendingAuthorityAmendment: {
				rationale: "test",
				requestedAt: new Date().toISOString(),
				authorities: [],
				resumePhase: "executing",
				resumeCurrentAction: "test",
				resumeNextAction: "test",
			},
		},
		deferredRisk: undefined,
		activeToolCalls: {},
		repeatedToolCalls: {},
		repeatedBlockers: {},
	} as unknown as GoalState;
}

describe("goal-vendor authority interruption recovery", () => {
	it("keeps read and user-question tools available while exact authority approval is pending", () => {
		const state = interruptedState();
		expect(classifyToolCall(state, "read", { path: "/tmp/project/README.md" }).allow).toBe(true);
		expect(classifyToolCall(state, "ask-user-question", { question: "Need clarification" }).allow).toBe(true);
	});

	it("does not turn the pending amendment into a blanket process bypass", () => {
		const decision = classifyToolCall(interruptedState(), "bash", { command: "node scripts/preview-server.mjs" });
		expect(decision.allow).toBe(false);
		expect(decision.actionClass).toBe("local_process");
	});
});
