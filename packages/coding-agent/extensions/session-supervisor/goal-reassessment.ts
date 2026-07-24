import type {
	GoalChecklistItem,
	GoalProgressResult,
	GoalState,
} from "./types.ts";

export type ReassessmentDecisionKind = "complete" | "idle" | "continue";

export interface ReassessmentDecision {
	goal: GoalState;
	checklistChanged: boolean;
	previousActionPlans: string[];
	decision: ReassessmentDecisionKind;
	continueMessage?: string;
	isRepetitive: boolean;
}

export function shouldSendTerminalAbort(goal: GoalState | undefined, terminalAbortSent: boolean): boolean {
	if (!goal) return false;
	return ["complete", "cancelled", "blocked"].includes(goal.status) && !terminalAbortSent;
}

export function calculateTextSimilarity(a: string, b: string): number {
	const tokenize = (s: string) => s.split(/\s+|[,;.!?\n]/).filter((t) => t.length > 2);
	const setA = new Set(tokenize(a));
	const setB = new Set(tokenize(b));
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const token of setA) {
		if (setB.has(token)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return intersection / union;
}

export function applyGoalProgressReassessment(options: {
	goal: GoalState;
	reassessment: GoalProgressResult;
	previousActionPlans: string[];
	minContinueConfidence: number;
}): ReassessmentDecision {
	const { goal, reassessment, previousActionPlans, minContinueConfidence } = options;
	let nextGoal = goal;
	let checklistChanged = false;

	if (goal.checklist && (reassessment.checklistUpdates.length > 0 || reassessment.newChecklistItems.length > 0)) {
		const updatedChecklist: GoalChecklistItem[] = [...goal.checklist];
		for (const update of reassessment.checklistUpdates) {
			if (update.index < 0 || update.index >= updatedChecklist.length) continue;
			const item = { ...updatedChecklist[update.index] };
			item.status = update.status;
			if (update.text) item.text = update.text;
			if (update.evidence) item.evidence = update.evidence;
			updatedChecklist[update.index] = item;
			checklistChanged = true;
		}
		reassessment.newChecklistItems.forEach((newItem, index) => {
			updatedChecklist.push({
				id: `reassessment-${updatedChecklist.length + index + 1}`,
				kind: newItem.kind ?? "implementation",
				text: newItem.text,
				status: "pending",
			});
			checklistChanged = true;
		});
		nextGoal = {
			...goal,
			checklist: updatedChecklist,
			updatedAt: Date.now(),
		};
	}

	const nextActionPlans = reassessment.nextActionPlan
		? [...previousActionPlans, reassessment.nextActionPlan].slice(-5)
		: previousActionPlans;

	if (reassessment.isComplete && reassessment.confidence >= 0.85) {
		return {
			goal: nextGoal,
			checklistChanged,
			previousActionPlans: nextActionPlans,
			decision: "complete",
			isRepetitive: false,
		};
	}

	if (reassessment.confidence < minContinueConfidence) {
		return {
			goal: nextGoal,
			checklistChanged,
			previousActionPlans: nextActionPlans,
			decision: "idle",
			isRepetitive: false,
		};
	}

	const continueMessage = `[Supervisor/GoalReassessment] ${reassessment.nextActionPlan}`;
	const planLower = reassessment.nextActionPlan.toLowerCase();
	const isRepetitive = previousActionPlans.some((prev) => {
		const sim = calculateTextSimilarity(planLower, prev.toLowerCase());
		return sim > 0.7;
	});
	const finalContinueMessage = isRepetitive
		? `${continueMessage}\n\nPrevious similar attempts did not make sufficient progress. Try a DIFFERENT approach: reconsider the architecture, look at the problem from a new angle, or break down the task differently.`
		: continueMessage;

	return {
		goal: nextGoal,
		checklistChanged,
		previousActionPlans: nextActionPlans,
		decision: "continue",
		continueMessage: finalContinueMessage,
		isRepetitive,
	};
}
