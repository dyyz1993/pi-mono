import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import { LearningCuratorScheduler } from "../scheduler.ts";
import { LearningStore } from "../store.ts";
import { DEFAULT_LEARNING_CONFIG } from "../store.ts";
import type { LearningRun, LearningSnapshot } from "../contract.ts";

let tempProject: string;

beforeEach(async () => {
  tempProject = await mkdtemp(tmpdir() + "/learning-scheduler-test-");
});

afterEach(async () => {
  await rm(tempProject, { recursive: true, force: true });
});

describe("LearningCuratorScheduler.reload", () => {
  it("schedules nothing when config disabled", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({ enabled: false });
    const setIntervalFn = vi.fn();
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
    });
    await scheduler.reload();
    expect(setIntervalFn).not.toHaveBeenCalled();
  });

  it("schedules nothing when curatorSchedule.enabled is false", async () => {
    const store = new LearningStore(tempProject);
    // default config has curatorSchedule.enabled = false
    const setIntervalFn = vi.fn();
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
    });
    await scheduler.reload();
    expect(setIntervalFn).not.toHaveBeenCalled();
  });

  it("schedules both memory and skill when enabled", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
      skills: {
        ...DEFAULT_LEARNING_CONFIG.skills,
        curatorSchedule: { enabled: true, intervalMinutes: 120 },
      },
    });
    const setIntervalFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
    });
    await scheduler.reload();
    expect(setIntervalFn).toHaveBeenCalledTimes(2);
    // First call: memory, 60 minutes
    expect(setIntervalFn.mock.calls[0]?.[1]).toBe(60 * 60_000);
    // Second call: skill, 120 minutes
    expect(setIntervalFn.mock.calls[1]?.[1]).toBe(120 * 60_000);
  });

  it("uses intervalMsOverride when provided", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
      skills: {
        ...DEFAULT_LEARNING_CONFIG.skills,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
    });
    const setIntervalFn = vi.fn().mockReturnValue({ unref: vi.fn() });
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
      intervalMsOverride: 1000,
    });
    await scheduler.reload();
    // Both schedules should use override (1000ms)
    expect(setIntervalFn.mock.calls[0]?.[1]).toBe(1000);
    expect(setIntervalFn.mock.calls[1]?.[1]).toBe(1000);
  });
});

describe("LearningCuratorScheduler.stop", () => {
  it("clears all timers", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
    });
    const clearIntervalFn = vi.fn();
    const fakeTimer = { unref: vi.fn() };
    const setIntervalFn = vi.fn().mockReturnValue(fakeTimer);
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
      clearIntervalFn: clearIntervalFn as any,
    });
    await scheduler.reload();
    scheduler.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(fakeTimer);
  });
});

describe("LearningCuratorScheduler.tick", () => {
  it("returns null when domain schedule disabled", async () => {
    const store = new LearningStore(tempProject);
    // default config has curatorSchedule.enabled = false
    const scheduler = new LearningCuratorScheduler({ getStore: () => store });
    const run = await scheduler.tick("memory");
    expect(run).toBeNull();
  });

  it("returns null when config disabled", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({ enabled: false });
    const scheduler = new LearningCuratorScheduler({ getStore: () => store });
    const run = await scheduler.tick("memory");
    expect(run).toBeNull();
  });

  it("runs curator and emits run + snapshot when enabled", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
        curatorMode: "dry-run",
      },
    });
    const emitRun = vi.fn();
    const emitSnapshot = vi.fn();
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      emitRun,
      emitSnapshot,
    });
    const run = await scheduler.tick("memory");
    expect(run).not.toBeNull();
    expect(run!.domain).toBe("memory");
    expect(emitRun).toHaveBeenCalledWith(run);
    expect(emitSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = emitSnapshot.mock.calls[0]?.[0] as LearningSnapshot;
    expect(snapshot.overview.lastRunAt).not.toBeNull();
  });

  it("returns null on error and calls onError", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
    });
    const onError = vi.fn();
    // Force getStore to throw
    const scheduler = new LearningCuratorScheduler({
      getStore: () => {
        throw new Error("store unavailable");
      },
      onError,
    });
    const run = await scheduler.tick("memory");
    expect(run).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("store unavailable");
  });

  it("prevents concurrent ticks for same domain", async () => {
    const store = new LearningStore(tempProject);
    await store.setConfig({
      enabled: true,
      memory: {
        ...DEFAULT_LEARNING_CONFIG.memory,
        curatorSchedule: { enabled: true, intervalMinutes: 60 },
      },
    });
    const scheduler = new LearningCuratorScheduler({ getStore: () => store });
    // Start first tick (don't await)
    const p1 = scheduler.tick("memory");
    // Second tick should immediately return null (in-flight)
    const p2 = scheduler.tick("memory");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).not.toBeNull();
    expect(r2).toBeNull();
  });
});

describe("LearningCuratorScheduler.start", () => {
  it("calls reload on start", async () => {
    const store = new LearningStore(tempProject);
    const setIntervalFn = vi.fn();
    const scheduler = new LearningCuratorScheduler({
      getStore: () => store,
      setIntervalFn: setIntervalFn as any,
    });
    await scheduler.start();
    // default config has schedule disabled, so no timers scheduled,
    // but reload() ran without throwing
    expect(setIntervalFn).not.toHaveBeenCalled();
  });
});
