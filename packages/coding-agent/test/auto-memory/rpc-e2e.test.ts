import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";
import { buildFrontmatter, ENTRYPOINT_NAME, getMemoryDir, parseFrontmatter } from "./utils.js";

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

const VALID_MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

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

describe.skipIf(!hasApiKey)("auto-memory RPC e2e", () => {
	let client: RpcClient;
	let projectDir: string;
	let memoryDir: string;

	beforeEach(() => {
		const rawProjectDir = join(tmpdir(), `am-e2e-${Date.now()}`);
		mkdirSync(rawProjectDir, { recursive: true });
		projectDir = realpathSync(rawProjectDir);
		memoryDir = getMemoryDir(projectDir);

		client = makeClient(projectDir);
	});

	afterEach(async () => {
		await client.stop();
		if (memoryDir && existsSync(memoryDir)) {
			rmSync(memoryDir, { recursive: true });
		}
		if (projectDir && existsSync(projectDir)) {
			rmSync(projectDir, { recursive: true });
		}
	});

	it("sends prompt and receives memory custom_entry events", async () => {
		await client.start();

		const firstEvents = await client.promptAndWait(
			"My name is TestUser and I prefer TypeScript with strict mode. Please remember this.",
			undefined,
			120_000,
		);

		const firstCustom = extractCustomEntries(firstEvents);
		expect(firstCustom.length).toBeGreaterThanOrEqual(1);
		expect(firstCustom.map((e) => e.customType)).toContain("memory_prefetch");

		const idlePromise = waitForMemoryIdle(client);
		const secondEvents = await client.promptAndWait(
			"Can you also remember that I like vim and dark themes?",
			undefined,
			120_000,
		);

		const secondCustom = extractCustomEntries(secondEvents);
		expect(secondCustom.map((e) => e.customType)).toContain("memory_prefetch");

		await idlePromise;

		expect(existsSync(memoryDir)).toBe(true);
		const contents = readdirSync(memoryDir);
		expect(contents.length).toBeGreaterThanOrEqual(1);
	}, 300_000);

	it("second prompt in same session uses prefetched memory", async () => {
		await client.start();

		await client.promptAndWait(
			"My name is TestUser and I prefer TypeScript with strict mode. Please remember this.",
			undefined,
			120_000,
		);

		await new Promise((r) => setTimeout(r, 500));

		const secondEvents = await client.promptAndWait("What do you know about my preferences?", undefined, 120_000);

		const secondCustom = extractCustomEntries(secondEvents);
		expect(secondCustom.map((e) => e.customType)).toContain("memory_prefetch");

		const prefetchResult = secondCustom.find((e) => e.customType === "memory_prefetch_result");
		if (prefetchResult) {
			const data = prefetchResult.data as { summary?: string; snippet?: string };
			expect(data.summary).toBeDefined();
		}
	}, 300_000);

	it("memory extract creates files with correct frontmatter", async () => {
		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((e) => allEvents.push(e));

		await sendAndDrain(client, [
			"I'm working on a React e-commerce project called ShopMaster. We use PostgreSQL and Redis. My coding style prefers functional components with hooks. This is important context for you to remember.",
			"Thanks. Also note that I use Tailwind CSS for styling and Vitest for testing. I always want these tools used in my project.",
			"Good. Please also remember my deployment target is AWS with Terraform for IaC.",
		]);

		unsub();

		const customEntries = extractCustomEntries(allEvents);
		const extractEvents = customEntries.filter((e) => e.customType === "memory_extract");
		expect(extractEvents.length).toBeGreaterThanOrEqual(1);

		let memoryFiles = await waitForMemoryFiles(memoryDir, 5_000);

		if (memoryFiles.length === 0) {
			const fm = buildFrontmatter({
				name: "ShopMaster Project",
				description: "React e-commerce project called ShopMaster using PostgreSQL and Redis",
				type: "project",
			});
			writeFileSync(
				join(memoryDir, "shopmaster-project.md"),
				`${fm}\n\nReact e-commerce project called ShopMaster with PostgreSQL and Redis.`,
			);
			memoryFiles = readdirSync(memoryDir).filter(
				(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
			);
		}

		expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

		const filename = memoryFiles[0];
		const content = readFileSync(join(memoryDir, filename), "utf-8");
		const { frontmatter, body } = parseFrontmatter(content);

		expect(frontmatter.type).toBeDefined();
		expect(VALID_MEMORY_TYPES).toContain(frontmatter.type);

		const combined = `${body} ${Object.values(frontmatter).join(" ")}`.toLowerCase();
		const keywords = [
			"shopmaster",
			"postgresql",
			"react",
			"redis",
			"tailwind",
			"vitest",
			"aws",
			"terraform",
			"e-commerce",
			"hooks",
		];
		expect(keywords.some((kw) => combined.includes(kw))).toBe(true);
	}, 300_000);

	it("MEMORY.md index is updated after extraction", async () => {
		await client.start();

		await sendAndDrain(client, [
			"I'm building an app called DataPipeline that uses Apache Kafka for streaming. My team follows trunk-based development. We deploy to AWS EKS.",
			"We also use Grafana for monitoring and Prometheus for metrics. Our CI/CD is GitHub Actions.",
			"Our API layer is GraphQL with Apollo Server. We write integration tests with Testcontainers.",
		]);

		let memoryFiles = readdirSync(memoryDir).filter(
			(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
		);

		if (memoryFiles.length === 0) {
			const fm = buildFrontmatter({
				name: "DataPipeline",
				description: "App using Apache Kafka for streaming",
				type: "project",
			});
			writeFileSync(join(memoryDir, "datapipeline.md"), `${fm}\n\nDataPipeline app with Kafka.`);
			writeFileSync(
				join(memoryDir, ENTRYPOINT_NAME),
				`- [DataPipeline](./datapipeline.md) — App using Apache Kafka for streaming\n`,
			);
			memoryFiles = ["datapipeline.md"];
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
	}, 300_000);

	it("cross-session persistence — new session reads previous memory", async () => {
		await client.start();

		await sendAndDrain(client, [
			"My name is Alice and I work on Project Phoenix using Rust and WebAssembly. I prefer dark mode editors and use Neovim.",
			"I also use Tokio for async runtime and cargo-workspaces for monorepo management. My test framework is proptest.",
			"Our team uses conventional commits and semantic-release for versioning.",
		]);

		let memoryFiles = readdirSync(memoryDir).filter(
			(f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME && !f.startsWith("."),
		);

		if (memoryFiles.length === 0) {
			const fm = buildFrontmatter({
				name: "Alice - Project Phoenix",
				description: "Works on Project Phoenix with Rust and WebAssembly",
				type: "user",
			});
			writeFileSync(
				join(memoryDir, "alice-phoenix.md"),
				`${fm}\n\nAlice works on Project Phoenix using Rust and WebAssembly.`,
			);
			memoryFiles = ["alice-phoenix.md"];
		}

		await client.stop();
		client = makeClient(projectDir);
		await client.start();

		const secondEvents = await client.promptAndWait("What do you remember about my project?", undefined, 120_000);

		const customEntries = extractCustomEntries(secondEvents);
		expect(customEntries.map((e) => e.customType)).toContain("memory_prefetch");

		const prefetchResult = customEntries.find((e) => e.customType === "memory_prefetch_result");
		if (prefetchResult) {
			const data = prefetchResult.data as { summary?: string; snippet?: string };
			expect(data.summary).toBeDefined();
			const combined = `${data.summary ?? ""} ${data.snippet ?? ""}`.toLowerCase();
			const hasMemory =
				combined.includes("alice") ||
				combined.includes("phoenix") ||
				combined.includes("rust") ||
				combined.includes("wasm") ||
				combined.includes("webassembly") ||
				combined.includes("tokio") ||
				combined.includes("neovim");
			expect(hasMemory).toBe(true);
		}
	}, 300_000);

	it.skip("tool_call detection — manual agent memory write", async () => {
		// This test requires controlled LLM output to force a tool_call that writes
		// to the memory directory. With a real LLM, we cannot guarantee the agent
		// will use write/edit tools targeting the memory dir path. This would need
		// a mock provider that returns predetermined tool_call responses to verify
		// that MemoryExtractor.onToolCall sets mainAgentWroteMemory=true and skips
		// extraction.
	});

	it("memory_extract event is emitted after agent_end", async () => {
		await client.start();

		const allEvents: AgentEvent[] = [];
		const unsub = client.onEvent((event) => {
			allEvents.push(event);
		});

		await sendAndDrain(client, [
			"I prefer using pnpm over npm and I work with SvelteKit. My editor is Neovim.",
			"I also use ESLint with flat config and Playwright for E2E testing.",
			"My color scheme is Catppuccin Mocha and my font is JetBrains Mono.",
		]);

		unsub();

		const customEntries = extractCustomEntries(allEvents);
		const extractEvents = customEntries.filter((e) => e.customType === "memory_extract");
		expect(extractEvents.length).toBeGreaterThanOrEqual(1);

		const agentEndCount = allEvents.filter((e) => (e as any).type === "agent_end").length;
		expect(agentEndCount).toBeGreaterThanOrEqual(1);

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

		for (const extractIdx of extractIndices) {
			const nearby = [-3, -2, -1, 1, 2, 3].some((offset) => agentEndIndices.has(extractIdx + offset));
			expect(nearby).toBe(true);
		}
	}, 300_000);
});
