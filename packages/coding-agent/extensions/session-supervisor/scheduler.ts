export class Scheduler {
    private timers: Map<
        string,
        { timer: NodeJS.Timeout; abort: AbortController }
    > = new Map();
    private continueCount = 0;

    constructor(
        private maxContinueCount: number,
        private pauseThresholdMs: number,
    ) {}

    scheduleContinue(
        id: string,
        delayMs: number,
        callback: () => void,
    ): { scheduled: boolean; scheduledAt?: number } {
        if (this.continueCount >= this.maxContinueCount) {
            return { scheduled: false };
        }

        this.cancelTimer(id);

        const abort = new AbortController();
        const scheduledAt = Date.now() + delayMs;

        const timer = setTimeout(() => {
            this.continueCount++;
            this.timers.delete(id);
            if (!abort.signal.aborted) {
                callback();
            }
        }, delayMs);

        this.timers.set(id, { timer, abort });
        return { scheduled: true, scheduledAt };
    }

    cancelTimer(id: string): boolean {
        const entry = this.timers.get(id);
        if (!entry) return false;
        clearTimeout(entry.timer);
        entry.abort.abort();
        this.timers.delete(id);
        return true;
    }

    cancelAll(): void {
        for (const [id] of this.timers) {
            this.cancelTimer(id);
        }
    }

    shouldPause(delayMs: number): boolean {
        return delayMs >= this.pauseThresholdMs;
    }

    isExhausted(): boolean {
        return this.continueCount >= this.maxContinueCount;
    }

    getContinueCount(): number {
        return this.continueCount;
    }

    resetCount(): void {
        this.continueCount = 0;
    }
}
