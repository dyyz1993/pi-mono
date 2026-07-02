import type { GoalChecklistItem, GoalState } from "./types.ts";

export interface ChecklistAdvanceResult {
    goal: GoalState;
    completedItem?: GoalChecklistItem;
    nextItem?: GoalChecklistItem;
    hasRemaining: boolean;
}

function firstOpenItem(checklist: GoalChecklistItem[]): GoalChecklistItem | undefined {
    return checklist.find((item) => item.status !== "done" && item.status !== "blocked");
}

function firstOpenItemText(checklist: GoalChecklistItem[]): string | undefined {
    return firstOpenItem(checklist)?.text;
}

export function applyChecklistProgress(goal: GoalState): GoalState {
    const checklist = goal.checklist;
    if (!checklist || checklist.length === 0) return goal;
    const now = Date.now();

    if (goal.status === "complete") {
        const completedChecklist = completeCurrentChecklistItem(checklist, now).checklist;
        return {
            ...goal,
            currentMilestone: firstOpenItemText(completedChecklist),
            checklist: completedChecklist,
        };
    }

    if (goal.status === "blocked" || goal.status === "needs_user") {
        const blockedChecklist = checklist.map((item) =>
            item.status === "in_progress"
                ? { ...item, status: "blocked" as const, updatedAt: now }
                : item,
        );
        return {
            ...goal,
            currentMilestone: blockedChecklist.find((item) => item.status !== "done")?.text,
            checklist: blockedChecklist,
        };
    }

    const hasActiveItem = checklist.some((item) => item.status === "in_progress");
    if (hasActiveItem) {
        return {
            ...goal,
            currentMilestone: checklist.find((item) => item.status === "in_progress")?.text
                ?? checklist.find((item) => item.status !== "done")?.text,
        };
    }

    let promoted = false;
    const promotedChecklist = checklist.map((item) => {
        if (!promoted && item.status === "pending") {
            promoted = true;
            return { ...item, status: "in_progress" as const, updatedAt: now };
        }
        return item;
    });

    return {
        ...goal,
        currentMilestone: promotedChecklist.find((item) => item.status === "in_progress")?.text
            ?? promotedChecklist.find((item) => item.status !== "done")?.text,
        checklist: promotedChecklist,
    };
}

export function advanceChecklistAfterPassedCheck(
    goal: GoalState,
    evidence?: string,
): ChecklistAdvanceResult {
    const checklist = goal.checklist;
    if (!checklist || checklist.length === 0) {
        return { goal, hasRemaining: false };
    }

    const now = Date.now();
    const { checklist: advancedChecklist, completedItem } = completeCurrentChecklistItem(
        checklist,
        now,
        evidence,
    );
    const nextItem = firstOpenItem(advancedChecklist);

    return {
        completedItem,
        nextItem,
        hasRemaining: Boolean(nextItem),
        goal: {
            ...goal,
            status: nextItem ? "running" : goal.status,
            updatedAt: now,
            currentMilestone: nextItem?.text,
            checklist: advancedChecklist,
        },
    };
}

function completeCurrentChecklistItem(
    checklist: GoalChecklistItem[],
    now: number,
    evidence?: string,
): { checklist: GoalChecklistItem[]; completedItem?: GoalChecklistItem } {
    const activeIndex = checklist.findIndex((item) => item.status === "in_progress");
    const fallbackIndex = checklist.findIndex((item) => item.status === "pending");
    const targetIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;
    if (targetIndex < 0) {
        return { checklist };
    }

    let nextPromoted = false;
    let completedItem: GoalChecklistItem | undefined;
    const nextChecklist = checklist.map((item, index) => {
        if (index === targetIndex) {
            completedItem = {
                ...item,
                status: "done",
                evidence: evidence ?? item.evidence,
                updatedAt: now,
            };
            return completedItem;
        }

        if (index > targetIndex && !nextPromoted && item.status === "pending") {
            nextPromoted = true;
            return {
                ...item,
                status: "in_progress" as const,
                updatedAt: now,
            };
        }

        return item;
    });

    return { checklist: nextChecklist, completedItem };
}
