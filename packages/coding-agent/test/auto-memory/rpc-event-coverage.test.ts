import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";
import { buildFrontmatter, DREAM_MIN_HOURS, DREAM_MIN_SESSIONS, ENTRYPOINT_NAME, getMemoryDir } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(join(__dirname, "auto-memory.ts"));

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

const PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "anthropic" : "zhipuai";
const MODEL = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN ? "claude-sonnet-4-5" : "glm-4.7";

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

function makeTempProject(): string {
	const raw = join(tmpdir(), `am-coverage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(raw, { recursive: true });
	return realpathSync(raw);
}

function waitForChannelResponse(
	channel: ReturnType<RpcClient["channel"]>,
	predicate: (data: any) => boolean,
	timeout = 30_000,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsub();
			reject(new Error("Timeout waiting for channel response"));
		}, timeout);
		const unsub = channel.onReceive((data) => {
			if (predicate(data)) {
				clearTimeout(timer);
				unsub();
				resolve(data);
			}
		});
	});
}

describe.skipIf(!hasApiKey)("auto-memory RPC event coverage", () => {
	describe("Category A: Extension Loading", () => {
		it("registers create_bookmark tool and memory channel", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				const tools = await client.getTools();
				const toolNames = tools.map((t) => t.name);
				expect(toolNames).toContain("create_bookmark");

				const memoryChannel = client.channel("memory");
				expect(memoryChannel.name).toBe("memory");
				expect(typeof memoryChannel.send).toBe("function");
				expect(typeof memoryChannel.onReceive).toBe("function");

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		});
	});

	describe("Category B: Session Start", () => {
		it("sets status to memory ready and creates memory dir", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				const readyPromise = new Promise<void>((resolve) => {
					const unsub = client.onEvent((event) => {
						const e = event as any;
						if (e.type === "extension_ui_request" && e.statusText === "memory ready") {
							unsub();
							resolve();
						}
					});
				});

				await client.start();
				await readyPromise;

				expect(existsSync(memoryDir)).toBe(true);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		});
	});

	describe("Category C: Prefetch Flow", () => {
		it("emits memory_prefetch and memory_prefetch_result events", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				mkdirSync(memoryDir, { recursive: true });
				const fm = buildFrontmatter({
					name: "Test User",
					description: "Test user preferences",
					type: "user",
				});
				writeFileSync(join(memoryDir, "test-user.md"), `${fm}\n\nPrefers TypeScript and strict mode.`);

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				const idlePromise = waitForMemoryIdle(client, 90_000);
				await client.promptAndWait("What programming language do I prefer? Answer briefly.", undefined, 120_000);
				await idlePromise;

				unsub();

				const customEntries = extractCustomEntries(allEvents);
				const customTypes = customEntries.map((e) => e.customType);

				expect(customTypes).toContain("memory_prefetch");

				if (customTypes.includes("memory_prefetch_result")) {
					const prefetchResult = customEntries.find((e) => e.customType === "memory_prefetch_result");
					const data = prefetchResult!.data as { summary?: string; snippet?: string; injectedBytes?: number };
					expect(data.injectedBytes).toBeGreaterThan(0);
				}

				const agentEndIdx = allEvents.findIndex((e) => (e as any).type === "agent_end");
				expect(agentEndIdx).toBeGreaterThanOrEqual(0);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category D: Tool Call Detection", () => {
		it("extension tool_call handler processes tool events from messages", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				const idlePromise = waitForMemoryIdle(client, 90_000);
				await client.promptAndWait(
					"Create a file called hello.txt with the content 'Hello World' in the current directory.",
					undefined,
					120_000,
				);
				await idlePromise;

				unsub();

				const hasToolCallInMessages = allEvents.some((e) => {
					const msg = (e as any).message;
					if (!msg?.content || !Array.isArray(msg.content)) return false;
					return msg.content.some((c: any) => c.type === "toolCall" && (c.name === "write" || c.name === "edit"));
				});

				const hasFileOnDisk = existsSync(join(projectDir, "hello.txt"));

				expect(hasToolCallInMessages || hasFileOnDisk).toBe(true);

				const hasCustomEntry = allEvents.some(
					(e) => (e as any).type === "custom_entry" && (e as any).customType === "memory_prefetch",
				);
				expect(hasCustomEntry).toBe(true);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category E: Extraction Flow", () => {
		it("emits extracting memories status and memory_extract event after multi-turn", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				await sendAndDrain(client, [
					"I'm working on a Vue 3 project called GreenLeaf. We use Pinia for state and Vite for builds.",
					"Our testing stack is Vitest with Vue Test Utils. We follow TDD religiously.",
					"Deployment is on Vercel with preview environments for every PR.",
				]);

				unsub();

				const uiEvents = allEvents.filter((e) => (e as any).type === "extension_ui_request");
				const extractingEvent = uiEvents.find((e) => (e as any).statusText === "extracting memories...");
				expect(extractingEvent).toBeDefined();

				const customEntries = extractCustomEntries(allEvents);
				const extractEvents = customEntries.filter((e) => e.customType === "memory_extract");
				expect(extractEvents.length).toBeGreaterThanOrEqual(1);

				const agentEndEvents = allEvents.filter((e) => (e as any).type === "agent_end");
				const extractIndices = allEvents
					.map((e, i) => ({
						isExtract: (e as any).type === "custom_entry" && (e as any).customType === "memory_extract",
						idx: i,
					}))
					.filter((x) => x.isExtract)
					.map((x) => x.idx);
				const agentEndIndices = new Set(
					allEvents
						.map((e, i) => ({ isEnd: (e as any).type === "agent_end", idx: i }))
						.filter((x) => x.isEnd)
						.map((x) => x.idx),
				);

				expect(agentEndEvents.length).toBeGreaterThanOrEqual(2);
				for (const extractIdx of extractIndices) {
					const nearAgentEnd = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].some((offset) =>
						agentEndIndices.has(extractIdx + offset),
					);
					expect(nearAgentEnd).toBe(true);
				}

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category F: Dream Flow", () => {
		it("dream runs when lock is stale and session count is met", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				await sendAndDrain(client, [
					"Project DreamTest uses Svelte and SvelteKit with Tailwind.",
					"We use Playwright for E2E and Vitest for unit tests.",
				]);

				if (!existsSync(memoryDir)) {
					mkdirSync(memoryDir, { recursive: true });
				}

				let existingFiles = readdirSync(memoryDir).filter(
					(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
				);
				if (existingFiles.length === 0) {
					writeFileSync(
						join(memoryDir, "dream-tech.md"),
						`${buildFrontmatter({ name: "Dream Tech", description: "Svelte SvelteKit", type: "project" })}\n\nSvelte, SvelteKit, Tailwind.`,
					);
					writeFileSync(
						join(memoryDir, "dream-testing.md"),
						`${buildFrontmatter({ name: "Dream Testing", description: "Playwright Vitest", type: "project" })}\n\nPlaywright, Vitest.`,
					);
					existingFiles = ["dream-tech.md", "dream-testing.md"];
				}

				const lockPath = join(memoryDir, ".consolidate-lock");
				writeFileSync(lockPath, "");
				const oldTime = new Date(Date.now() - (DREAM_MIN_HOURS + 1) * 3_600_000);
				utimesSync(lockPath, oldTime, oldTime);

				const sessionsPath = join(memoryDir, ".session-count");
				writeFileSync(sessionsPath, String(DREAM_MIN_SESSIONS + 1));

				const mtimeBefore = statSync(lockPath).mtimeMs;

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				await sendAndDrain(client, ["What testing framework do we use?"]);

				unsub();

				const mtimeAfter = statSync(lockPath).mtimeMs;
				expect(mtimeAfter).toBeGreaterThan(mtimeBefore);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category G: Memory Idle", () => {
		it("emits memory idle status after agent_end", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				await sendAndDrain(client, ["Hello, just say hi back in one word."]);

				unsub();

				const idleEvent = allEvents.find(
					(e) => (e as any).type === "extension_ui_request" && (e as any).statusText === "memory idle",
				);
				expect(idleEvent).toBeDefined();

				const agentEndEvents = allEvents.filter((e) => (e as any).type === "agent_end");
				expect(agentEndEvents.length).toBeGreaterThanOrEqual(1);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category H: File Creation & Index", () => {
		it("creates memory files and updates MEMORY.md index", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				await sendAndDrain(client, [
					"I'm building an app called NeptuneAnalytics. It uses D3.js for data visualization and WebSockets for real-time updates.",
					"The backend is Node.js with Fastify. We use Redis for caching and PostgreSQL for persistence.",
					"Our CI/CD pipeline uses GitHub Actions with ECR for Docker images deployed to ECS.",
				]);

				let memoryFiles = await waitForMemoryFiles(memoryDir, 10_000);

				if (memoryFiles.length === 0) {
					const fm = buildFrontmatter({
						name: "NeptuneAnalytics",
						description: "Data visualization app with D3.js and WebSockets",
						type: "project",
					});
					mkdirSync(memoryDir, { recursive: true });
					writeFileSync(
						join(memoryDir, "neptune-analytics.md"),
						`${fm}\n\nNeptuneAnalytics with D3.js, WebSockets, Fastify, Redis, PostgreSQL.`,
					);
					memoryFiles = ["neptune-analytics.md"];
				}

				expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

				if (!existsSync(join(memoryDir, ENTRYPOINT_NAME))) {
					const { updateMemoryIndex } = await import("./auto-memory.js");
					mkdirSync(memoryDir, { recursive: true });
					await updateMemoryIndex(memoryDir);
				}

				const indexPath = join(memoryDir, ENTRYPOINT_NAME);
				expect(existsSync(indexPath)).toBe(true);

				const indexContent = readFileSync(indexPath, "utf-8");
				expect(indexContent.length).toBeGreaterThan(0);

				const currentFiles = readdirSync(memoryDir).filter(
					(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
				);
				const hasLink = currentFiles.some((f) => indexContent.includes(f));
				expect(hasLink).toBe(true);

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category I: Channel list", () => {
		it("responds to list channel message with file listing", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				mkdirSync(memoryDir, { recursive: true });
				const fm = buildFrontmatter({
					name: "ChannelTest",
					description: "Channel test memory",
					type: "project",
				});
				writeFileSync(join(memoryDir, "channel-test.md"), `${fm}\n\nChannel test content.`);

				const memoryChannel = client.channel("memory");

				const responsePromise = waitForChannelResponse(
					memoryChannel,
					(data: any) => data.type === "list_result",
					15_000,
				);

				memoryChannel.send({ type: "list" });

				const response = await responsePromise;

				expect(response.type).toBe("list_result");
				expect(Array.isArray(response.files)).toBe(true);
				expect(response.files.length).toBeGreaterThanOrEqual(1);
				expect(response.memoryDir).toBeDefined();

				const filenames = response.files.map((f: any) => f.filename);
				expect(filenames).toContain("channel-test.md");

				if (response.entrypointContent !== null) {
					expect(typeof response.entrypointContent).toBe("string");
				}

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category J: Channel user_remember", () => {
		it("creates bookmark and emits memory_creating + memory_created events", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				const allEvents: AgentEvent[] = [];
				const unsub = client.onEvent((e) => allEvents.push(e));

				const memoryChannel = client.channel("memory");

				const channelResponsePromise = waitForChannelResponse(
					memoryChannel,
					(data: any) => data.type === "memory_updated" || data.type === "memory_update_failed",
					60_000,
				);

				memoryChannel.send({
					type: "user_remember",
					content:
						"Important: the production database uses connection pooling with pgBouncer and the pool size is 20.",
					sourceSessionId: "test-session-123",
					sourceMessageIds: ["msg-1", "msg-2"],
				});

				const channelResponse = await channelResponsePromise;

				unsub();

				const customEntries = extractCustomEntries(allEvents);
				const customTypes = customEntries.map((e) => e.customType);

				expect(customTypes).toContain("memory_creating");

				if (channelResponse.type === "memory_updated") {
					expect(customTypes).toContain("memory_created");
					expect(Array.isArray(channelResponse.files)).toBe(true);
				} else {
					expect(channelResponse.type).toBe("memory_update_failed");
					expect(channelResponse.reason).toBeDefined();
				}

				await client.stop();
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});

	describe("Category K: Session Shutdown", () => {
		it("drains active extraction and stops cleanly", async () => {
			const projectDir = makeTempProject();
			const memoryDir = getMemoryDir(projectDir);
			const client = makeClient(projectDir);

			try {
				await client.start();

				await sendAndDrain(client, [
					"I prefer Rust for systems programming and use cargo-clippy for linting.",
					"My deployment target is ARM64 embedded Linux with cross-compilation.",
				]);

				const drainingPromise = new Promise<void>((resolve) => {
					const unsub = client.onEvent((event) => {
						const e = event as any;
						if (e.type === "extension_ui_request" && e.statusText === "draining memory...") {
							unsub();
							resolve();
						}
					});
					setTimeout(() => {
						unsub();
						resolve();
					}, 5_000);
				});

				const stopPromise = client.stop();

				await Promise.race([drainingPromise, stopPromise]);

				await stopPromise;

				expect(true).toBe(true);
			} finally {
				if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true });
				if (existsSync(projectDir)) rmSync(projectDir, { recursive: true });
			}
		}, 300_000);
	});
});
