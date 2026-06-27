import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningRun, LearningSnapshot } from "../../extensions/learning/contract.ts";
import { LearningCuratorScheduler } from "../../extensions/learning/scheduler.ts";
import { LearningStore } from "../../extensions/learning/store.ts";

describe("learning curator scheduler", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		tempDir = join(tmpdir(), `learning-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		vi.useRealTimers();
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	async function createGeneratedSkill(store: LearningStore, name: string) {
		const candidate = await store.createSkillCandidate({
			title: `Create ${name}`,
			summary: `Create ${name}`,
			payload: {
				type: "skill",
				name,
				description: `${name} description`,
				body: "Follow the reusable workflow.",
			},
		});
		await store.approveCandidate(candidate.id);
	}

	it("runs scheduled skill curator ticks with fake timers", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "scheduled-archive");
		await store.setConfig({
			skills: {
				distillMode: "pending",
				curatorMode: "pending",
				curatorSchedule: { enabled: true, intervalMinutes: 60 },
			},
		});
		const emittedRuns: LearningRun[] = [];
		const emittedSnapshots: LearningSnapshot[] = [];
		expect((await store.getConfig()).skills.curatorSchedule.enabled).toBe(true);
		const scheduler = new LearningCuratorScheduler({
			getStore: () => store,
			intervalMsOverride: 1_000,
			setIntervalFn: globalThis.setInterval,
			clearIntervalFn: globalThis.clearInterval,
			unrefTimers: false,
			emitRun: (run) => {
				emittedRuns.push(run);
			},
			emitSnapshot: (snapshot) => {
				emittedSnapshots.push(snapshot);
			},
		});

		await scheduler.start();
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => {
			expect(emittedRuns).toHaveLength(1);
			expect(emittedSnapshots).toHaveLength(1);
		});
		scheduler.stop();

		const snapshot = await store.getSnapshot();
		expect(emittedRuns[0]!.type).toBe("skill-curator");
		expect(emittedRuns[0]!.mode).toBe("pending");
		expect(snapshot.candidates.some((candidate) => candidate.action === "archive-skill")).toBe(true);
	});

	it("does not run curator ticks when schedule is disabled", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "manual-only");
		await store.setConfig({
			skills: {
				distillMode: "pending",
				curatorMode: "pending",
				curatorSchedule: { enabled: false, intervalMinutes: 60 },
			},
		});
		const emittedRuns: LearningRun[] = [];
		const scheduler = new LearningCuratorScheduler({
			getStore: () => store,
			intervalMsOverride: 1_000,
			setIntervalFn: globalThis.setInterval,
			clearIntervalFn: globalThis.clearInterval,
			unrefTimers: false,
			emitRun: (run) => {
				emittedRuns.push(run);
			},
		});

		await scheduler.start();
		await vi.advanceTimersByTimeAsync(5_000);
		scheduler.stop();

		expect(emittedRuns).toHaveLength(0);
		expect(await store.listCandidates(false)).toHaveLength(0);
	});
});
