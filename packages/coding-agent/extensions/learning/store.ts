import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { encodeProjectPath, getAgentDir, resolveProjectIdentity } from "@dyyz1993/pi-coding-agent";
import {
	type LearningCandidate,
	type LearningCandidateAction,
	type LearningConfig,
	type LearningCuratorMode,
	type LearningFileKind,
	type LearningFileRef,
	type LearningMemoryCandidatePayload,
	type LearningMemorySummary,
	type LearningRun,
	type LearningRunCuratorParams,
	type LearningSkillCandidatePayload,
	type LearningSkillSummary,
	type LearningSnapshot,
} from "./contract.ts";
import { parseFrontmatter } from "./utils.ts";

const CONFIG_FILE = "config.json";
const EVENTS_FILE = "events.jsonl";
const MEMORY_ENTRYPOINT = "MEMORY.md";
const SKILL_ENTRYPOINT = "SKILL.md";

export interface LearningPaths {
	projectRoot: string;
	projectUserStateDir: string;
	learningDir: string;
	memoryDir: string;
	skillsDir: string;
	candidatesDir: string;
	runsDir: string;
	snapshotsDir: string;
	archiveMemoryDir: string;
	archiveSkillsDir: string;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
	version: 1,
	enabled: true,
	memory: {
		recallEnabled: true,
		extractMode: "pending",
		curatorMode: "dry-run",
		curatorSchedule: {
			enabled: false,
			intervalMinutes: 1440,
		},
	},
	skills: {
		distillMode: "pending",
		curatorMode: "dry-run",
		curatorSchedule: {
			enabled: false,
			intervalMinutes: 1440,
		},
	},
};

interface UsageFile {
	version: 1;
	skills: Record<
		string,
		{
			usageCount?: number;
			lastUsedAt?: number | null;
			patchCount?: number;
			state?: "active" | "disabled" | "archived";
			pinned?: boolean;
		}
	>;
}

function nowId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(input: string, fallback: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/--+/g, "-")
		.slice(0, 64);
	return slug || fallback;
}

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

