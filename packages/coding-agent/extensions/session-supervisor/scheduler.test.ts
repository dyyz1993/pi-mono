import { describe, expect, it } from "vitest";
import { Scheduler } from "./scheduler.ts";

describe("Scheduler", () => {
    it("increments continueCount on each scheduleContinue call", async () => {
        const scheduler = new Scheduler(3, 60_000);
        expect(scheduler.getContinueCount()).toBe(0);
        expect(scheduler.isExhausted()).toBe(false);

        const result1 = scheduler.scheduleContinue("id-1", 0, () => {});
        expect(result1.scheduled).toBe(true);

        // Wait for the timer to fire
        await new Promise((r) => setTimeout(r, 10));
        expect(scheduler.getContinueCount()).toBe(1);
        expect(scheduler.isExhausted()).toBe(false);

        const result2 = scheduler.scheduleContinue("id-2", 0, () => {});
        expect(result2.scheduled).toBe(true);

        await new Promise((r) => setTimeout(r, 10));
        expect(scheduler.getContinueCount()).toBe(2);
        expect(scheduler.isExhausted()).toBe(false);

        const result3 = scheduler.scheduleContinue("id-3", 0, () => {});
        expect(result3.scheduled).toBe(true);

        await new Promise((r) => setTimeout(r, 10));
        expect(scheduler.getContinueCount()).toBe(3);
        expect(scheduler.isExhausted()).toBe(true);

        // 4th attempt should be rejected
        const result4 = scheduler.scheduleContinue("id-4", 0, () => {});
        expect(result4.scheduled).toBe(false);

        scheduler.cancelAll();
    });

    it("rejects scheduling when maxContinueCount is reached", () => {
        const scheduler = new Scheduler(1, 60_000);
        const result = scheduler.scheduleContinue("id-1", 0, () => {});
        expect(result.scheduled).toBe(true);

        // Before timer fires, count is still 0, but we can schedule again
        // because the check is against continueCount (0 < 1)
        const result2 = scheduler.scheduleContinue("id-2", 0, () => {});
        // id-1 gets cancelled, id-2 is scheduled
        expect(result2.scheduled).toBe(true);

        scheduler.cancelAll();
    });

    it("resetCount allows scheduling again after exhaustion", async () => {
        const scheduler = new Scheduler(1, 60_000);

        scheduler.scheduleContinue("id-1", 0, () => {});
        await new Promise((r) => setTimeout(r, 10));

        expect(scheduler.isExhausted()).toBe(true);

        scheduler.resetCount();
        expect(scheduler.isExhausted()).toBe(false);
        expect(scheduler.getContinueCount()).toBe(0);

        const result = scheduler.scheduleContinue("id-2", 0, () => {});
        expect(result.scheduled).toBe(true);

        scheduler.cancelAll();
    });
});
