import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("RPC extended commands", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-ext-test-${Date.now()}`);
		client = new RpcClient({
			cliPath: join(__dirname, "..", "dist", "cli.js"),
			cwd: join(__dirname, ".."),
			env: { PI_CODING_AGENT_DIR: sessionDir },
		});
	});

	afterEach(async () => {
		await client.stop();
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	// ========================================================================
	// Settings (跨层级: global / project / merged)
	// ========================================================================

	describe("get_settings", () => {
		test("should return merged settings when no scope specified", async () => {
			await client.start();
			const settings = await client.getSettings();

			expect(settings).toBeDefined();
			expect(typeof settings).toBe("object");
		}, 30000);

		test("should return global settings when scope is global", async () => {
			await client.start();
			const settings = await client.getSettings("global");

			expect(settings).toBeDefined();
			expect(typeof settings).toBe("object");
		}, 30000);

		test("should return project settings when scope is project", async () => {
			await client.start();
			const settings = await client.getSettings("project");

			expect(settings).toBeDefined();
			expect(typeof settings).toBe("object");
		}, 30000);
	});

	describe("set_settings", () => {
		test("should apply settings override without error", async () => {
			await client.start();

			await expect(client.setSettings({ hideThinkingBlock: true })).resolves.toBeUndefined();
		}, 30000);

		test("should apply settings to global scope without error", async () => {
			await client.start();

			await expect(client.setSettings({ hideThinkingBlock: false }, "global")).resolves.toBeUndefined();
		}, 30000);
	});

	// ========================================================================
	// Context Usage (会话级)
	// ========================================================================

	describe("get_context_usage", () => {
		test("should return context usage object", async () => {
			await client.start();
			const usage = await client.getContextUsage();

			expect(usage).toBeDefined();
			expect(typeof usage.contextWindow).toBe("number");
		}, 30000);

		test("should have numeric percent or null on fresh session", async () => {
			await client.start();
			const usage = await client.getContextUsage();

			if (usage.percent !== null) {
				expect(typeof usage.percent).toBe("number");
				expect(usage.percent).toBeGreaterThanOrEqual(0);
			}
		}, 30000);
	});

	// ========================================================================
	// System Prompt (会话级, 跨层级拼接)
	// ========================================================================

	describe("get_system_prompt", () => {
		test("should return system prompt info", async () => {
			await client.start();
			const promptInfo = await client.getSystemPrompt();

			expect(promptInfo).toBeDefined();
			expect(typeof promptInfo.systemPrompt).toBe("string");
			expect(Array.isArray(promptInfo.appendSystemPrompt)).toBe(true);
		}, 30000);
	});

	// ========================================================================
	// Active Tools (会话级)
	// ========================================================================

	describe("get_active_tools", () => {
		test("should return array of active tool names", async () => {
			await client.start();
			const tools = await client.getActiveTools();

			expect(Array.isArray(tools)).toBe(true);
		}, 30000);
	});

	describe("set_active_tools", () => {
		test("should set active tools and reflect in get_active_tools", async () => {
			await client.start();

			const before = await client.getActiveTools();
			expect(before.length).toBeGreaterThan(0);

			const subset = before.slice(0, 2);
			await client.setActiveTools(subset);

			const after = await client.getActiveTools();
			expect(after.sort()).toEqual(subset.sort());
		}, 30000);
	});

	// ========================================================================
	// Queue (会话级)
	// ========================================================================

	describe("get_queue", () => {
		test("should return empty queue on fresh session", async () => {
			await client.start();
			const queue = await client.getQueue();

			expect(queue).toBeDefined();
			expect(Array.isArray(queue.steering)).toBe(true);
			expect(Array.isArray(queue.followUp)).toBe(true);
			expect(queue.steering.length).toBe(0);
			expect(queue.followUp.length).toBe(0);
		}, 30000);
	});

	describe("clear_queue", () => {
		test("should return empty cleared queues on fresh session", async () => {
			await client.start();
			const cleared = await client.clearQueue();

			expect(cleared).toBeDefined();
			expect(Array.isArray(cleared.steering)).toBe(true);
			expect(Array.isArray(cleared.followUp)).toBe(true);
		}, 30000);
	});

	// ========================================================================
	// Flags (扩展级)
	// ========================================================================

	describe("get_flags", () => {
		test("should return flags info (may be empty if no extensions register flags)", async () => {
			await client.start();
			const flags = await client.getFlags();

			expect(flags).toBeDefined();
			expect(Array.isArray(flags)).toBe(true);
		}, 30000);
	});

	describe("get_flag_values", () => {
		test("should return flag values as object", async () => {
			await client.start();
			const values = await client.getFlagValues();

			expect(values).toBeDefined();
			expect(typeof values).toBe("object");
		}, 30000);
	});

	// ========================================================================
	// Reload (项目级)
	// ========================================================================

	describe("reload", () => {
		test("should complete reload without error", async () => {
			await client.start();

			await expect(client.reload()).resolves.toBeUndefined();
		}, 60000);
	});

	// ========================================================================
	// Agents Files (项目级)
	// ========================================================================

	describe("get_agents_files", () => {
		test("should return agents files array", async () => {
			await client.start();
			const result = await client.getAgentsFiles();

			expect(result).toBeDefined();
			expect(Array.isArray(result)).toBe(true);
		}, 30000);
	});
});