export function isInsidePath(path: string, baseDir: string): boolean {
	const rel = relative(resolve(baseDir), resolve(path));
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function safeJoin(baseDir: string, ...parts: string[]): string {
	const target = resolve(baseDir, ...parts);
	if (!isInsidePath(target, baseDir)) {
		throw new Error(`Path escapes learning data directory: ${target}`);
	}
	return target;
}

function fileRef(path: string, label: string, kind: LearningFileKind): LearningFileRef {
	try {
		const s = statSync(path);
		return {
			path,
			label,
			kind,
			exists: true,
			size: s.size,
			mtimeMs: s.mtimeMs,
		};
	} catch {
		return {
			path,
			label,
			kind,
			exists: false,
		};
	}
}

export function serializeMemory(payload: LearningMemoryCandidatePayload, metadata: { sourceSessionId?: string }): string {
	const sourceSession = metadata.sourceSessionId ? `sourceSession: ${metadata.sourceSessionId}\n` : "";
	const name = payload.filename.replace(/\.md$/i, "");
	return `---\nname: ${name}\ndescription: ${payload.description}\ntype: ${payload.memoryType}\n${sourceSession}createdAt: ${new Date().toISOString()}\n---\n\n${payload.content.trim()}\n`;
}

export function serializeSkill(payload: LearningSkillCandidatePayload): string {
	return `---\nname: ${payload.name}\ndescription: ${payload.description}\n---\n\n${payload.body.trim()}\n`;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
	try {
		const raw = await readFile(path, "utf-8");
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function appendJsonl(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf-8", flag: "a" });
}

function mergeConfig(base: LearningConfig, patch: Partial<LearningConfig>): LearningConfig {
	return {
		version: 1,
		enabled: patch.enabled ?? base.enabled,
		memory: {
			...base.memory,
			...(patch.memory ?? {}),
		},
		skills: {
			...base.skills,
			...(patch.skills ?? {}),
		},
	};
}

export function getLearningPaths(projectRoot: string): LearningPaths {
	const resolvedProjectRoot = resolveProjectIdentity(projectRoot);
	const projectUserStateDir = join(getAgentDir(), "projects", encodeProjectPath(resolvedProjectRoot));
	const learningDir = join(projectUserStateDir, "learning");
	const memoryDir = join(projectUserStateDir, "memory");
	const skillsDir = join(projectUserStateDir, "skills");
	return {
		projectRoot: resolvedProjectRoot,
		projectUserStateDir,
		learningDir,
		memoryDir,
		skillsDir,
		candidatesDir: join(learningDir, "candidates"),
		runsDir: join(learningDir, "runs"),
		snapshotsDir: join(learningDir, "snapshots"),
		archiveMemoryDir: join(memoryDir, ".archive"),
		archiveSkillsDir: join(skillsDir, ".archive"),
	};
}

export function getProjectPrivateSkillsDir(projectRoot: string): string {
	return getLearningPaths(projectRoot).skillsDir;
}

export class LearningStore {
	readonly paths: LearningPaths;
	private snapshotCache: { value: LearningSnapshot; ts: number } | null = null;
	private static readonly SNAPSHOT_TTL_MS = 5_000;

	constructor(projectRoot: string) {
		this.paths = getLearningPaths(projectRoot);
		this.ensureBaseDirs();
	}

	invalidateSnapshot(): void {
		this.snapshotCache = null;
	}

	private getCachedSnapshot(): LearningSnapshot | null {
		if (!this.snapshotCache) return null;
		if (Date.now() - this.snapshotCache.ts > LearningStore.SNAPSHOT_TTL_MS) {
			this.snapshotCache = null;
			return null;
		}
		return this.snapshotCache.value;
	}

	private setCachedSnapshot(value: LearningSnapshot): void {
		this.snapshotCache = { value, ts: Date.now() };
	}

	ensureBaseDirs(): void {
		for (const dir of [
			this.paths.learningDir,
			this.paths.memoryDir,
			this.paths.skillsDir,
			this.paths.candidatesDir,
			this.paths.runsDir,
			this.paths.snapshotsDir,
			this.paths.archiveMemoryDir,
			this.paths.archiveSkillsDir,
		]) {
			ensureDir(dir);
		}
	}

	async getConfig(): Promise<LearningConfig> {
		const configPath = join(this.paths.learningDir, CONFIG_FILE);
		const loaded = await readJson<LearningConfig>(configPath, DEFAULT_LEARNING_CONFIG);
		return mergeConfig(DEFAULT_LEARNING_CONFIG, loaded);
	}

	async setConfig(patch: Partial<LearningConfig>): Promise<LearningConfig> {
		this.invalidateSnapshot();
		const next = mergeConfig(await this.getConfig(), patch);
		await writeJson(join(this.paths.learningDir, CONFIG_FILE), next);
		return next;
	}

	async createMemoryCandidate(input: {
		title: string;
		summary: string;
		payload: LearningMemoryCandidatePayload;
		sourceSessionId?: string;
		sourceMessageIds?: string[];
		confidence?: "low" | "medium" | "high";
	}): Promise<LearningCandidate> {
		this.invalidateSnapshot();
		return this.writeCandidate({
			version: 1,
			id: nowId("memory-candidate"),
			domain: "memory",
			action: "create-memory",
			status: "pending",
			title: input.title,
			summary: input.summary,
			confidence: input.confidence ?? "medium",
			sourceSessionId: input.sourceSessionId,
			sourceMessageIds: input.sourceMessageIds,
			createdAt: Date.now(),
			payload: input.payload,
			fileRefs: [],
		});
	}

	async createSkillCandidate(input: {
		title: string;
		summary: string;
		action?: Extract<LearningCandidateAction, "create-skill" | "merge-skill" | "archive-skill">;
		payload: LearningSkillCandidatePayload;
		sourceSessionId?: string;
		sourceMessageIds?: string[];
		confidence?: "low" | "medium" | "high";
		targetId?: string;
		targetPath?: string;
		fileRefs?: LearningFileRef[];
	}): Promise<LearningCandidate> {
		this.invalidateSnapshot();
		return this.writeCandidate({
			version: 1,
			id: nowId("skill-candidate"),
			domain: "skill",
			action: input.action ?? "create-skill",
			status: "pending",
			title: input.title,
			summary: input.summary,
			confidence: input.confidence ?? "medium",
			sourceSessionId: input.sourceSessionId,
			sourceMessageIds: input.sourceMessageIds,
			createdAt: Date.now(),
			targetId: input.targetId,
			targetPath: input.targetPath,
			payload: input.payload,
			fileRefs: input.fileRefs ?? [],
		});
	}

	async writeCandidate(candidate: LearningCandidate): Promise<LearningCandidate> {
		await writeJson(this.candidatePath(candidate.id), candidate);
		await appendJsonl(join(this.paths.learningDir, EVENTS_FILE), {
			type: "candidate",
			candidateId: candidate.id,
			status: candidate.status,
			domain: candidate.domain,
			action: candidate.action,
			timestamp: Date.now(),
		});
		return candidate;
	}

	async listCandidates(includeDecided = true): Promise<LearningCandidate[]> {
		if (!existsSync(this.paths.candidatesDir)) {
			return [];
		}
		const result: LearningCandidate[] = [];
		for (const entry of readdirSync(this.paths.candidatesDir)) {
			if (!entry.endsWith(".json")) continue;
			const candidate = await readJson<LearningCandidate | null>(join(this.paths.candidatesDir, entry), null);
			if (!candidate) continue;
			if (!includeDecided && candidate.status !== "pending") continue;
			result.push(candidate);
		}
		result.sort((a, b) => b.createdAt - a.createdAt);
		return result;
	}

	async getCandidate(candidateId: string): Promise<LearningCandidate> {
		const candidate = await readJson<LearningCandidate | null>(this.candidatePath(candidateId), null);
		if (!candidate) {
			throw new Error(`Learning candidate not found: ${candidateId}`);
		}
		return candidate;
	}

	async approveCandidate(candidateId: string, options?: { mergeTargetSkillName?: string }): Promise<LearningCandidate> {
		this.invalidateSnapshot();
		const candidate = await this.getCandidate(candidateId);
		if (candidate.status !== "pending") {
			return candidate;
		}

		let fileRefs: LearningFileRef[] = [];
		if (candidate.payload.type === "memory") {
			fileRefs = await this.applyMemoryCandidate(candidate.payload, candidate);
		} else if (candidate.payload.type === "skill") {
			fileRefs = await this.applySkillCandidate(candidate.payload, candidate, options);
		} else {
			fileRefs = candidate.fileRefs;
		}

		const decided: LearningCandidate = {
			...candidate,
			status: "approved",
			decision: "approved",
			decidedAt: Date.now(),
			fileRefs,
		};
		await this.writeCandidate(decided);
		await this.recordRun({
			version: 1,
			id: nowId("learning-run"),
			domain: candidate.domain,
			type: "candidate-decision",
			mode: "manual",
			status: "completed",
			startedAt: Date.now(),
			completedAt: Date.now(),
			summary: `Approved ${candidate.title}`,
			actions: [
				{
					action: candidate.action,
					targetId: candidate.id,
					targetPath: fileRefs[0]?.path,
					summary: candidate.summary,
					fileRefs,
				},
			],
		});
		return decided;
	}

	async rejectCandidate(candidateId: string): Promise<LearningCandidate> {
		this.invalidateSnapshot();
		const candidate = await this.getCandidate(candidateId);
		if (candidate.status !== "pending") {
			return candidate;
		}
		const decided: LearningCandidate = {
			...candidate,
			status: "rejected",
			decision: "rejected",
			decidedAt: Date.now(),
		};
		await this.writeCandidate(decided);
		await this.recordRun({
			version: 1,
			id: nowId("learning-run"),
			domain: candidate.domain,
			type: "candidate-decision",
			mode: "manual",
			status: "completed",
			startedAt: Date.now(),
			completedAt: Date.now(),
			summary: `Rejected ${candidate.title}`,
			actions: [
				{
					action: candidate.action,
					targetId: candidate.id,
					summary: candidate.summary,
					fileRefs: candidate.fileRefs,
				},
			],
		});
		return decided;
	}

	async runCurator(params: LearningRunCuratorParams): Promise<LearningRun> {
		const mode = params.mode ?? (await this.getConfig())[params.domain === "memory" ? "memory" : "skills"].curatorMode;
		if (params.domain === "skill") {
			return this.runSkillCurator(mode);
		}
		return this.runMemoryCurator(mode);
	}

	async recordRun(run: LearningRun): Promise<LearningRun> {
		await writeJson(join(this.paths.runsDir, `${run.id}.json`), run);
		await appendJsonl(join(this.paths.learningDir, EVENTS_FILE), {
			type: "run",
			runId: run.id,
			domain: run.domain,
			status: run.status,
			timestamp: Date.now(),
		});
		return run;
	}

	async getSnapshot(): Promise<LearningSnapshot> {
		const cached = this.getCachedSnapshot();
		if (cached) return cached;
		const config = await this.getConfig();
		await this.ensureMemoryEntrypoint();
		const memoryFiles = await this.listMemoryFiles();
		const skills = await this.listSkills();
		const candidates = await this.listCandidates(false);
		const runs = await this.listRuns();
		const warnings = runs.filter((run) => run.status === "failed").length;
		const lastRunAt = runs.reduce<number | null>((latest, run) => {
			const t = run.completedAt ?? run.startedAt;
			return latest === null || t > latest ? t : latest;
		}, null);
		const disabledSkills = skills.filter((skill) => skill.state === "disabled").length;
		const archivedSkills = skills.filter((skill) => skill.state === "archived").length;
		const snapshot: LearningSnapshot = {
			version: 1,
			projectRoot: this.paths.projectRoot,
			dirs: {
				learningDir: this.paths.learningDir,
				memoryDir: this.paths.memoryDir,
				skillsDir: this.paths.skillsDir,
			},
			config,
			overview: {
				memoryFiles: memoryFiles.length,
				activeSkills: skills.filter((skill) => skill.state === "active").length,
				disabledSkills,
				archivedSkills,
				pendingCandidates: candidates.length,
				warnings,
				lastRunAt,
			},
			memory: {
				files: memoryFiles,
				entrypoint: this.getMemoryEntrypointRef(),
				diagnostics: [],
			},
			skills: {
				items: skills,
				diagnostics: [],
			},
			candidates,
			runs,
		};
		await writeJson(join(this.paths.snapshotsDir, "latest.json"), snapshot);
		this.setCachedSnapshot(snapshot);
		return snapshot;
	}

	async listMemoryFiles(): Promise<LearningMemorySummary[]> {
		const files: LearningMemorySummary[] = [];
		this.collectMemoryFiles(this.paths.memoryDir, "active", files);
		this.collectMemoryFiles(this.paths.archiveMemoryDir, "archived", files);
		files.sort((a, b) => b.mtimeMs - a.mtimeMs);
		return files;
	}

	async listSkills(): Promise<LearningSkillSummary[]> {
		const usage = await this.loadUsage();
		const skills: LearningSkillSummary[] = [];
		this.collectSkillSummaries(this.paths.skillsDir, "active", usage, skills);
		this.collectSkillSummaries(this.paths.archiveSkillsDir, "archived", usage, skills);
		skills.sort((a, b) => a.name.localeCompare(b.name));
		return skills;
	}

	private candidatePath(candidateId: string): string {
		return safeJoin(this.paths.candidatesDir, `${slugify(candidateId, "candidate")}.json`);
	}

	async applyMemoryCandidate(
		payload: LearningMemoryCandidatePayload,
		candidate: LearningCandidate,
	): Promise<LearningFileRef[]> {
		this.invalidateSnapshot();
		const baseName = payload.filename.endsWith(".md")
			? slugify(payload.filename.slice(0, -3), "memory")
			: slugify(payload.filename, "memory");
		let filename = `${baseName}.md`;
		let target = safeJoin(this.paths.memoryDir, filename);
		let suffix = 2;
		while (existsSync(target)) {
			filename = `${baseName}-${suffix}.md`;
			target = safeJoin(this.paths.memoryDir, filename);
			suffix += 1;
		}
		await writeFile(target, serializeMemory(payload, { sourceSessionId: candidate.sourceSessionId }), "utf-8");
		await this.ensureMemoryEntrypoint();
		return [fileRef(target, filename, "memory"), fileRef(join(this.paths.memoryDir, MEMORY_ENTRYPOINT), MEMORY_ENTRYPOINT, "memory-index")];
	}

	async applySkillCandidate(
		payload: LearningSkillCandidatePayload,
		candidate: LearningCandidate,
		options?: { mergeTargetSkillName?: string },
	): Promise<LearningFileRef[]> {
		this.invalidateSnapshot();
		if (candidate.action === "archive-skill") {
			const targetName = candidate.targetId ?? payload.name;
			return this.archiveSkill(targetName);
		}
		if (candidate.action === "merge-skill" || options?.mergeTargetSkillName || payload.targetSkillName) {
			const targetName = options?.mergeTargetSkillName ?? payload.targetSkillName ?? payload.name;
			return this.mergeSkill(targetName, payload);
		}
		return this.createSkillPackage(payload);
	}

	private async createSkillPackage(payload: LearningSkillCandidatePayload): Promise<LearningFileRef[]> {
		const skillName = slugify(payload.name, "generated-skill");
		const skillDir = safeJoin(this.paths.skillsDir, skillName);
		await mkdir(skillDir, { recursive: true });
		const skillPath = safeJoin(skillDir, SKILL_ENTRYPOINT);
		await writeFile(skillPath, serializeSkill({ ...payload, name: skillName }), "utf-8");
		const refs = [fileRef(skillPath, SKILL_ENTRYPOINT, "skill-entrypoint")];
		for (const extra of payload.files ?? []) {
			const relativePath = normalize(extra.relativePath).replace(/^(\.\.[/\\])+/, "");
			const target = safeJoin(skillDir, relativePath);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, extra.content, "utf-8");
			refs.push(fileRef(target, relativePath, this.kindForSkillFile(relativePath)));
		}
		const usage = await this.loadUsage();
		const existing = usage.skills[skillName] ?? {};
		usage.skills[skillName] = {
			...existing,
			state: "active",
			pinned: payload.pinned ?? false,
			usageCount: (existing.usageCount ?? 0) + 1,
			lastUsedAt: Date.now(),
		};
		await this.saveUsage(usage);
		return refs;
	}

	private async mergeSkill(targetName: string, payload: LearningSkillCandidatePayload): Promise<LearningFileRef[]> {
		const skillName = slugify(targetName, "generated-skill");
		const skillDir = safeJoin(this.paths.skillsDir, skillName);
		const skillPath = safeJoin(skillDir, SKILL_ENTRYPOINT);
		if (!existsSync(skillPath)) {
			return this.createSkillPackage({ ...payload, name: skillName });
		}
		const original = await readFile(skillPath, "utf-8");
		const merged = `${original.trim()}\n\n## Learned Update\n\n${payload.body.trim()}\n`;
		await writeFile(skillPath, merged, "utf-8");
		const refs = [fileRef(skillPath, SKILL_ENTRYPOINT, "skill-entrypoint")];
		for (const extra of payload.files ?? []) {
			const relativePath = normalize(extra.relativePath).replace(/^(\.\.[/\\])+/, "");
			const target = safeJoin(skillDir, relativePath);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, extra.content, "utf-8");
			refs.push(fileRef(target, relativePath, this.kindForSkillFile(relativePath)));
		}
		const usage = await this.loadUsage();
		const current = usage.skills[skillName] ?? {};
		usage.skills[skillName] = {
			...current,
			state: current.state ?? "active",
			patchCount: (current.patchCount ?? 0) + 1,
			pinned: payload.pinned ?? current.pinned ?? false,
		};
		await this.saveUsage(usage);
		return refs;
	}

	private async archiveSkill(skillName: string): Promise<LearningFileRef[]> {
		const safeName = slugify(skillName, "generated-skill");
		const source = safeJoin(this.paths.skillsDir, safeName);
		const target = safeJoin(this.paths.archiveSkillsDir, safeName);
		if (!existsSync(source)) {
			throw new Error(`Skill not found: ${skillName}`);
		}
		await mkdir(dirname(target), { recursive: true });
		await rename(source, target);
		const usage = await this.loadUsage();
		usage.skills[safeName] = {
			...(usage.skills[safeName] ?? {}),
			state: "archived",
		};
		await this.saveUsage(usage);
		return [fileRef(target, safeName, "skill")];
	}

	private async ensureMemoryEntrypoint(): Promise<void> {
		const entrypoint = safeJoin(this.paths.memoryDir, MEMORY_ENTRYPOINT);
		const files = await this.listMemoryFiles();
		const activeFiles = files.filter((file) => file.state === "active");

		// Skip rebuild if entrypoint is newer than all active memory files
		// (avoids repeated disk writes during high-frequency getSnapshot calls)
		try {
			const entryStat = await stat(entrypoint);
			const newestMemory = activeFiles.reduce<number>((max, f) => Math.max(max, f.mtimeMs ?? 0), 0);
			if (entryStat.mtimeMs >= newestMemory) {
				return;
			}
		} catch {
			// entrypoint doesn't exist yet → fall through and create
		}

		const lines = [
			"# Project Memory",
			"",
			...activeFiles.map((file) => `- [${file.description ?? file.filename}](${file.filename})`),
			"",
		];
		await writeFile(entrypoint, lines.join("\n"), "utf-8");
	}

	private getMemoryEntrypointRef(): LearningFileRef | null {
		const path = join(this.paths.memoryDir, MEMORY_ENTRYPOINT);
		if (!existsSync(path)) {
			return null;
		}
		return fileRef(path, MEMORY_ENTRYPOINT, "memory-index");
	}

	private collectMemoryFiles(
		dir: string,
		state: "active" | "archived",
		target: LearningMemorySummary[],
	): void {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".") || entry === MEMORY_ENTRYPOINT || !entry.endsWith(".md")) continue;
			const path = join(dir, entry);
			try {
				const s = statSync(path);
				if (!s.isFile()) continue;
				const content = readFileSyncUtf8(path);
				const parsed = parseFrontmatter(content);
				target.push({
					filename: entry,
					filePath: path,
					description: parsed.frontmatter.description ?? parsed.frontmatter.name ?? null,
					type: parsed.frontmatter.type ?? null,
					mtimeMs: s.mtimeMs,
					size: s.size,
					state,
				});
			} catch {
				continue;
			}
		}
	}

	private collectSkillSummaries(
		dir: string,
		defaultState: "active" | "archived",
		usage: UsageFile,
		target: LearningSkillSummary[],
	): void {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".")) continue;
			const skillDir = join(dir, entry);
			try {
				const s = statSync(skillDir);
				if (!s.isDirectory()) continue;
				const skillPath = join(skillDir, SKILL_ENTRYPOINT);
				if (!existsSync(skillPath)) continue;
				const parsed = parseFrontmatter(readFileSyncUtf8(skillPath));
				const name = parsed.frontmatter.name ?? entry;
				const usageEntry = usage.skills[name] ?? usage.skills[entry] ?? {};
				const state = usageEntry.state ?? defaultState;
				target.push({
					name,
					description: parsed.frontmatter.description ?? "",
					scope: "project-private",
					source: "generated",
					state,
					usageCount: usageEntry.usageCount ?? 0,
					lastUsedAt: usageEntry.lastUsedAt ?? null,
					patchCount: usageEntry.patchCount ?? 0,
					filePath: skillPath,
					baseDir: skillDir,
					pinned: usageEntry.pinned ?? false,
					files: this.listSkillFileRefs(skillDir),
				});
			} catch {
				continue;
			}
		}
	}

	private listSkillFileRefs(skillDir: string): LearningFileRef[] {
		const refs: LearningFileRef[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				if (entry.startsWith(".")) continue;
				const fullPath = join(dir, entry);
				const rel = relative(skillDir, fullPath).split(sep).join("/");
				const s = statSync(fullPath);
				if (s.isDirectory()) {
					walk(fullPath);
					continue;
				}
				refs.push(fileRef(fullPath, rel, this.kindForSkillFile(rel)));
			}
		};
		walk(skillDir);
		return refs;
	}

	private kindForSkillFile(relativePath: string): LearningFileKind {
		if (basename(relativePath) === SKILL_ENTRYPOINT) return "skill-entrypoint";
		const first = relativePath.split(/[\\/]/)[0] ?? "";
		if (first === "references") return "skill-reference";
		if (first === "scripts") return "skill-script";
		if (first === "templates") return "skill-template";
		if (first === "assets") return "skill-asset";
		return "skill";
	}

	private async listRuns(): Promise<LearningRun[]> {
		if (!existsSync(this.paths.runsDir)) return [];
		const runs: LearningRun[] = [];
		for (const entry of readdirSync(this.paths.runsDir)) {
			if (!entry.endsWith(".json")) continue;
			const run = await readJson<LearningRun | null>(join(this.paths.runsDir, entry), null);
			if (run) runs.push(run);
		}
		runs.sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt));
		return runs.slice(0, 30);
	}

	private async loadUsage(): Promise<UsageFile> {
		return readJson<UsageFile>(join(this.paths.skillsDir, ".usage.json"), { version: 1, skills: {} });
	}

	private async saveUsage(usage: UsageFile): Promise<void> {
		await writeJson(join(this.paths.skillsDir, ".usage.json"), usage);
	}

	private async runMemoryCurator(mode: LearningCuratorMode): Promise<LearningRun> {
		const memoryFiles = await this.listMemoryFiles();
		const run: LearningRun = {
			version: 1,
			id: nowId("memory-curator"),
			domain: "memory",
			type: "memory-curator",
			mode,
			status: "completed",
			startedAt: Date.now(),
			completedAt: Date.now(),
			summary: `Reviewed ${memoryFiles.length} memory files`,
			actions: [
				{
					action: "none",
					summary: mode === "dry-run" ? "Dry-run only; no memory files changed." : "No memory changes proposed.",
					fileRefs: memoryFiles.map((file) => fileRef(file.filePath, file.filename, "memory")),
				},
			],
		};
		await this.recordRun(run);
		return run;
	}

	private async runSkillCurator(mode: LearningCuratorMode): Promise<LearningRun> {
		const skills = await this.listSkills();
		const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
		const now = Date.now();
		const stale = skills.filter((skill) => {
			if (skill.pinned || skill.state !== "active") return false;
			const lastUsed = skill.lastUsedAt ?? 0;
			return now - lastUsed > STALE_THRESHOLD_MS;
		});
		const actions = stale.map((skill) => ({
			action: "archive-skill" as const,
			targetId: skill.name,
			targetPath: skill.baseDir,
			summary: `Archive unused generated skill ${skill.name}`,
			fileRefs: skill.files,
		}));
		if (mode === "pending") {
			for (const action of actions) {
				await this.createSkillCandidate({
					title: action.summary,
					summary: action.summary,
					action: "archive-skill",
					targetId: action.targetId,
					targetPath: action.targetPath,
					payload: {
						type: "skill",
						name: action.targetId,
						description: action.summary,
						body: "",
					},
					fileRefs: action.fileRefs,
				});
			}
		}
		if (mode === "auto") {
			for (const action of actions) {
				await this.archiveSkill(action.targetId);
			}
		}
		const run: LearningRun = {
			version: 1,
			id: nowId("skill-curator"),
			domain: "skill",
			type: "skill-curator",
			mode,
			status: "completed",
			startedAt: Date.now(),
			completedAt: Date.now(),
			summary: `Reviewed ${skills.length} generated skills; ${actions.length} actions proposed.`,
			actions: actions.length > 0 ? actions : [{ action: "none", summary: "No skill curator actions proposed." }],
		};
		await this.recordRun(run);
		return run;
	}
}

function readFileSyncUtf8(path: string): string {
	return statSync(path).isFile() ? readFileSync(path, "utf-8") : "";
}
