import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("RPC query commands", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-query-test-${Date.now()}`);
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
	// State
	// ========================================================================

	test("get_state returns valid session state", async () => {
		await client.start();
		const state = await client.getState();
		expect(state.model).toBeDefined();
		expect(typeof state.model?.provider).toBe("string");
		expect(typeof state.model?.id).toBe("string");
		expect(state.isStreaming).toBe(false);
		expect(state.isCompacting).toBe(false);
		expect(["all", "one-at-a-time"]).toContain(state.steeringMode);
		expect(["all", "one-at-a-time"]).toContain(state.followUpMode);
		expect(state.sessionId).toBeDefined();
		expect(typeof state.messageCount).toBe("number");
		expect(typeof state.pendingMessageCount).toBe("number");
		expect(typeof state.autoCompactionEnabled).toBe("boolean");
	}, 30000);

	// ========================================================================
	// Messages
	// ========================================================================

	test("get_messages returns empty array on fresh session", async () => {
		await client.start();
		const messages = await client.getMessages();
		expect(Array.isArray(messages)).toBe(true);
		expect(messages.length).toBe(0);
	}, 30000);

	test("get_last_assistant_text returns null/undefined on fresh session", async () => {
		await client.start();
		const text = await client.getLastAssistantText();
		expect(text == null).toBe(true);
	}, 30000);

	test("get_fork_messages returns array on fresh session", async () => {
		await client.start();
		const msgs = await client.getForkMessages();
		expect(Array.isArray(msgs)).toBe(true);
	}, 30000);

	// ========================================================================
	// Session stats
	// ========================================================================

	test("get_session_stats returns defined stats", async () => {
		await client.start();
		const stats = await client.getSessionStats();
		expect(stats).toBeDefined();
	}, 30000);

	// ========================================================================
	// Model
	// ========================================================================

	test("get_available_models returns array", async () => {
		await client.start();
		const models = await client.getAvailableModels();
		expect(Array.isArray(models)).toBe(true);
	}, 30000);

	test("set_model succeeds for known model", async () => {
		await client.start();
		const models = await client.getAvailableModels();
		if (models.length > 0) {
			const m = models[0];
			const model = await client.setModel(m.provider, m.id);
			expect(model.provider).toBe(m.provider);
			expect(model.id).toBe(m.id);
		}
	}, 30000);

	test("set_model returns error for unknown model", async () => {
		await client.start();
		await expect(client.setModel("nonexistent", "no-such-model")).rejects.toThrow();
	}, 30000);

	// ========================================================================
	// Thinking
	// ========================================================================

	test("set_thinking_level succeeds", async () => {
		await client.start();
		await client.setThinkingLevel("low");
		const state = await client.getState();
		expect(["low", "off", "minimal"]).toContain(state.thinkingLevel);
	}, 30000);

	test("cycle_thinking_level returns result or null", async () => {
		await client.start();
		const result = await client.cycleThinkingLevel();
		expect(result === null || (result && typeof result.level === "string")).toBe(true);
	}, 30000);

	// ========================================================================
	// Queue modes
	// ========================================================================

	test("set_steering_mode succeeds", async () => {
		await client.start();
		await client.setSteeringMode("one-at-a-time");
		const state = await client.getState();
		expect(state.steeringMode).toBe("one-at-a-time");
	}, 30000);

	test("set_follow_up_mode succeeds", async () => {
		await client.start();
		await client.setFollowUpMode("one-at-a-time");
		const state = await client.getState();
		expect(state.followUpMode).toBe("one-at-a-time");
	}, 30000);

	// ========================================================================
	// Compaction
	// ========================================================================

	test("set_auto_compaction toggles", async () => {
		await client.start();
		await client.setAutoCompaction(false);
		const state1 = await client.getState();
		expect(state1.autoCompactionEnabled).toBe(false);

		await client.setAutoCompaction(true);
		const state2 = await client.getState();
		expect(state2.autoCompactionEnabled).toBe(true);
	}, 30000);

	// ========================================================================
	// Retry
	// ========================================================================

	test("set_auto_retry toggles", async () => {
		await client.start();
		await client.setAutoRetry(false);
		await client.setAutoRetry(true);
	}, 30000);

	// ========================================================================
	// Session
	// ========================================================================

	test("set_session_name updates name", async () => {
		await client.start();
		await client.setSessionName("test-session-name");
		const state = await client.getState();
		expect(state.sessionName).toBe("test-session-name");
	}, 30000);

	// ========================================================================
	// Bash
	// ========================================================================

	test("bash executes command", async () => {
		await client.start();
		const result = await client.bash("echo hello");
		expect(result).toBeDefined();
		expect(result.exitCode).toBe(0);
	}, 30000);

	// ========================================================================
	// Commands (slash commands)
	// ========================================================================

	test("get_commands returns array with source field", async () => {
		await client.start();
		const commands = await client.getCommands();
		expect(Array.isArray(commands)).toBe(true);
		for (const cmd of commands) {
			expect(cmd).toHaveProperty("name");
			expect(cmd).toHaveProperty("source");
			expect(["extension", "prompt", "skill"]).toContain(cmd.source);
			expect(cmd).toHaveProperty("sourceInfo");
		}
	}, 30000);

	// ========================================================================
	// Resources: Skills
	// ========================================================================

	test("get_skills returns array with full schema", async () => {
		await client.start();
		const skills = await client.getSkills();
		expect(Array.isArray(skills)).toBe(true);
		for (const skill of skills) {
			expect(typeof skill.name).toBe("string");
			expect(typeof skill.description).toBe("string");
			expect(typeof skill.filePath).toBe("string");
			expect(typeof skill.baseDir).toBe("string");
			expect(typeof skill.disableModelInvocation).toBe("boolean");
			expect(skill.sourceInfo).toBeDefined();
			expect(skill.sourceInfo).toHaveProperty("path");
			expect(skill.sourceInfo).toHaveProperty("source");
			expect(skill.sourceInfo).toHaveProperty("scope");
			expect(skill.sourceInfo).toHaveProperty("origin");
		}
	}, 60000);

	test("get_skills entries match skill entries in get_commands", async () => {
		await client.start();
		const skills = await client.getSkills();
		const commands = await client.getCommands();
		const skillCommands = commands.filter((c) => c.source === "skill");
		expect(skills.length).toBe(skillCommands.length);
		for (const skill of skills) {
			const match = skillCommands.find((c) => c.name === `skill:${skill.name}`);
			expect(match).toBeDefined();
		}
	}, 60000);

	// ========================================================================
	// Resources: Extensions
	// ========================================================================

	test("get_extensions returns array with full schema", async () => {
		await client.start();
		const extensions = await client.getExtensions();
		expect(Array.isArray(extensions)).toBe(true);
		for (const ext of extensions) {
			expect(typeof ext.path).toBe("string");
			expect(typeof ext.resolvedPath).toBe("string");
			expect(Array.isArray(ext.toolNames)).toBe(true);
			expect(Array.isArray(ext.commandNames)).toBe(true);
			expect(ext.sourceInfo).toBeDefined();
			expect(ext.sourceInfo).toHaveProperty("path");
			expect(ext.sourceInfo).toHaveProperty("source");
			expect(ext.sourceInfo).toHaveProperty("scope");
			expect(ext.sourceInfo).toHaveProperty("origin");
		}
	}, 30000);

	// ========================================================================
	// Resources: Tools
	// ========================================================================

	test("get_tools returns array with full schema", async () => {
		await client.start();
		const tools = await client.getTools();
		expect(Array.isArray(tools)).toBe(true);
		for (const tool of tools) {
			expect(typeof tool.name).toBe("string");
			expect(typeof tool.label).toBe("string");
			expect(typeof tool.description).toBe("string");
			expect(tool.sourceInfo).toBeDefined();
			expect(tool.sourceInfo).toHaveProperty("path");
			expect(tool.sourceInfo).toHaveProperty("source");
			expect(tool.sourceInfo).toHaveProperty("scope");
			expect(tool.sourceInfo).toHaveProperty("origin");
		}
	}, 30000);

	test("get_tools matches extension toolNames from get_extensions", async () => {
		await client.start();
		const tools = await client.getTools();
		const extensions = await client.getExtensions();
		const toolNames = new Set(tools.map((t) => t.name));
		const extToolNames = extensions.flatMap((e) => e.toolNames);
		for (const extToolName of extToolNames) {
			expect(toolNames.has(extToolName)).toBe(true);
		}
	}, 30000);

	// ========================================================================
	// Session lifecycle
	// ========================================================================

	test("new_session creates a fresh session", async () => {
		await client.start();
		const result = await client.newSession();
		expect(result).toHaveProperty("cancelled");
	}, 30000);
});
