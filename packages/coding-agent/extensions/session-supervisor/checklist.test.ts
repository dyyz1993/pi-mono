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

    // Regression: ef10ddea case — 6-item checklist, supervisor burned 5/5
    // quota one item at a time even though model check said "all 6 done"
    // with confidence 0.95. The completeAll flag lets a single passing
    // model check finalize every remaining item at once.
    it("completeAll=true batch-advances ALL remaining items at once (regression for ef10ddea)", () => {
        const goal = makeGoal("checking", [
            { id: "s1", text: "Step 1", kind: "scope", status: "done" },
            { id: "s2", text: "Step 2", kind: "implementation", status: "in_progress" },
            { id: "s3", text: "Step 3", kind: "implementation", status: "pending" },
            { id: "s4", text: "Step 4", kind: "implementation", status: "pending" },
            { id: "s5", text: "Step 5", kind: "verification", status: "pending" },
            { id: "s6", text: "Step 6", kind: "report", status: "pending" },
        ]);

        const result = advanceChecklistAfterPassedCheck(goal, "model check passed with confidence 0.95 — all 6 items done", {
            completeAll: true,
        });

        expect(result.hasRemaining).toBe(false);
        expect(result.nextItem).toBeUndefined();
        expect(result.goal.checklist?.map((item) => item.status)).toEqual([
            "done", "done", "done", "done", "done", "done",
        ]);
        // Items that were newly advanced (s2..s6) should carry the evidence
        // string, now prefixed with per-item text for audit distinguishability.
        // The already-done s1 keeps its original (undefined) evidence.
        expect(result.goal.checklist?.[0]?.evidence).toBeUndefined();
        const baseEvidence = "model check passed with confidence 0.95 — all 6 items done";
        const items = result.goal.checklist ?? [];
        for (let i = 1; i < 6; i++) {
            const expected = `[${items[i].text}] ${baseEvidence}`;
            expect(items[i].evidence).toBe(expected);
            // Each item's evidence should be unique (contains its own text)
        }
        // Verify uniqueness: all 5 newly-done items should have distinct evidence
        const evidences = items.slice(1).map((i: { evidence?: string }) => i.evidence);
        expect(new Set(evidences).size).toBe(5);
    });

    it("completeAll=true leaves blocked items alone (doesn't force them done)", () => {
        const goal = makeGoal("checking", [
            { id: "s1", text: "Step 1", kind: "scope", status: "done" },
            { id: "s2", text: "Step 2 (blocked)", kind: "implementation", status: "blocked" },
            { id: "s3", text: "Step 3", kind: "verification", status: "in_progress" },
        ]);

        const result = advanceChecklistAfterPassedCheck(goal, "evidence", { completeAll: true });

        // blocked should stay blocked (not force-completed)
        expect(result.goal.checklist?.[1]?.status).toBe("blocked");
        // in_progress should be done
        expect(result.goal.checklist?.[2]?.status).toBe("done");
    });
});
