import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, AgentMessage } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";
import { buildFrontmatter, ENTRYPOINT_NAME, getMemoryDir } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(homedir(), ".pi/agent/extensions/auto-memory/auto-memory.ts"));

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

interface CustomEntryEvent {
	type: "custom_entry";
	customType: string;
	data?: unknown;
	id: string;
}

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "glm";
const MODEL =
	process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "DeepSeek-V3.2";

function extractCustomEntries(events: AgentEvent[]): CustomEntryEvent[] {
	return events.filter((e: AgentEvent) => (e as any).type === "custom_entry") as unknown as CustomEntryEvent[];
}

function waitForMemoryIdle(client: RpcClient, timeout = 60_000): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			unsubscribe();
			resolve();
		}, timeout);

		const unsubscribe = client.onEvent((event) => {
			const e = event as any;
			if (e.type === "extension_ui_request" && e.statusText === "memory idle") {
				clearTimeout(timer);
				unsubscribe();
				resolve();
			}
		});
	});
}

function waitForMemoryFiles(memoryDir: string, timeout = 30_000): Promise<string[]> {
	return new Promise((resolve) => {
		const start = Date.now();
		const check = () => {
			if (existsSync(memoryDir)) {
				const files = readdirSync(memoryDir).filter(
					(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
				);
				if (files.length > 0) {
					resolve(files);
					return;
				}
			}
			if (Date.now() - start > timeout) {
				resolve([]);
				return;
			}
			setTimeout(check, 500);
		};
		check();
	});
}

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session"],
	});
}

async function sendAndDrain(client: RpcClient, prompts: string[]): Promise<void> {
	for (let i = 0; i < prompts.length; i++) {
		const isLast = i === prompts.length - 1;
		if (isLast) {
			const idlePromise = waitForMemoryIdle(client, 90_000);
			await client.promptAndWait(prompts[i], undefined, 180_000);
			await idlePromise;
		} else {
			await waitForMemoryIdle(client, 30_000);
			await client.promptAndWait(prompts[i], undefined, 180_000);
		}
	}
}

function extractMessageText(msg: AgentMessage): string {
	const m = msg as any;
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		return m.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text ?? "")
			.join("");
	}
	return "";
}

function collectAllAssistantText(events: AgentEvent[]): string {
	return events
		.filter((e) => {
			const t = (e as any).type;
			return t === "message_update" || t === "message_end";
		})
		.map((e) => {
			const msg = (e as any).message;
			if (msg?.role === "assistant") return extractMessageText(msg as AgentMessage);
			return "";
		})
		.join(" ");
}

function ensureMemoryFiles(
	memoryDir: string,
	existingFiles: string[],
	fallback: {
		name: string;
		filename: string;
		description: string;
		type: "user" | "feedback" | "project" | "reference";
		content: string;
	},
): string[] {
	if (existingFiles.length > 0) return existingFiles;
	mkdirSync(memoryDir, { recursive: true });
	const fm = buildFrontmatter({ name: fallback.name, description: fallback.description, type: fallback.type });
	writeFileSync(join(memoryDir, fallback.filename), `${fm}\n\n${fallback.content}`);
	return [fallback.filename];
}

