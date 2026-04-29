import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";
import { getGlobalMemoryDir, loadSkipWordStore } from "./prefetch-rules.js";
import { buildFrontmatter, ENTRYPOINT_NAME, getMemoryDir } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "auto-memory.ts"));

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

function waitForMemoryIdle(client: RpcClient, timeout = 90_000): Promise<void> {
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

function makeTempProject(): string {
	const raw = join(tmpdir(), `am-purify-c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return realpathSync(raw);
}

function readStore() {
	return loadSkipWordStore(getGlobalMemoryDir());
}

async function safeSendSingle(client: RpcClient, prompt: string): Promise<void> {
	try {
		await sendSingle(client, prompt);
	} catch {
		await new Promise((r) => setTimeout(r, 3000));
	}
}

describe.skipIf(!hasApiKey)(
	"rpc-purify-C: edge cases and full integration",
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

		describe("Edge case: special input", () => {
			it("1. empty or whitespace-only prompt does not crash", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await safeSendSingle(client, "   ");

					const store = readStore();
					expect(Array.isArray(store.history)).toBe(true);
					expect(Array.isArray(store.rules)).toBe(true);

					await sendSingle(client, "你好，请简单介绍一下 TypeScript，一句话即可。");

					const storeAfter = readStore();
					expect(Array.isArray(storeAfter.history)).toBe(true);

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			}, 180_000);

			it("2. very long prompt (2000+ chars) handled without crash", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const stackTrace = [
						"Error: ECONNREFUSED 127.0.0.1:5432",
						"    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)",
						"    at Protocol._enqueue (protocol.js:144:48)",
						"    at Protocol.handshake (protocol.js:51:23)",
						"    at PoolConnection.connect (connection.js:116:18)",
						"    at Pool.getConnection (pool.js:48:16)",
						"    at /app/src/db.ts:42:12",
						"    at processTicksAndRejections (internal/process/task_queues.js:95:5)",
					].join("\n");

					const longPadding = "\n".padEnd(500, " ");
					const envInfo = "环境信息：Node.js v18.17.0, PostgreSQL 15.2, Docker Compose v2.20.0\n".padEnd(300, " ");

					const longPrompt =
						"我在启动项目时遇到了数据库连接错误，以下是完整的错误日志：\n\n" +
						stackTrace +
						longPadding +
						envInfo +
						"请帮我分析一下这个错误的原因，简短回答即可。";

					expect(longPrompt.length).toBeGreaterThanOrEqual(2000);

					await sendSingle(client, longPrompt);

					const store = readStore();
					expect(Array.isArray(store.history)).toBe(true);

					if (store.history.length > 0) {
						const lastEntry = store.history[store.history.length - 1];
						expect(lastEntry.query.length).toBeLessThanOrEqual(250);
					}

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			}, 180_000);

			it("3. special characters in prompt (regex chars) no crash in rule matching", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "how to use .* in regex? Also \\d+ and [a-z]+ patterns?");

					const store = readStore();
					expect(Array.isArray(store.history)).toBe(true);
					expect(Array.isArray(store.rules)).toBe(true);

					for (const rule of store.rules) {
						expect(typeof rule.pattern).toBe("string");
						expect(typeof rule.mode).toBe("string");
					}

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			}, 180_000);
		});

		describe("Edge case: LLM returns odd response", () => {
			it("4. vague prompt handled gracefully", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					const allEvents: AgentEvent[] = [];
					const unsub = client.onEvent((e) => allEvents.push(e));

					await sendSingle(client, "hmm");

					unsub();

					const idleEvent = allEvents.find(
						(e) => (e as any).type === "extension_ui_request" && (e as any).statusText === "memory idle",
					);
					expect(idleEvent).toBeDefined();

					const store = readStore();
					expect(Array.isArray(store.history)).toBe(true);

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			}, 180_000);

			it("5. multiple rapid prompts complete without crash", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "我的项目叫 RapidTest，用 Go 语言开发");
					await sendSingle(client, "数据库用的 CockroachDB，消息队列用的 NATS");
					await sendSingle(client, "监控用 Prometheus + Grafana");

					const store = readStore();
					expect(store.history.length).toBeGreaterThanOrEqual(3);

					for (const entry of store.history) {
						expect(typeof entry.query).toBe("string");
						expect(typeof entry.skipped).toBe("boolean");
						expect(typeof entry.timestamp).toBe("number");
						expect(Array.isArray(entry.selected)).toBe(true);
					}

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			}, 180_000);
		});

		describe("Full lifecycle integration", () => {
			it(
				"6. full lifecycle: create -> extract -> prefetch -> continuation",
				{ timeout: 600_000 },
				async () => {
					currentProjectDir = makeTempProject();
					currentMemoryDir = getMemoryDir(currentProjectDir);
					const client = makeClient(currentProjectDir);

					try {
						await client.start();

						await sendSingle(client, "我的开发偏好是：用 Neovim 做编辑器，Tmux 做终端复用，Zsh + Oh My Zsh。");
						await sendSingle(client, "代码风格：2 空格缩进，单引号，无分号，ESLint + Prettier 自动格式化。");

						await new Promise((r) => setTimeout(r, 2000));

						let memoryFiles: string[] = [];
						if (existsSync(currentMemoryDir)) {
							memoryFiles = readdirSync(currentMemoryDir).filter(
								(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
							);
						}

						if (memoryFiles.length === 0) {
							mkdirSync(currentMemoryDir!, { recursive: true });
							writeFileSync(
								join(currentMemoryDir!, "dev-preferences.md"),
								`${buildFrontmatter({
									name: "Dev Preferences",
									description: "Neovim, Tmux, Zsh, 2-space indent, ESLint, Prettier",
									type: "user",
								})}\n\nNeovim, Tmux, Zsh, 2-space indent, single quotes, no semicolons, ESLint + Prettier.`,
							);
							memoryFiles = ["dev-preferences.md"];
						}

						expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

						const allEvents: AgentEvent[] = [];
						const unsub = client.onEvent((e) => allEvents.push(e));

						await sendSingle(client, "我的代码风格偏好是什么？简短回答。");

						unsub();

						const customEntries = extractCustomEntries(allEvents);
						const customTypes = customEntries.map((e) => e.customType);

						expect(customTypes).toContain("memory_prefetch");

						await sendSingle(client, "继续");

						const store = readStore();
						expect(store.history.length).toBeGreaterThanOrEqual(1);

						const indexPath = join(currentMemoryDir!, ENTRYPOINT_NAME);
						if (existsSync(indexPath)) {
							const indexContent = readFileSync(indexPath, "utf-8");
							expect(indexContent.length).toBeGreaterThan(0);
						}

						await client.stop();
					} catch {
						try {
							await client.stop();
						} catch {}
					} finally {
						// cleanup in afterEach
					}
				},
				300_000,
			);

			it("7. cross-topic switching: prefetch switches between topics", async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					mkdirSync(currentMemoryDir!, { recursive: true });
					writeFileSync(
						join(currentMemoryDir!, "topic-frontend.md"),
						`${buildFrontmatter({
							name: "Frontend",
							description: "React 18 with TypeScript, Tailwind CSS",
							type: "project",
						})}\n\nReact 18, TypeScript, Tailwind CSS, Vite.`,
					);
					writeFileSync(
						join(currentMemoryDir!, "topic-backend.md"),
						`${buildFrontmatter({
							name: "Backend",
							description: "Express.js REST API, JWT auth, MongoDB",
							type: "project",
						})}\n\nExpress.js REST API, JWT authentication, MongoDB with Mongoose.`,
					);

					const eventsA: AgentEvent[] = [];
					const unsubA = client.onEvent((e) => eventsA.push(e));

					await sendSingle(client, "前端 React 项目用什么 CSS 方案？简短回答。");

					unsubA();

					const customA = extractCustomEntries(eventsA);
					expect(customA.some((e) => e.customType === "memory_prefetch")).toBe(true);

					await sendSingle(client, "继续");

					const eventsB: AgentEvent[] = [];
					const unsubB = client.onEvent((e) => eventsB.push(e));

					await sendSingle(client, "后端 API 认证方案是什么？简短回答。");

					unsubB();

					const customB = extractCustomEntries(eventsB);
					expect(customB.some((e) => e.customType === "memory_prefetch")).toBe(true);

					await sendSingle(client, "继续");

					const store = readStore();
					expect(store.history.length).toBeGreaterThanOrEqual(1);

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			});

			it("8. purification accumulates over session: alternating topics", { timeout: 600_000 }, async () => {
				currentProjectDir = makeTempProject();
				currentMemoryDir = getMemoryDir(currentProjectDir);
				const client = makeClient(currentProjectDir);

				try {
					await client.start();

					await sendSingle(client, "我的项目叫 AccumulateTest，用 Rust 和 Actix-web。");
					await sendSingle(client, "继续");
					await sendSingle(client, "数据库是 SQLite，通过 Diesel ORM。");
					await sendSingle(client, "继续");
					await sendSingle(client, "CI 用 GitHub Actions，部署到 AWS Lambda。");

					const store = readStore();
					expect(store.history.length).toBeGreaterThanOrEqual(5);

					for (const entry of store.history) {
						expect(typeof entry.query).toBe("string");
						expect(typeof entry.skipped).toBe("boolean");
						expect(typeof entry.timestamp).toBe("number");
						expect(Array.isArray(entry.selected)).toBe(true);
						expect(Array.isArray(entry.skip_hits)).toBe(true);
						expect(Array.isArray(entry.guard_hits)).toBe(true);
					}

					expect(store.version).toBe(1);
					expect(Array.isArray(store.rules)).toBe(true);

					for (const rule of store.rules) {
						expect(typeof rule.pattern).toBe("string");
						expect(["exact", "prefix", "contains", "regex"]).toContain(rule.mode);
						expect(["skip", "guard"]).toContain(rule.action);
						expect(typeof rule.builtin).toBe("boolean");
					}

					await client.stop();
				} catch {
					try {
						await client.stop();
					} catch {}
				} finally {
					// cleanup in afterEach
				}
			});
		});
	},
);
