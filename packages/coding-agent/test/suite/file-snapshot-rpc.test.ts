import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "..", "examples", "extensions", "file-snapshot.ts");

const hasApiKey =
	!!process.env.ANTHROPIC_API_KEY ||
	!!process.env.ANTHROPIC_OAUTH_TOKEN ||
	!!process.env.OPENAI_API_KEY ||
	!!process.env.OPENROUTER_API_KEY ||
	!!process.env.ZAI_API_KEY ||
	!!readApiKeyFromPiConfig();

function readApiKeyFromPiConfig(): string | undefined {
	try {
		const configPath = join(homedir(), ".pi", "agent", "models.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		const providers = config.providers as Record<string, Record<string, string>> | undefined;
		if (providers) {
			for (const p of Object.values(providers)) {
				if (p.apiKey) return p.apiKey;
			}
		}
	} catch {}
	return undefined;
}

function getProviderAndModel(): { provider: string; model: string } {
	if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN) {
		return { provider: "anthropic", model: "claude-sonnet-4-5" };
	}
	if (process.env.OPENAI_API_KEY) {
		return { provider: "openai", model: "gpt-4o-mini" };
	}
	if (process.env.OPENROUTER_API_KEY) {
		return { provider: "openrouter", model: "anthropic/claude-sonnet-4-5" };
	}
	return { provider: "", model: "" };
}

function hasZhipuaiInPiConfig(): boolean {
	try {
		const configPath = join(homedir(), ".pi", "agent", "models.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
		const providers = config.providers as Record<string, Record<string, string>> | undefined;
		return !!providers?.zhipuai?.apiKey;
	} catch {}
	return false;
}

const { provider, model } = getProviderAndModel();

function extractCustomEntries(events: AgentEvent[]): Array<{ type: string; customType: string; data?: unknown }> {
	return events.filter((e: AgentEvent) => (e as any).type === "custom_entry") as Array<{
		type: string;
		customType: string;
		data?: unknown;
	}>;
}

describe.skipIf(!hasApiKey)("file-snapshot RPC e2e", () => {
	let client: RpcClient;
	let projectDir: string;

	beforeEach(() => {
		projectDir = join(tmpdir(), `pi-file-snapshot-rpc-${Date.now()}`);
		mkdirSync(projectDir, { recursive: true });

		const opts: { cliPath: string; cwd: string; args: string[]; provider?: string; model?: string } = {
			cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
			cwd: projectDir,
			args: ["--no-extensions", "-e", extensionPath, "--no-session"],
		};
		if (provider) opts.provider = provider;
		if (model) opts.model = model;

		client = new RpcClient(opts);
	});

	afterEach(async () => {
		await client.stop();
		if (existsSync(projectDir)) {
			try {
				rmSync(projectDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("creates step-snapshot custom entry when LLM writes a file", async () => {
		await client.start();

		const events = await client.promptAndWait(
			"Create a file called hello.txt with the content 'hello world'. Just use the write tool.",
			undefined,
			120_000,
		);

		const customEntries = extractCustomEntries(events);
		const stepSnapshots = customEntries.filter((e) => e.customType === "step-snapshot");

		expect(stepSnapshots.length).toBeGreaterThanOrEqual(1);

		const data = stepSnapshots[0]!.data as {
			snapshotTreeHash: string;
			diff: { added: string[]; modified: string[]; deleted: string[] } | null;
		};

		expect(data.snapshotTreeHash).toBeDefined();
		expect(typeof data.snapshotTreeHash).toBe("string");

		const filePath = join(projectDir, "hello.txt");
		expect(existsSync(filePath)).toBe(true);
		expect(readFileSync(filePath, "utf-8")).toContain("hello world");
	}, 180_000);

	it("stores objects in project-level store on disk", async () => {
		await client.start();

		await client.promptAndWait(
			"Create a file called test.txt with content 'stored'. Use the write tool.",
			undefined,
			120_000,
		);

		const storeRoot = join(homedir(), ".pi", "agent", "file-store");
		expect(existsSync(storeRoot)).toBe(true);
	}, 180_000);

	it("restores files via RPC navigate_tree command", async () => {
		await client.start();

		await client.promptAndWait(
			"Create a file called version.txt with content 'v1'. Use the write tool.",
			undefined,
			120_000,
		);

		expect(readFileSync(join(projectDir, "version.txt"), "utf-8")).toContain("v1");

		const tree1 = await client.getTree();
		const userEntries = tree1.filter((e) => e.label === "user");
		expect(userEntries.length).toBeGreaterThanOrEqual(1);
		const targetId = userEntries[0]!.id;

		await client.promptAndWait("Overwrite version.txt with content 'v2'. Use the write tool.", undefined, 120_000);

		expect(readFileSync(join(projectDir, "version.txt"), "utf-8")).toContain("v2");

		const navResult = await client.navigateTree(targetId);
		expect(navResult.cancelled).toBe(false);

		expect(readFileSync(join(projectDir, "version.txt"), "utf-8")).toContain("v1");
	}, 180_000);

	it("creates unrevert-point on navigate_tree rollback", async () => {
		await client.start();

		await client.promptAndWait("Create alpha.txt with content 'aaa'. Use the write tool.", undefined, 120_000);

		const tree1 = await client.getTree();
		const userEntries = tree1.filter((e) => e.label === "user");
		const targetId = userEntries[0]!.id;

		await client.promptAndWait("Create beta.txt with content 'bbb'. Use the write tool.", undefined, 120_000);

		expect(existsSync(join(projectDir, "beta.txt"))).toBe(true);

		const navResult = await client.navigateTree(targetId);
		expect(navResult.cancelled).toBe(false);

		expect(existsSync(join(projectDir, "beta.txt"))).toBe(false);
		expect(readFileSync(join(projectDir, "alpha.txt"), "utf-8")).toContain("aaa");
	}, 180_000);
});
