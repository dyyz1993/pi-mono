import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildFrontmatter, ENTRYPOINT_NAME, getMemoryDir } from "../../extensions/auto-memory/utils.js";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "..", "..", "extensions", "auto-memory", "index.ts"));

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	existsSync(join(homedir(), ".pi/agent/models.json"));

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "zhipuai";
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.7";

interface CustomEntryEvent {
	type: "custom_entry";
	customType: string;
	data?: unknown;
	id: string;
}

function extractCustomEntries(events: AgentEvent[]): CustomEntryEvent[] {
	return events.filter((e: AgentEvent) => (e as any).type === "custom_entry") as unknown as CustomEntryEvent[];
}

function waitForMemoryIdle(client: RpcClient, timeout = 180_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsub();
			reject(new Error(`Timeout (${timeout}ms) waiting for memory idle`));
		}, timeout);
		const unsub = client.onEvent((event) => {
			const e = event as any;
			if (e.type === "extension_ui_request" && e.statusText === "memory idle") {
				clearTimeout(timer);
				unsub();
				resolve();
			}
		});
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

function makeTempProject(): string {
	const raw = join(tmpdir(), `am-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return raw;
}

describe.skipIf(!hasApiKey)(
	"auto-memory RPC event coverage — full verification",
	{ sequential: true, timeout: 300_000 },
	() => {
		it("E1: agent LLM works + memory_prefetch fires unconditionally", async () => {
			const projectDir = makeTempProject();
			const client = makeClient(projectDir);
			try {
				await client.start();
				const events = await client.promptAndWait("Say exactly: HELLO_LLM_OK", undefined, 60_000);
				const agentEnd = events.find((e: any) => e.type === "agent_end");
				expect(agentEnd).toBeDefined();
				const messages = (agentEnd as any)?.messages;
				const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
				expect(
					lastAssistant?.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join(""),
				).toContain("HELLO_LLM_OK");

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));
				const idlePromise = waitForMemoryIdle(client, 60_000);
				await client.promptAndWait("What is 2+2?", undefined, 60_000);
				await idlePromise;
				unsub();

				const customEntries = extractCustomEntries(allEvents);
				const prefetch = customEntries.find((e) => e.customType === "memory_prefetch");
				expect(prefetch).toBeDefined();
				const data = prefetch!.data as { query: string; availableFiles: number };
				expect(data.query).toContain("2+2");
				expect(data.availableFiles).toBe(0);

				await client.stop();
			} finally {
				rmSync(projectDir, { recursive: true, force: true });
			}
		});

		it("E2: memory_prefetch_result fires when files exist and LLM selects them", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);
			try {
				await client.start();

				mkdirSync(memoryDir, { recursive: true });
				writeFileSync(
					join(memoryDir, "user-prefs.md"),
					`${buildFrontmatter({ name: "User Prefs", description: "Programming preferences", type: "user" })}\n\nPrefers TypeScript, React, and Vite for web development.`,
				);

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));
				const idlePromise = waitForMemoryIdle(client, 90_000);
				await client.promptAndWait(
					"What programming language and framework do I prefer for web dev?",
					undefined,
					120_000,
				);
				await idlePromise;
				unsub();

				const customEntries = extractCustomEntries(allEvents);
				const customTypes = customEntries.map((e) => e.customType);

				expect(customTypes).toContain("memory_prefetch");
				expect(customTypes).toContain("memory_prefetch_result");

				const prefetchResult = customEntries.find((e) => e.customType === "memory_prefetch_result")!;
				const data = prefetchResult.data as { injectedBytes: number; snippet: string };
				expect(data.injectedBytes).toBeGreaterThan(0);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				rmSync(projectDir, { recursive: true, force: true });
			}
		});

		it("E3: memory_extract fires after >=2 turns", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);
			try {
				await client.start();

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				const prompts = [
					"My project PurpleWave uses Vue 3 with Pinia for state and Vite for builds.",
					"We test with Vitest and Playwright. Follow strict TDD.",
					"Deploy to Vercel with preview envs for each PR.",
				];

				for (let i = 0; i < prompts.length; i++) {
					const idlePromise = waitForMemoryIdle(client, 180_000);
					await client.promptAndWait(prompts[i], undefined, 180_000);
					await idlePromise;
				}

				unsub();

				const customEntries = extractCustomEntries(allEvents);
				const extractEntry = customEntries.find((e) => e.customType === "memory_extract");

				const statusTexts = allEvents
					.filter((e) => (e as any).type === "extension_ui_request")
					.map((e) => (e as any).statusText);

				expect(statusTexts.some((s) => s === "extracting memories...")).toBe(true);
				expect(extractEntry).toBeDefined();

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				rmSync(projectDir, { recursive: true, force: true });
			}
		});

		it("E4: memory_extract creates files on disk", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);
			try {
				await client.start();

				const prompts = [
					"Project NeptuneAnalytics uses D3.js for data visualization and WebSockets for real-time updates.",
					"The backend is Node.js with Fastify. We use Redis for caching and PostgreSQL for persistence.",
					"CI/CD pipeline uses GitHub Actions with ECR for Docker images deployed to ECS.",
				];

				for (const prompt of prompts) {
					const idlePromise = waitForMemoryIdle(client, 180_000);
					await client.promptAndWait(prompt, undefined, 180_000);
					await idlePromise;
				}

				if (existsSync(memoryDir)) {
					const files = readdirSync(memoryDir).filter(
						(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
					);
					expect(files.length).toBeGreaterThanOrEqual(1);
				}

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				rmSync(projectDir, { recursive: true, force: true });
			}
		});

		it("E5: memory_dream triggers when conditions are met", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);
			try {
				await client.start();

				const idlePromise0 = waitForMemoryIdle(client, 180_000);
				await client.promptAndWait("Hello, say hi back in one word.", undefined, 120_000);
				await idlePromise0;

				mkdirSync(memoryDir, { recursive: true });
				writeFileSync(
					join(memoryDir, "dream-tech.md"),
					`${buildFrontmatter({ name: "Dream Tech", description: "Tech stack", type: "project" })}\n\nReact, TypeScript, Vite.`,
				);
				writeFileSync(
					join(memoryDir, "dream-testing.md"),
					`${buildFrontmatter({ name: "Dream Testing", description: "Testing stack", type: "project" })}\n\nVitest, Playwright.`,
				);

				const { statSync, utimesSync } = await import("node:fs");
				const lockPath = join(memoryDir, ".consolidate-lock");
				writeFileSync(lockPath, "");
				const oldTime = new Date(Date.now() - 25 * 3_600_000);
				utimesSync(lockPath, oldTime, oldTime);

				const sessionsPath = join(memoryDir, ".session-count");
				writeFileSync(sessionsPath, "6");

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				const idlePromise1 = waitForMemoryIdle(client, 180_000);
				await client.promptAndWait("What testing framework do we use?", undefined, 180_000);
				await idlePromise1;
				unsub();

				const statusTexts = allEvents
					.filter((e) => (e as any).type === "extension_ui_request")
					.map((e) => (e as any).statusText);

				expect(statusTexts).toContain("consolidating memories...");

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				rmSync(projectDir, { recursive: true, force: true });
			}
		});
	},
);
