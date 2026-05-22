import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVIDER = "zhipuai-2";
const MODEL = "glm-5-flash";
const extensionPath = join(__dirname, "..", "..", "extensions", "claude-hooks-compat", "index.ts");
const cliPath = join(__dirname, "..", "..", "dist", "cli.js");

interface HookLogEntry {
	id: number;
	timestamp: number;
	durationMs: number;
	event: string;
	toolName: string;
	matcher: string;
	hookType: string;
	command: string;
	decision: string;
	reason: string;
	exitCode: number;
	source: string;
	snippet: string;
}

interface HookLogResult {
	entries: HookLogEntry[];
	ruleStats: unknown[];
	totalExecutions: number;
	configSnapshot: {
		sources: Array<{ path: string; scope: string; exists: boolean; disabled: boolean }>;
		events: Array<{
			name: string;
			groups: Array<{
				matcher: string;
				source: string;
				hooks: Array<{ type: string; command?: string; [key: string]: unknown }>;
			}>;
		}>;
	};
}

function createTempProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-hooks-channel-"));
	const claudeDir = join(dir, ".claude");
	mkdirSync(claudeDir, { recursive: true });

	writeFileSync(
		join(claudeDir, "settings.json"),
		JSON.stringify(
			{
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{
									type: "command",
									command: 'echo \'{"decision":"allow"}\'',
								},
							],
						},
					],
				},
			},
			null,
			2,
		),
		"utf-8",
	);

	writeFileSync(join(dir, "package.json"), '{"name":"hooks-channel-e2e-test"}', "utf-8");

	return dir;
}

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath,
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session", "--no-mcp"],
	});
}

describe.skipIf(!process.env.ZHIPUAI_API_KEY)(
	"hooks channel e2e",
	() => {
		let client: RpcClient;
		let projectDir: string;
		let ch: ReturnType<typeof client.channel>;

		beforeAll(async () => {
			projectDir = createTempProject();
			client = makeClient(projectDir);
			await client.start();
			ch = client.channel("hooks");
		}, 30_000);

		afterAll(async () => {
			await client.stop();
			if (projectDir && existsSync(projectDir)) {
				rmSync(projectDir, { recursive: true, force: true });
			}
		});

		it("hooks.getLog should return empty entries initially", async () => {
			const result = (await ch.call("hooks.getLog", { limit: 10 }, 10_000)) as HookLogResult;
			expect(result).toBeDefined();
			expect(Array.isArray(result.entries)).toBe(true);
			expect(result.entries).toHaveLength(0);
			expect(typeof result.totalExecutions).toBe("number");
		});

		it("after a tool call, hooks.getLog should return entries with hook execution", async () => {
			await client.promptAndWait("run: echo hello", undefined, 60_000);

			const result = (await ch.call("hooks.getLog", { limit: 10 }, 10_000)) as HookLogResult;
			expect(result.entries.length).toBeGreaterThanOrEqual(1);

			const preToolUseEntries = result.entries.filter((e) => e.event === "PreToolUse");
			expect(preToolUseEntries.length).toBeGreaterThanOrEqual(1);

			const entry = preToolUseEntries[0];
			expect(entry.toolName).toBe("Bash");
			expect(entry.decision).toBe("allow");
			expect(entry.hookType).toBe("command");
			expect(typeof entry.durationMs).toBe("number");
			expect(entry.durationMs).toBeGreaterThanOrEqual(0);
			expect(typeof entry.timestamp).toBe("number");
		}, 90_000);

		it("hooks.getConfig should return config snapshot with sources and events", async () => {
			const result = (await ch.call("hooks.getConfig", {}, 10_000)) as HookLogResult;
			expect(result).toBeDefined();
			expect(result.configSnapshot).toBeDefined();
			expect(Array.isArray(result.configSnapshot.sources)).toBe(true);

			const projectSources = result.configSnapshot.sources.filter((s) => s.scope === "project" && s.exists);
			expect(projectSources.length).toBeGreaterThanOrEqual(1);

			expect(Array.isArray(result.configSnapshot.events)).toBe(true);
			const preToolUseEvent = result.configSnapshot.events.find((e) => e.name === "PreToolUse");
			expect(preToolUseEvent).toBeDefined();
			expect(preToolUseEvent!.groups.length).toBeGreaterThanOrEqual(1);
			expect(preToolUseEvent!.groups[0].hooks.length).toBeGreaterThanOrEqual(1);
		});

		it("hooks.clear should clear the log and return { ok: true }", async () => {
			const clearResult = (await ch.call("hooks.clear", {}, 10_000)) as { ok: boolean };
			expect(clearResult).toEqual({ ok: true });

			const logResult = (await ch.call("hooks.getLog", { limit: 10 }, 10_000)) as HookLogResult;
			expect(logResult.entries).toHaveLength(0);
			expect(logResult.totalExecutions).toBe(0);
		});

		it("after clear, hooks.getLog should return empty entries", async () => {
			const result = (await ch.call("hooks.getLog", { limit: 10 }, 10_000)) as HookLogResult;
			expect(result.entries).toHaveLength(0);
		});
	},
	90_000,
);
