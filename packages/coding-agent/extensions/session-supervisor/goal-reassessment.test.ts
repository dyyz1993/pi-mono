import { describe, expect, it } from "vitest";
import {
	applyGoalProgressReassessment,
	shouldSendTerminalAbort,
} from "./goal-reassessment.ts";
import type { GoalProgressResult, GoalState } from "./types.ts";

function makeGoal(status: GoalState["status"] = "running"): GoalState {
	return {
		id: "goal-test",
		objective: "ship the feature",
		status,
		startedAt: 1,
		updatedAt: 1,
		continuationCount: 0,
		blockers: [],
		checklist: [
			{ id: "scope", text: "Confirm scope", kind: "scope", status: "in_progress" },
			{ id: "impl", text: "Implement feature", kind: "implementation", status: "pending" },
		],
	};
}

function makeReassessment(patch: Partial<GoalProgressResult> = {}): GoalProgressResult {
	return {
		overallProgress: 50,
		completedItems: [],
		remainingItems: ["Run tests"],
		newDiscoveries: [],
		checklistUpdates: [],
		newChecklistItems: [],
		nextActionPlan: "Run the focused tests and inspect failures.",
		isComplete: false,
		confidence: 0.8,
		reasoning: "Implementation exists but verification remains.",
		...patch,
	};
}

describe("goal reassessment decision helpers", () => {
	it("applies dynamic checklist updates and appends new checklist items", () => {
		const result = applyGoalProgressReassessment({
			goal: makeGoal(),
			reassessment: makeReassessment({
				checklistUpdates: [{ index: 0, status: "done", evidence: "Scope confirmed" }],
				newChecklistItems: [{ text: "Add regression coverage", kind: "verification" }],
			}),
			previousActionPlans: [],
			minContinueConfidence: 0.6,
		});

		expect(result.checklistChanged).toBe(true);
		expect(result.goal.checklist?.map((item) => item.status)).toEqual(["done", "pending", "pending"]);
		expect(result.goal.checklist?.[0]?.evidence).toBe("Scope confirmed");
		expect(result.goal.checklist?.[2]).toMatchObject({
			id: "reassessment-3",
			kind: "verification",
			text: "Add regression coverage",
		});
	});

	it("returns complete for high-confidence complete reassessments", () => {
		const result = applyGoalProgressReassessment({
			goal: makeGoal(),
			reassessment: makeReassessment({
				isComplete: true,
				confidence: 0.9,
				completedItems: ["Tests passed"],
				remainingItems: [],
			}),
			previousActionPlans: [],
			minContinueConfidence: 0.6,
		});

		expect(result.decision).toBe("complete");
		expect(result.continueMessage).toBeUndefined();
	});

	it("returns idle for low-confidence incomplete reassessments", () => {
		const result = applyGoalProgressReassessment({
			goal: makeGoal(),
			reassessment: makeReassessment({ confidence: 0.3 }),
			previousActionPlans: [],
			minContinueConfidence: 0.6,
		});

		expect(result.decision).toBe("idle");
		expect(result.continueMessage).toBeUndefined();
	});

	it("continues with a strategy-change directive when action plans repeat", () => {
		const repeatedPlan = "Run the focused tests and inspect failures.";
		const result = applyGoalProgressReassessment({
			goal: makeGoal(),
			reassessment: makeReassessment({ nextActionPlan: repeatedPlan }),
			previousActionPlans: [repeatedPlan],
			minContinueConfidence: 0.6,
		});

		expect(result.decision).toBe("continue");
		expect(result.isRepetitive).toBe(true);
		expect(result.continueMessage).toContain("DIFFERENT approach");
		expect(result.previousActionPlans).toEqual([repeatedPlan, repeatedPlan]);
	});

	it("gates terminal abort so each terminal goal aborts once", () => {
		expect(shouldSendTerminalAbort(makeGoal("complete"), false)).toBe(true);
		expect(shouldSendTerminalAbort(makeGoal("blocked"), false)).toBe(true);
		expect(shouldSendTerminalAbort(makeGoal("cancelled"), false)).toBe(true);
		expect(shouldSendTerminalAbort(makeGoal("complete"), true)).toBe(false);
		expect(shouldSendTerminalAbort(makeGoal("running"), false)).toBe(false);
	});
});
