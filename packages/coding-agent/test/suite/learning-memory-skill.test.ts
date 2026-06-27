import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import learningExtension from "../../extensions/learning/index.ts";
import { maybeExtractMemory } from "../../extensions/learning/memory-provider.ts";
import { maybeDistillSkill } from "../../extensions/learning/skill-provider.ts";
import { LearningStore } from "../../extensions/learning/store.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function assistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "faux",
		model: "faux",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("learning memory and skill project store", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;
	let previousAgentDir: string | undefined;
	const harnesses: Harness[] = [];

	beforeEach(() => {
		tempDir = join(tmpdir(), `learning-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns a refresh-safe snapshot with config, summaries, candidates, and runs", async () => {
		const store = new LearningStore(projectDir);
		const snapshot = await store.getSnapshot();

		expect(snapshot.version).toBe(1);
		expect(snapshot.projectRoot).toBe(realpathSync(projectDir));
		expect(snapshot.config.memory.extractMode).toBe("pending");
		expect(snapshot.config.skills.distillMode).toBe("pending");
		expect(snapshot.candidates).toEqual([]);
		expect(snapshot.memory.entrypoint?.label).toBe("MEMORY.md");
		expect(existsSync(snapshot.memory.entrypoint!.path)).toBe(true);
		expect(snapshot.memory.files).toEqual([]);
		expect(snapshot.skills.items).toEqual([]);
		expect(snapshot.runs).toEqual([]);
		expect(snapshot.dirs.learningDir).toContain("/projects/");
	});

	it("memory.extractMode=off does not write candidates or memory files", async () => {
		const store = new LearningStore(projectDir);
		await store.setConfig({
			memory: {
				extractMode: "off",
				recallEnabled: true,
				curatorMode: "dry-run",
				curatorSchedule: { enabled: false, intervalMinutes: 1440 },
			},
		});

		await maybeExtractMemory({
			store,
			messages: [userMessage("remember that this project uses project-scoped learning")],
		});

		const snapshot = await store.getSnapshot();
		expect(snapshot.candidates).toHaveLength(0);
		expect(snapshot.memory.files).toHaveLength(0);
	});

	it("memory.extractMode=pending writes a candidate and does not write a memory file", async () => {
		const store = new LearningStore(projectDir);

		await maybeExtractMemory({
			store,
			messages: [userMessage("The memory panel should become Learning with separate Memory and Skills tabs.")],
			sourceSessionId: "session-1",
			sourceMessageIds: ["message-1"],
		});

		const snapshot = await store.getSnapshot();
		expect(snapshot.candidates).toHaveLength(1);
		expect(snapshot.candidates[0]!.domain).toBe("memory");
		expect(snapshot.memory.files).toHaveLength(0);
	});

	it("approving a memory candidate writes project-scoped memory and persists decision history", async () => {
		const store = new LearningStore(projectDir);
		await maybeExtractMemory({
			store,
			messages: [userMessage("All Learning files should open through Explorer/FileOverlay.")],
			sourceSessionId: "session-1",
		});
		const [candidate] = await store.listCandidates(false);

		await store.approveCandidate(candidate!.id);
		const restartedStore = new LearningStore(projectDir);
		const snapshot = await restartedStore.getSnapshot();

		expect(snapshot.candidates).toHaveLength(0);
		expect(snapshot.memory.files).toHaveLength(1);
		expect(snapshot.memory.files[0]!.filePath).toContain("/projects/");
		expect(readFileSync(snapshot.memory.files[0]!.filePath, "utf-8")).toContain("Explorer/FileOverlay");
		expect(snapshot.runs.some((run) => run.type === "candidate-decision")).toBe(true);
	});

	it("skills.distillMode=pending writes a skill candidate and does not write SKILL.md", async () => {
		const store = new LearningStore(projectDir);

		await maybeDistillSkill({
			store,
			messages: [assistantMessage("Step 1: run harness tests. Step 2: run RPC JSONL. Step 3: run UI screenshots.")],
			sourceSessionId: "session-1",
		});

		const snapshot = await store.getSnapshot();
		expect(snapshot.candidates).toHaveLength(1);
		expect(snapshot.candidates[0]!.domain).toBe("skill");
		expect(snapshot.skills.items).toHaveLength(0);
	});

	it("approving a skill candidate writes a project-private skill package and resource loader discovers it", async () => {
		const store = new LearningStore(projectDir);
		await maybeDistillSkill({
			store,
			messages: [assistantMessage("Use rg to inspect files, add focused tests, then run harness before UI.")],
			sourceSessionId: "session-1",
		});
		const [candidate] = await store.listCandidates(false);

		await store.approveCandidate(candidate!.id);
		const snapshot = await store.getSnapshot();
		expect(snapshot.skills.items).toHaveLength(1);
		expect(snapshot.skills.items[0]!.filePath.endsWith("SKILL.md")).toBe(true);
		expect(snapshot.skills.items[0]!.files.some((file) => file.kind === "skill-reference")).toBe(true);

		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: projectDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();
		const discovered = resourceLoader.getSkills().skills;
		expect(discovered.some((skill) => skill.filePath === snapshot.skills.items[0]!.filePath)).toBe(true);
	});

	it("extension loads through harness without real provider APIs", async () => {
		const harness = await createHarness({
			cwd: projectDir,
			extensionFactories: [learningExtension],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});

		harness.setResponses([fauxAssistantMessage("Done with the reusable Learning workflow.")]);
		await harness.session.prompt("Learning should keep candidates refresh-safe.");
		await harness.session.agent.waitForIdle();
		await new Promise((resolve) => setTimeout(resolve, 30));

		const store = new LearningStore(projectDir);
		const snapshot = await store.getSnapshot();
		expect(snapshot.candidates.length).toBeGreaterThan(0);
	});

	it("candidate state survives simulated session restart by reading persisted snapshot", async () => {
		const store = new LearningStore(projectDir);
		await maybeExtractMemory({
			store,
			messages: [userMessage("Candidate state must survive restart.")],
		});

		const restartedStore = new LearningStore(projectDir);
		const snapshot = await restartedStore.getSnapshot();

		expect(snapshot.candidates).toHaveLength(1);
		expect(existsSync(join(snapshot.dirs.learningDir, "snapshots", "latest.json"))).toBe(true);
	});
});