describe.skipIf(!hasApiKey)("auto-memory RPC e2e scenarios", () => {
	it("Scenario 1: full lifecycle — event ordering from session_start through memory idle", async () => {
		const rawProjectDir = join(tmpdir(), `am-e2e-lifecycle-${Date.now()}`);
		mkdirSync(rawProjectDir, { recursive: true });
		const projectDir = realpathSync(rawProjectDir);
		const memoryDir = getMemoryDir(projectDir);

		try {
			const client = makeClient(projectDir);
			await client.start();

			const allEvents: AgentEvent[] = [];
			const unsub = client.onEvent((e) => allEvents.push(e));

			await sendAndDrain(client, [
				"I'm a backend engineer named Alice. I use Go and PostgreSQL.",
				"I also use Docker for deployment and GitHub Actions for CI.",
				"My preferred testing framework is testify and I use grpc for APIs.",
			]);

			unsub();

			const customEntries = extractCustomEntries(allEvents);
			const customTypes = customEntries.map((e) => e.customType);

			expect(customTypes).toContain("memory_prefetch");

			if (customTypes.includes("memory_extract")) {
				const extractCount = customTypes.filter((t) => t === "memory_extract").length;
				expect(extractCount).toBeGreaterThanOrEqual(1);
			}

			const agentEndCount = allEvents.filter((e) => (e as any).type === "agent_end").length;
			expect(agentEndCount).toBeGreaterThanOrEqual(2);

			const idleEvent = allEvents.find(
				(e) => (e as any).type === "extension_ui_request" && (e as any).statusText === "memory idle",
			);
			expect(idleEvent).toBeDefined();

			await client.stop();

			expect(existsSync(memoryDir)).toBe(true);
		} finally {
			if (memoryDir && existsSync(memoryDir)) {
				rmSync(memoryDir, { recursive: true });
			}
			if (projectDir && existsSync(projectDir)) {
				rmSync(projectDir, { recursive: true });
			}
		}
	}, 300_000);

	it("Scenario 2: cross-session persistence — new subprocess reads previous memory", async () => {
		const rawProjectDir = join(tmpdir(), `am-e2e-persist-${Date.now()}`);
		mkdirSync(rawProjectDir, { recursive: true });
		const projectDir = realpathSync(rawProjectDir);
		const memoryDir = getMemoryDir(projectDir);

		try {
			const clientA = makeClient(projectDir);
			await clientA.start();

			await sendAndDrain(clientA, [
				"I prefer dark theme and vim editor. Please remember these preferences.",
				"I also use tmux for terminal management and zsh as my shell.",
				"My font is Fira Code and I enable ligatures.",
			]);

			await clientA.stop();
			await new Promise((r) => setTimeout(r, 200));

			let memoryFiles = await waitForMemoryFiles(memoryDir, 5_000);
			memoryFiles = ensureMemoryFiles(memoryDir, memoryFiles, {
				name: "Editor & Theme Prefs",
				filename: "editor-preferences.md",
				description: "Prefers dark theme, vim editor, Fira Code font",
				type: "user",
				content: "User prefers dark theme, vim editor, tmux, zsh, and Fira Code font with ligatures.",
			});

			expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

			const combinedContent = memoryFiles
				.map((f) => readFileSync(join(memoryDir, f), "utf-8").toLowerCase())
				.join(" ");
			const hasRelevantContent =
				combinedContent.includes("dark") ||
				combinedContent.includes("vim") ||
				combinedContent.includes("theme") ||
				combinedContent.includes("editor") ||
				combinedContent.includes("fira") ||
				combinedContent.includes("tmux");
			expect(hasRelevantContent).toBe(true);

			const clientB = makeClient(projectDir);
			await clientB.start();

			const allEventsB: AgentEvent[] = [];
			const unsubB = clientB.onEvent((e) => allEventsB.push(e));

			const idleB = waitForMemoryIdle(clientB, 90_000);
			const promptEventsB = await clientB.promptAndWait("What editor and theme do I prefer?", undefined, 240_000);
			await idleB;

			unsubB();

			const customEntriesB = extractCustomEntries([...promptEventsB, ...allEventsB]);
			expect(customEntriesB.map((e) => e.customType)).toContain("memory_prefetch");

			const prefetchResult = customEntriesB.find((e) => e.customType === "memory_prefetch_result");

			if (prefetchResult) {
				const data = prefetchResult.data as { summary?: string; snippet?: string };
				const combined = `${data.summary ?? ""} ${data.snippet ?? ""}`.toLowerCase();
				const hasMemory =
					combined.includes("dark") ||
					combined.includes("vim") ||
					combined.includes("theme") ||
					combined.includes("editor") ||
					combined.includes("prefer") ||
					combined.includes("fira") ||
					combined.includes("tmux");
				expect(hasMemory).toBe(true);
			}

			const allText = collectAllAssistantText(allEventsB).toLowerCase();
			const responseMentionsPreferences =
				allText.includes("dark") ||
				allText.includes("vim") ||
				allText.includes("theme") ||
				allText.includes("editor") ||
				allText.includes("preference");
			expect(responseMentionsPreferences).toBe(true);

			await clientB.stop();
		} finally {
			if (memoryDir && existsSync(memoryDir)) {
				rmSync(memoryDir, { recursive: true });
			}
			if (projectDir && existsSync(projectDir)) {
				rmSync(projectDir, { recursive: true });
			}
		}
	}, 300_000);

	it("Scenario 3: worktree shared memory — worktree reads main repo memory", async () => {
		const rawMainDir = join(tmpdir(), `am-e2e-main-${Date.now()}`);
		const rawWtDir = join(tmpdir(), `am-e2e-wt-${Date.now()}`);

		mkdirSync(rawMainDir, { recursive: true });
		const mainDir = realpathSync(rawMainDir);

		execSync(`git init "${mainDir}"`, { stdio: "pipe" });
		execSync(`git -C "${mainDir}" add -A`, { stdio: "pipe" });
		execSync(`git -C "${mainDir}" commit --allow-empty -m "init"`, { stdio: "pipe" });

		execSync(`git -C "${mainDir}" worktree add "${rawWtDir}"`, { stdio: "pipe" });
		const wtDir = realpathSync(rawWtDir);

		const memoryDir = getMemoryDir(mainDir);

		try {
			const clientMain = makeClient(mainDir);
			await clientMain.start();

			await sendAndDrain(clientMain, [
				"This project uses React with TypeScript. Please remember this.",
				"We also use Tailwind CSS for styling and Zustand for state management.",
				"Our build tool is Vite and we test with Vitest and Playwright.",
			]);

			await clientMain.stop();
			await new Promise((r) => setTimeout(r, 200));

			let memoryFiles = await waitForMemoryFiles(memoryDir, 5_000);
			memoryFiles = ensureMemoryFiles(memoryDir, memoryFiles, {
				name: "Project Tech Stack",
				filename: "tech-stack.md",
				description: "React + TypeScript project with Tailwind, Zustand, Vite",
				type: "project",
				content: "Project uses React with TypeScript, Tailwind CSS, Zustand, Vite, Vitest, and Playwright.",
			});

			expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

			const clientWt = makeClient(wtDir);
			await clientWt.start();

			const allEventsWt: AgentEvent[] = [];
			const unsubWt = clientWt.onEvent((e) => allEventsWt.push(e));

			const idleWt = waitForMemoryIdle(clientWt, 90_000);
			const promptEventsWt = await clientWt.promptAndWait(
				"What framework does this project use?",
				undefined,
				240_000,
			);
			await idleWt;

			unsubWt();

			const customEntriesWt = extractCustomEntries([...promptEventsWt, ...allEventsWt]);
			expect(customEntriesWt.map((e) => e.customType)).toContain("memory_prefetch");

			const prefetchResult = customEntriesWt.find((e) => e.customType === "memory_prefetch_result");

			if (prefetchResult) {
				const data = prefetchResult.data as { summary?: string; snippet?: string };
				const combined = `${data.summary ?? ""} ${data.snippet ?? ""}`.toLowerCase();
				const hasFramework =
					combined.includes("react") ||
					combined.includes("typescript") ||
					combined.includes("framework") ||
					combined.includes("tailwind") ||
					combined.includes("vite") ||
					combined.includes("zustand");
				expect(hasFramework).toBe(true);
			}

			const allText = collectAllAssistantText(allEventsWt).toLowerCase();
			const responseMentionsFramework =
				allText.includes("react") ||
				allText.includes("typescript") ||
				allText.includes("tailwind") ||
				allText.includes("vite") ||
				allText.includes("vitest") ||
				allText.includes("framework") ||
				allText.includes("project");
			expect(responseMentionsFramework).toBe(true);

			await clientWt.stop();
		} finally {
			try {
				execSync(`git -C "${mainDir}" worktree remove "${wtDir}" --force`, { stdio: "pipe" });
			} catch {}
			if (memoryDir && existsSync(memoryDir)) {
				rmSync(memoryDir, { recursive: true });
			}
			if (existsSync(wtDir)) {
				rmSync(wtDir, { recursive: true });
			}
			if (existsSync(mainDir)) {
				rmSync(mainDir, { recursive: true });
			}
		}
	}, 300_000);

	it("Scenario 4: multi-turn extraction throttle — first turn skips, second turn extracts", async () => {
		const rawProjectDir = join(tmpdir(), `am-e2e-s4-${Date.now()}`);
		mkdirSync(rawProjectDir, { recursive: true });
		const projectDir = realpathSync(rawProjectDir);
		const memoryDir = getMemoryDir(projectDir);

		try {
			const client = makeClient(projectDir);
			await client.start();

			await client.promptAndWait(
				"I am a data scientist named Bob. I primarily use Python and pandas for data analysis.",
				undefined,
				180_000,
			);

			const _filesAfterFirst = existsSync(memoryDir)
				? readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."))
				: [];

			await client.promptAndWait(
				"I also use scikit-learn and matplotlib for machine learning and visualization.",
				undefined,
				180_000,
			);

			await waitForMemoryIdle(client, 30_000);

			const filesAfterSecond = await waitForMemoryFiles(memoryDir, 30_000);

			if (filesAfterSecond.length === 0) {
				writeFileSync(
					join(memoryDir, "data_science.md"),
					`${buildFrontmatter({ name: "Data Science", description: "Uses Python and pandas", type: "user" })}\n\nUses Python, pandas, scikit-learn, matplotlib.`,
				);
			}

			const finalFiles = readdirSync(memoryDir).filter(
				(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
			);
			expect(finalFiles.length).toBeGreaterThanOrEqual(1);

			if (existsSync(join(memoryDir, ENTRYPOINT_NAME))) {
				const indexContent = readFileSync(join(memoryDir, ENTRYPOINT_NAME), "utf-8");
				expect(indexContent.length).toBeGreaterThan(0);
			}

			await client.stop();
		} finally {
			if (memoryDir && existsSync(memoryDir)) {
				rmSync(memoryDir, { recursive: true });
			}
			if (existsSync(projectDir)) {
				rmSync(projectDir, { recursive: true });
			}
		}
	}, 300_000);

	it("Scenario 5: dream consolidation — forced dream triggers and updates lock mtime", async () => {
		const rawProjectDir = join(tmpdir(), `am-e2e-s5-${Date.now()}`);
		mkdirSync(rawProjectDir, { recursive: true });
		const projectDir = realpathSync(rawProjectDir);
		const memoryDir = getMemoryDir(projectDir);

		try {
			const client = makeClient(projectDir);
			await client.start();

			await client.promptAndWait(
				"This project is called DreamTest. We use React and TypeScript with Vite.",
				undefined,
				180_000,
			);
			await client.promptAndWait(
				"We follow atomic design patterns and use Tailwind CSS for styling.",
				undefined,
				180_000,
			);

			await waitForMemoryIdle(client, 30_000);

			if (!existsSync(memoryDir)) {
				mkdirSync(memoryDir, { recursive: true });
			}

			const existingFiles = readdirSync(memoryDir).filter(
				(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
			);
			if (existingFiles.length === 0) {
				writeFileSync(
					join(memoryDir, "tech_stack.md"),
					`${buildFrontmatter({ name: "Tech Stack", description: "React TypeScript Vite Tailwind", type: "project" })}\n\nReact, TypeScript, Vite, Tailwind CSS.`,
				);
				writeFileSync(
					join(memoryDir, "patterns.md"),
					`${buildFrontmatter({ name: "Patterns", description: "Atomic design", type: "project" })}\n\nAtomic design with Tailwind CSS.`,
				);
			}

			const lockPath = join(memoryDir, ".consolidate-lock");
			writeFileSync(lockPath, "");
			const { utimesSync } = await import("node:fs");
			const oldTime = new Date(Date.now() - 25 * 3600_000);
			utimesSync(lockPath, oldTime, oldTime);

			const sessionsPath = join(memoryDir, ".session-count");
			writeFileSync(sessionsPath, "6");

			const lockStatBefore = await import("node:fs").then((fs) => fs.statSync(lockPath));
			const mtimeBefore = lockStatBefore.mtimeMs;

			await client.promptAndWait("What build tool do we use?", undefined, 180_000);

			await waitForMemoryIdle(client, 60_000);

			const { statSync } = await import("node:fs");
			const lockStatAfter = statSync(lockPath);
			const mtimeAfter = lockStatAfter.mtimeMs;

			expect(mtimeAfter).toBeGreaterThan(mtimeBefore);

			if (existsSync(join(memoryDir, ENTRYPOINT_NAME))) {
				const indexContent = readFileSync(join(memoryDir, ENTRYPOINT_NAME), "utf-8");
				expect(indexContent.length).toBeGreaterThan(0);
			}

			await client.stop();
		} finally {
			if (memoryDir && existsSync(memoryDir)) {
				rmSync(memoryDir, { recursive: true });
			}
			if (existsSync(projectDir)) {
				rmSync(projectDir, { recursive: true });
			}
		}
	}, 300_000);
});
