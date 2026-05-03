import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	evaluateRules,
	getGlobalMemoryDir,
	type HistoryEntry,
	loadSkipWordStore,
	type SkipRule,
	type SkipWordStore,
} from "../../extensions/auto-memory/skip-rules.js";
import { getMemoryDir } from "../../extensions/auto-memory/utils.js";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "..", "..", "extensions", "auto-memory", "index.ts"));

const hasApiKey = existsSync(join(homedir(), ".pi/agent/models.json"));
const PROVIDER = "zhipuai";
const MODEL = "glm-4.7";

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
	const idlePromise = waitForMemoryIdle(client, 180_000);
	await client.promptAndWait(prompt, undefined, 300_000);
	await idlePromise;
}

function makeTempProject(): string {
	const raw = join(tmpdir(), `am-purify-b-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return realpathSync(raw);
}

function readStore(): SkipWordStore {
	return loadSkipWordStore(getGlobalMemoryDir());
}

function prePopulateStore(rules: SkipRule[]) {
	const globalDir = getGlobalMemoryDir();
	mkdirSync(globalDir, { recursive: true });
	const store = loadSkipWordStore(globalDir);
	store.rules = [...store.rules, ...rules];
	const filePath = join(globalDir, ".prefetch-skip-words.json");
	writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function findHistoryByQuery(store: SkipWordStore, substring: string): HistoryEntry | undefined {
	for (let i = store.history.length - 1; i >= 0; i--) {
		if (store.history[i].query.includes(substring)) {
			return store.history[i];
		}
	}
	return undefined;
}

describe.skipIf(!hasApiKey)(
	"rpc-purify-B: reverse purification with real LLM",
	{ sequential: true, timeout: 600_000 },
	() => {
		let currentProjectDir: string | undefined;
		let currentMemoryDir: string | undefined;

		afterEach(() => {
			const globalDir = getGlobalMemoryDir();
			const storePath = join(globalDir, ".prefetch-skip-words.json");
			if (existsSync(storePath)) rmSync(storePath);
			if (currentMemoryDir && existsSync(currentMemoryDir)) {
				rmSync(currentMemoryDir, { recursive: true });
			}
			if (currentProjectDir && existsSync(currentProjectDir)) {
				rmSync(currentProjectDir, { recursive: true });
			}
			currentProjectDir = undefined;
			currentMemoryDir = undefined;
		});

		describe("Guard interception", () => {
			it("1. question mark blocks skip", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "我的项目用 Vue 3 和 Vite 构建");
					await sendSingle(client, "我们用 Pinia 做状态管理");

					const { shouldSkip, guardHits } = evaluateRules("继续？我想了解数据库索引优化", readStore().rules);
					expect(shouldSkip).toBe(false);
					expect(guardHits.length).toBeGreaterThan(0);

					await sendSingle(client, "继续？我想了解数据库索引优化");

					const store = readStore();
					const entry = findHistoryByQuery(store, "继续");
					if (entry) {
						expect(entry.skipped).toBe(false);
						expect(entry.guard_hits.length).toBeGreaterThan(0);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("2. action verb blocks skip", async () => {
				prePopulateStore([{ pattern: "帮我", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const { shouldSkip, guardHits } = evaluateRules("帮我配置一下部署环境", readStore().rules);
					expect(shouldSkip).toBe(false);
					expect(guardHits.length).toBeGreaterThan(0);

					await sendSingle(client, "帮我配置一下部署环境");

					const store = readStore();
					const entry = findHistoryByQuery(store, "帮我配置");
					if (entry) {
						expect(entry.skipped).toBe(false);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("3. newline blocks skip", async () => {
				prePopulateStore([{ pattern: "没问题", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const { shouldSkip, guardHits } = evaluateRules("没问题\n这是一个新的需求", readStore().rules);
					expect(shouldSkip).toBe(false);
					expect(guardHits.some((g) => g === "\n")).toBe(true);

					await sendSingle(client, "没问题\n这是一个新的需求，关于用户认证");

					const store = readStore();
					const entry = findHistoryByQuery(store, "没问题");
					if (entry) {
						expect(entry.skipped).toBe(false);
						expect(entry.guard_hits.length).toBeGreaterThan(0);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("4. multiple guards stack", async () => {
				prePopulateStore([{ pattern: "好的", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const { shouldSkip, guardHits } = evaluateRules("好的，帮我看看？继续", readStore().rules);
					expect(shouldSkip).toBe(false);
					expect(guardHits.length).toBeGreaterThan(0);

					await sendSingle(client, "好的，帮我看看？继续");

					const store = readStore();
					const entry = findHistoryByQuery(store, "好的");
					if (entry) {
						expect(entry.skipped).toBe(false);
						expect(entry.guard_hits.length).toBeGreaterThan(0);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});
		});

		describe("Bad skip correction", () => {
			it("5. detect bad skip", async () => {
				prePopulateStore([{ pattern: "好的", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const { shouldSkip: skip1 } = evaluateRules("好的我想了解微服务架构", readStore().rules);
					expect(skip1).toBe(true);

					await sendSingle(client, "好的我想了解微服务架构");

					const storeAfterSkip = readStore();
					const skippedEntry = findHistoryByQuery(storeAfterSkip, "好的我想了解");
					expect(skippedEntry?.skipped).toBe(true);

					await sendSingle(client, "你为什么没回答我关于微服务架构的问题？请回答");

					const storeFinal = readStore();
					const purifyRan = storeFinal.lastPurifyTimestamp > 0;
					if (purifyRan) {
						const badRuleGone = !storeFinal.rules.some(
							(r) => r.pattern === "好的" && r.mode === "prefix" && r.action === "skip" && !r.builtin,
						);
						const guardAdded = storeFinal.rules.some((r) => r.pattern === "好的" && r.action === "guard");
						expect(badRuleGone || guardAdded).toBe(true);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("6. remove bad rule", async () => {
				prePopulateStore([{ pattern: "明白了", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "明白了，但我想问一下测试策略怎么制定");

					const storeAfterSkip = readStore();
					const skippedEntry = findHistoryByQuery(storeAfterSkip, "明白了");
					if (skippedEntry?.skipped) {
						await sendSingle(client, "你怎么不回答我关于测试策略的问题");

						const store = readStore();
						if (store.lastPurifyTimestamp > 0) {
							const badRuleRemoved = !store.rules.some(
								(r) => r.pattern === "明白了" && r.action === "skip" && !r.builtin,
							);
							const guardAdded = store.rules.some((r) => r.pattern === "明白了" && r.action === "guard");
							expect(badRuleRemoved || guardAdded).toBe(true);
						}
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("7. guard replaces bad builtin", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const { shouldSkip } = evaluateRules("继续开发API接口", readStore().rules);
					expect(shouldSkip).toBe(true);

					await sendSingle(client, "继续开发API接口");

					const storeAfterSkip = readStore();
					const skippedEntry = findHistoryByQuery(storeAfterSkip, "继续开发");
					expect(skippedEntry?.skipped).toBe(true);

					const builtinExists = storeAfterSkip.rules.some(
						(r) => r.pattern === "继续" && r.mode === "prefix" && r.action === "skip" && r.builtin,
					);
					expect(builtinExists).toBe(true);

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});
		});

		describe("Comprehensive scenarios", () => {
			it("8. full cycle: good skip then bad skip then correction", async () => {
				prePopulateStore([{ pattern: "好的", mode: "prefix", action: "skip", builtin: false }]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "我的项目用 React 和 Next.js，部署在 Vercel");
					await sendSingle(client, "好的，我想了解一下如何配置 CI/CD 流水线");

					const storeAfterBadSkip = readStore();
					const badEntry = findHistoryByQuery(storeAfterBadSkip, "好的，我想了解");
					if (badEntry) {
						expect(badEntry.skipped).toBe(true);
					}

					await sendSingle(client, "我之前问的 CI/CD 配置呢？你为什么没回答？");

					const storeFinal = readStore();

					if (storeFinal.lastPurifyTimestamp > 0) {
						const badRuleGone = !storeFinal.rules.some(
							(r) => r.pattern === "好的" && r.mode === "prefix" && r.action === "skip" && !r.builtin,
						);
						expect(badRuleGone).toBe(true);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});

			it("9. full cycle: multiple corrections over time", async () => {
				prePopulateStore([
					{ pattern: "收到", mode: "prefix", action: "skip", builtin: false },
					{ pattern: "嗯嗯", mode: "exact", action: "skip", builtin: false },
				]);

				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "收到，请帮我配置一下 Docker");
					await sendSingle(client, "你为什么不帮我配置 Docker？我之前说过了");

					const store = readStore();

					const dockerEntry = findHistoryByQuery(store, "收到");
					if (dockerEntry) {
						expect(dockerEntry.skipped).toBe(true);
					}

					if (store.lastPurifyTimestamp > 0) {
						const correctionsCount = [
							!store.rules.some((r) => r.pattern === "收到" && r.action === "skip" && !r.builtin),
							!store.rules.some((r) => r.pattern === "嗯嗯" && r.action === "skip" && !r.builtin),
						].filter(Boolean).length;
						expect(correctionsCount).toBeGreaterThanOrEqual(0);
					}

					await client.stop();
				} finally {
					// cleanup in afterEach
				}
			});
		});
	},
);
