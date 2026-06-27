import type { LearningDomain, LearningRun, LearningSnapshot } from "./contract.ts";
import { LearningStore } from "./store.ts";

type SchedulerTimer = ReturnType<typeof setInterval>;

export interface LearningCuratorSchedulerOptions {
  getStore: () => LearningStore;
  emitRun?: (run: LearningRun) => void | Promise<void>;
  emitSnapshot?: (snapshot: LearningSnapshot) => void | Promise<void>;
  onError?: (error: unknown) => void;
  intervalMsOverride?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  unrefTimers?: boolean;
}

type ScheduledDomain = Extract<LearningDomain, "memory" | "skill">;

export class LearningCuratorScheduler {
  private readonly options: LearningCuratorSchedulerOptions;
  private readonly timers = new Map<ScheduledDomain, SchedulerTimer>();
  private readonly inFlight = new Set<ScheduledDomain>();

  constructor(options: LearningCuratorSchedulerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.stop();
    const store = this.options.getStore();
    const config = await store.getConfig();
    if (!config.enabled) return;
    this.schedule("memory", config.memory.curatorSchedule);
    this.schedule("skill", config.skills.curatorSchedule);
  }

  stop(): void {
    const clearIntervalFn = this.options.clearIntervalFn ?? clearInterval;
    for (const timer of this.timers.values()) {
      clearIntervalFn(timer);
    }
    this.timers.clear();
    this.inFlight.clear();
  }

  async tick(domain: ScheduledDomain): Promise<LearningRun | null> {
    if (this.inFlight.has(domain)) return null;
    this.inFlight.add(domain);
    try {
      const store = this.options.getStore();
      const config = await store.getConfig();
      const domainConfig = domain === "memory" ? config.memory : config.skills;
      if (!config.enabled || !domainConfig.curatorSchedule.enabled) return null;
      const run = await store.runCurator({ domain, mode: domainConfig.curatorMode });
      await this.options.emitRun?.(run);
      await this.options.emitSnapshot?.(await store.getSnapshot());
      return run;
    } catch (error) {
      this.options.onError?.(error);
      return null;
    } finally {
      this.inFlight.delete(domain);
    }
  }

  private schedule(domain: ScheduledDomain, schedule: { enabled: boolean; intervalMinutes: number }): void {
    if (!schedule.enabled) return;
    const intervalMs =
      this.options.intervalMsOverride ?? Math.max(1, Math.floor(schedule.intervalMinutes)) * 60_000;
    const setIntervalFn = this.options.setIntervalFn ?? setInterval;
    const timer = setIntervalFn(() => {
      void this.tick(domain);
    }, intervalMs);
    if (this.options.unrefTimers !== false && typeof timer === "object" && timer && "unref" in timer) {
      const maybeUnref = (timer as { unref?: () => void }).unref;
      if (typeof maybeUnref === "function") {
        maybeUnref.call(timer);
      }
    }
    this.timers.set(domain, timer);
  }
}
