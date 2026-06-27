import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningStore } from "../../extensions/learning/store.ts";

describe("learning skill curator", () => {
	let tempDir: string;
	let agentDir: string;
	let projectDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `learning-curator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	async function createGeneratedSkill(store: LearningStore, name: string, options?: { pinned?: boolean }) {
		const candidate = await store.createSkillCandidate({
			title: `Create ${name}`,
			summary: `Create ${name}`,
			payload: {
				type: "skill",
				name,
				description: `${name} description`,
				body: "Follow the reusable workflow.",
				pinned: options?.pinned ?? false,
				files: [
					{
						relativePath: "references/context.md",
						content: "# Context\n\nExtra package file.",
					},
				],
			},
		});
		await store.approveCandidate(candidate.id);
	}

	it("dry-run reports stale generated skills without modifying files", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "unused-workflow");
		const before = await store.getSnapshot();

		const run = await store.runCurator({ domain: "skill", mode: "dry-run" });
		const after = await store.getSnapshot();

		expect(run.actions[0]!.action).toBe("archive-skill");
		expect(after.skills.items[0]!.state).toBe("active");
		expect(existsSync(before.skills.items[0]!.baseDir)).toBe(true);
	});

	it("pending mode creates curator candidates instead of modifying skill packages", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "pending-archive");

		await store.runCurator({ domain: "skill", mode: "pending" });
		const snapshot = await store.getSnapshot();

		expect(snapshot.candidates).toHaveLength(1);
		expect(snapshot.candidates[0]!.action).toBe("archive-skill");
		expect(snapshot.skills.items[0]!.state).toBe("active");
	});

	it("archive moves the whole generated skill package", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "archive-me");
		const [candidate] = await store.listCandidates(true);
		expect(candidate?.status).toBe("approved");

		await store.runCurator({ domain: "skill", mode: "pending" });
		const [archiveCandidate] = await store.listCandidates(false);
		await store.approveCandidate(archiveCandidate!.id);
		const snapshot = await store.getSnapshot();

		const archived = snapshot.skills.items.find((skill) => skill.name === "archive-me");
		expect(archived?.state).toBe("archived");
		expect(archived?.baseDir).toContain(".archive");
		expect(archived?.files.some((file) => file.label === "references/context.md")).toBe(true);
	});

	it("pinned skills are not archived by curator", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "pinned-workflow", { pinned: true });

		const run = await store.runCurator({ domain: "skill", mode: "pending" });
		const snapshot = await store.getSnapshot();

		expect(run.actions[0]!.action).toBe("none");
		expect(snapshot.candidates).toHaveLength(0);
		expect(snapshot.skills.items[0]!.state).toBe("active");
	});

	it("merge candidates include affected files beyond SKILL.md", async () => {
		const store = new LearningStore(projectDir);
		await createGeneratedSkill(store, "merge-target");
		const candidate = await store.createSkillCandidate({
			title: "Merge skill update",
			summary: "Patch existing skill and reference",
			action: "merge-skill",
			payload: {
				type: "skill",
				name: "merge-target",
				description: "Merge target",
				body: "Add the new debugging step.",
				targetSkillName: "merge-target",
				files: [
					{
						relativePath: "references/new-path.md",
						content: "# New Path\n\nRun harness first.",
					},
				],
			},
		});

		await store.approveCandidate(candidate.id);
		const snapshot = await store.getSnapshot();
		const skill = snapshot.skills.items.find((item) => item.name === "merge-target");

		expect(skill?.patchCount).toBe(1);
		expect(skill?.files.some((file) => file.label === "references/new-path.md")).toBe(true);
		expect(readFileSync(join(skill!.baseDir, "SKILL.md"), "utf-8")).toContain("Learned Update");
		expect(readFileSync(join(skill!.baseDir, "references", "new-path.md"), "utf-8")).toContain("Run harness first");
	});
});
