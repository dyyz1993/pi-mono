import { describe, expect, it } from "vitest";
import type { GoalState } from "./types.ts";
import { advanceChecklistAfterPassedCheck, applyChecklistProgress } from "./checklist.ts";

function makeGoal(status: GoalState["status"], checklist: GoalState["checklist"]): GoalState {
    return {
        id: "goal-test",
        objective: "finish the goal",
        status,
        startedAt: 1,
        updatedAt: 1,
        continuationCount: 0,
        blockers: [],
        checklist,
    };
}

describe("session-supervisor checklist progress", () => {
    it("does not mark every checklist item done just because the goal status is complete", () => {
        const goal = makeGoal("complete", [
            { id: "scope", text: "Confirm scope", kind: "scope", status: "done" },
            { id: "impl", text: "Implement the fix", kind: "implementation", status: "in_progress" },
            { id: "verify", text: "Run verification", kind: "verification", status: "pending" },
            { id: "report", text: "Report evidence", kind: "report", status: "pending" },
        ]);

        const next = applyChecklistProgress(goal);

        expect(next.checklist?.map((item) => item.status)).toEqual([
            "done",
            "done",
            "in_progress",
            "pending",
        ]);
        expect(next.currentMilestone).toBe("Run verification");
    });

    it("advances only one checklist item per passed check and exposes the next milestone", () => {
        const goal = makeGoal("checking", [
            { id: "scope", text: "Confirm scope", kind: "scope", status: "done" },
            { id: "impl", text: "Implement the fix", kind: "implementation", status: "in_progress" },
            { id: "verify", text: "Run verification", kind: "verification", status: "pending" },
        ]);

        const result = advanceChecklistAfterPassedCheck(goal, "guards and model passed");

        expect(result.hasRemaining).toBe(true);
        expect(result.completedItem?.id).toBe("impl");
        expect(result.nextItem?.id).toBe("verify");
        expect(result.goal.status).toBe("running");
        expect(result.goal.currentMilestone).toBe("Run verification");
        expect(result.goal.checklist?.map((item) => item.status)).toEqual([
            "done",
            "done",
            "in_progress",
        ]);
        expect(result.goal.checklist?.[1]?.evidence).toBe("guards and model passed");
    });

    it("reports no remaining work after the final checklist item passes", () => {
        const goal = makeGoal("checking", [
            { id: "scope", text: "Confirm scope", kind: "scope", status: "done" },
            { id: "report", text: "Report evidence", kind: "report", status: "in_progress" },
        ]);

        const result = advanceChecklistAfterPassedCheck(goal);

        expect(result.hasRemaining).toBe(false);
        expect(result.nextItem).toBeUndefined();
        expect(result.goal.currentMilestone).toBeUndefined();
        expect(result.goal.checklist?.map((item) => item.status)).toEqual([
            "done",
            "done",
        ]);
    });
});
