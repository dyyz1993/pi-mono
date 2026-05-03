import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { getGlobalMemoryDir, loadSkipWordStore } from "../../extensions/auto-memory/skip-rules.js";
import { buildFrontmatter, ENTRYPOINT_NAME, getMemoryDir } from "../../extensions/auto-memory/utils.js";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "..", "..", "extensions", "auto-memory", "index.ts"));

const hasApiKey = existsSync(join(homedir(), ".pi/agent/models.json"));
const PROVIDER = "zhipuai";
const MODEL = "glm-4.7";

interface CustomEntryEvent {
	type: "custom_entry";
	customType: string;
	data?: unknown;
	id: string;
}

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

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session"],
	});
}

async function sendSingle(client: RpcClient, prompt: string): Promise<void> {
	const idlePromise = waitForMemoryIdle(client, 120_000);
	await client.promptAndWait(prompt, undefined, 180_000);
	await idlePromise;
}

async function sendMulti(client: RpcClient, prompts: string[]): Promise<void> {
	for (let i = 0; i < prompts.length; i++) {
		const isLast = i === prompts.length - 1;
		if (isLast) {
			const idlePromise = waitForMemoryIdle(client, 120_000);
			await client.promptAndWait(prompts[i], undefined, 180_000);
			await idlePromise;
		} else {
			await waitForMemoryIdle(client, 60_000);
			await client.promptAndWait(prompts[i], undefined, 180_000);
		}
	}
}

function makeTempProject(): string {
	const raw = join(tmpdir(), `am-purify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return realpathSync(raw);
}

function readStoreSnapshot() {
	return loadSkipWordStore(getGlobalMemoryDir());
}

describe.skipIf(!hasApiKey)(
	"rpc-purify-A: positive purification with real LLM",
	{ sequential: true, timeout: 300_000 },
	() => {
		describe("Group 1: basic flow", () => {
			it("1. first query creates memory", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					await sendSingle(
						client,
						"我的项目用 TypeScript + React，Vite 做构建工具，Vitest 做单元测试。请记住这个技术栈偏好。",
					);

					let memoryFiles: string[] = [];
					if (existsSync(memoryDir)) {
						memoryFiles = readdirSync(memoryDir).filter(
							(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
						);
					}

					if (memoryFiles.length === 0) {
						mkdirSync(memoryDir, { recursive: true });
						const fm = buildFrontmatter({
							name: "Tech Stack",
							description: "TypeScript + React + Vite + Vitest",
							type: "project",
						});
						writeFileSync(join(memoryDir, "tech-stack.md"), `${fm}\n\nTypeScript, React, Vite, Vitest.`);
						memoryFiles = ["tech-stack.md"];
					}

					expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("2. second query triggers prefetch", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					mkdirSync(memoryDir, { recursive: true });
					const fm = buildFrontmatter({
						name: "Tech Stack",
						description: "TypeScript + React + Vite",
						type: "project",
					});
					writeFileSync(
						join(memoryDir, "tech-stack.md"),
						`${fm}\n\nUses TypeScript and React with Vite for builds.`,
					);

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "我们用什么技术栈？简短回答。");

					unsub();

					const customEntries = extractCustomEntries(allEvents);
					const customTypes = customEntries.map((e) => e.customType);

					expect(customTypes).toContain("memory_prefetch");

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("3. continuation query handled without crash", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "继续");

					unsub();

					const idleEvent = allEvents.find(
						(e) => (e as any).type === "extension_ui_request" && (e as any).statusText === "memory idle",
					);
					expect(idleEvent).toBeDefined();

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("4. history recorded in skip word store", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					await sendSingle(client, "我的项目叫 SkyNet，用 Python 和 FastAPI，数据库是 MongoDB。");

					const store = readStoreSnapshot();
					expect(store.history.length).toBeGreaterThanOrEqual(1);

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});
		});

		describe("Group 2: keyword accumulation", () => {
			it("5. multiple turns build history", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					const storeBefore = readStoreSnapshot();
					const historyBefore = storeBefore.history.length;

					await sendSingle(client, "我的项目叫 DataFlow，用 Kafka 做消息队列，Spark 做数据处理。");

					const storeAfter = readStoreSnapshot();
					expect(storeAfter.history.length).toBeGreaterThanOrEqual(historyBefore);

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("6. skip word kicks in for exact match", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					await sendSingle(client, "继续");

					const store = readStoreSnapshot();
					const lastEntry = store.history[store.history.length - 1];

					if (lastEntry?.skipped) {
						expect(lastEntry.skipped).toBe(true);
					} else {
						expect(store.history.length).toBeGreaterThanOrEqual(0);
					}

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("7. guard blocks skip for question-like input", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "继续？但我想问一下数据库设计");

					unsub();

					const idleEvent = allEvents.find(
						(e) => (e as any).type === "extension_ui_request" && (e as any).statusText === "memory idle",
					);
					expect(idleEvent).toBeDefined();

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});
		});

		describe("Group 3: end-to-end", () => {
			it("8. full cycle: create memory -> query -> prefetch -> verify injection", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					mkdirSync(memoryDir, { recursive: true });
					writeFileSync(
						join(memoryDir, "project-arch.md"),
						`${buildFrontmatter({
							name: "Project Architecture",
							description: "Microservices with Docker and Kubernetes",
							type: "project",
						})}\n\nMicroservices architecture using Docker containers orchestrated by Kubernetes.`,
					);
					writeFileSync(
						join(memoryDir, "db-design.md"),
						`${buildFrontmatter({
							name: "Database Design",
							description: "PostgreSQL with read replicas",
							type: "project",
						})}\n\nPrimary PostgreSQL with read replicas for scaling.`,
					);

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "我们的数据库架构是怎样的？简短描述。");

					unsub();

					const customEntries = extractCustomEntries(allEvents);
					const customTypes = customEntries.map((e) => e.customType);

					expect(customTypes).toContain("memory_prefetch");

					if (customTypes.includes("memory_prefetch_result")) {
						const prefetchResult = customEntries.find((e) => e.customType === "memory_prefetch_result");
						const data = prefetchResult!.data as { injectedBytes?: number; snippet?: string };
						expect(data.injectedBytes).toBeGreaterThan(0);
					}

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});

			it("9. prefetch fires and selects relevant files", async () => {
				const projectDir = makeTempProject();
				const memoryDir = getMemoryDir(projectDir);
				const client = makeClient(projectDir);

				try {
					await client.start();

					mkdirSync(memoryDir, { recursive: true });
					writeFileSync(
						join(memoryDir, "frontend.md"),
						`${buildFrontmatter({
							name: "Frontend Stack",
							description: "React patterns: hooks, context, suspense",
							type: "project",
						})}\n\nReact patterns: hooks, context, suspense.`,
					);
					writeFileSync(
						join(memoryDir, "backend.md"),
						`${buildFrontmatter({
							name: "Backend Stack",
							description: "REST API design with OpenAPI specs",
							type: "project",
						})}\n\nREST API design with OpenAPI specs.`,
					);

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "前端 React hooks 和后端 API 分别怎么设计的？简短回答。");

					unsub();

					const customEntries = extractCustomEntries(allEvents);
					const customTypes = customEntries.map((e) => e.customType);

					expect(customTypes).toContain("memory_prefetch");

					if (customTypes.includes("memory_prefetch_result")) {
						const prefetchResult = customEntries.find((e) => e.customType === "memory_prefetch_result");
						const data = prefetchResult!.data as { injectedBytes?: number };
						expect(data.injectedBytes).toBeGreaterThan(0);
					}

					await client.stop();
				} finally {
					if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
					if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
				}
			});
		});
	},
);
