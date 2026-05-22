import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import hooksEngine, { loadMergedSettingsHooks, loadSettingsHooks } from "../../extensions/hooks-engine/index.js";

describe("loadSettingsHooks", () => {
	const tmpDir = join(process.cwd(), "test-hooks-settings-tmp");

	beforeEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
	});

	it("returns null when file does not exist", () => {
		expect(loadSettingsHooks(join(tmpDir, "nonexistent.json"))).toBeNull();
	});

	it("returns null when file has no hooks field", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(p, JSON.stringify({ theme: "dark" }));
		expect(loadSettingsHooks(p)).toBeNull();
	});

	it("returns null when hooks field is not an object", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(p, JSON.stringify({ hooks: "bad" }));
		expect(loadSettingsHooks(p)).toBeNull();
	});

	it("returns null when hooks is empty object", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(p, JSON.stringify({ hooks: {} }));
		expect(loadSettingsHooks(p)).toBeNull();
	});

	it("returns null when all event entries are empty arrays", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(p, JSON.stringify({ hooks: { on_tool_start: [] } }));
		expect(loadSettingsHooks(p)).toBeNull();
	});

	it("loads hooks from a valid settings file", () => {
		const p = join(tmpDir, "settings.json");
		const hooks = {
			on_tool_start: [{ type: "command", command: "echo hello" }],
			on_tool_complete: [{ type: "prompt", prompt: "check tests" }],
		};
		writeFileSync(p, JSON.stringify({ hooks }));
		const result = loadSettingsHooks(p);
		expect(result).toEqual(hooks);
	});

	it("loads wildcard hooks", () => {
		const p = join(tmpDir, "settings.json");
		const hooks = { "*": [{ type: "command", command: "echo wildcard" }] };
		writeFileSync(p, JSON.stringify({ hooks }));
		expect(loadSettingsHooks(p)).toEqual(hooks);
	});

	it("filters out non-array entries", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(
			p,
			JSON.stringify({ hooks: { on_tool_start: "not-array", valid: [{ type: "command", command: "echo ok" }] } }),
		);
		const result = loadSettingsHooks(p);
		expect(result).toEqual({ valid: [{ type: "command", command: "echo ok" }] });
	});

	it("returns null for invalid JSON", () => {
		const p = join(tmpDir, "settings.json");
		writeFileSync(p, "{bad json}");
		expect(loadSettingsHooks(p)).toBeNull();
	});
});

describe("loadMergedSettingsHooks", () => {
	const tmpDir = join(process.cwd(), "test-hooks-merge-tmp");
	let globalDir: string;
	let projectDir: string;
	let originalHomedir: typeof homedir;

	beforeEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		globalDir = join(tmpDir, "global", ".pi", "agent");
		projectDir = join(tmpDir, "project");
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		originalHomedir = process.env.HOME;
		process.env.HOME = join(tmpDir, "global");
	});

	afterEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		process.env.HOME = originalHomedir;
	});

	it("returns empty object when no settings files exist", () => {
		const result = loadMergedSettingsHooks(join(tmpDir, "noproject"));
		expect(result).toEqual({});
	});

	it("loads only global hooks when no project hooks", () => {
		writeFileSync(
			join(globalDir, "settings.json"),
			JSON.stringify({
				hooks: { on_tool_start: [{ type: "command", command: "global-hook" }] },
			}),
		);
		const result = loadMergedSettingsHooks(projectDir);
		expect(result).toEqual({
			on_tool_start: [{ type: "command", command: "global-hook" }],
		});
	});

	it("loads only project hooks when no global hooks", () => {
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: { on_tool_start: [{ type: "command", command: "project-hook" }] },
			}),
		);
		const result = loadMergedSettingsHooks(projectDir);
		expect(result).toEqual({
			on_tool_start: [{ type: "command", command: "project-hook" }],
		});
	});

	it("merges global and project hooks, project appends", () => {
		writeFileSync(
			join(globalDir, "settings.json"),
			JSON.stringify({
				hooks: { on_tool_start: [{ type: "command", command: "global-1" }] },
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: { on_tool_start: [{ type: "command", command: "project-1" }] },
			}),
		);
		const result = loadMergedSettingsHooks(projectDir);
		expect(result.on_tool_start).toEqual([
			{ type: "command", command: "global-1" },
			{ type: "command", command: "project-1" },
		]);
	});

	it("merges different event keys from global and project", () => {
		writeFileSync(
			join(globalDir, "settings.json"),
			JSON.stringify({
				hooks: { on_tool_start: [{ type: "command", command: "g-start" }] },
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: { on_tool_complete: [{ type: "command", command: "p-complete" }] },
			}),
		);
		const result = loadMergedSettingsHooks(projectDir);
		expect(result.on_tool_start).toEqual([{ type: "command", command: "g-start" }]);
		expect(result.on_tool_complete).toEqual([{ type: "command", command: "p-complete" }]);
	});
});

function createMockPi() {
	const handlers: Record<string, Array<(event: Record<string, unknown>, ctx: any) => Promise<any>>> = {};
	return {
		handlers,
		on: vi.fn((event: string, handler: (event: Record<string, unknown>, ctx: any) => Promise<any>) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		sendUserMessage: vi.fn(),
	};
}

type MockPi = ReturnType<typeof createMockPi>;

async function emitEvent(pi: MockPi, eventName: string, event: Record<string, unknown>, ctx?: any): Promise<any> {
	const list = pi.handlers[eventName];
	if (!list || list.length === 0) return undefined;
	return list[0](event, ctx ?? {});
}

describe("hooksEngine multi-source hooks (settings + agent)", () => {
	let pi: MockPi;
	const tmpDir = join(process.cwd(), "test-hooks-multi-source-tmp");

	beforeEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		mkdirSync(tmpDir, { recursive: true });
		pi = createMockPi();
		hooksEngine(pi as any);
	});

	afterEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
	});

	it("should execute settings hooks when triggered via session_start cache refresh", async () => {
		const projectDir = join(tmpDir, "myproject");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "echo 'settings-deny'; exit 2" }],
				},
			}),
		);

		await emitEvent(pi, "session_start", {}, { cwd: projectDir });

		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
			},
			{ cwd: projectDir },
		);

		expect(result).toEqual({ block: true, reason: "settings-deny" });
	});

	it("should merge settings hooks and agent hooks (settings first)", async () => {
		const projectDir = join(tmpDir, "myproject2");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "exit 0" }],
				},
			}),
		);

		await emitEvent(pi, "session_start", {}, { cwd: projectDir });

		const result = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
				variables: {
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'agent-deny'; exit 2" }],
					}),
				},
			},
			{ cwd: projectDir },
		);

		expect(result).toEqual({ block: true, reason: "agent-deny" });
	});

	it("should not execute any hooks when no settings and no agent hooks", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
		});
		expect(result).toBeUndefined();
	});

	it("should execute only agent hooks when no settings hooks cached", async () => {
		const result = await emitEvent(pi, "tool_call", {
			toolName: "Bash",
			variables: {
				agentHooks: JSON.stringify({
					on_tool_start: [{ type: "command", command: "echo 'agent-only'; exit 2" }],
				}),
			},
		});
		expect(result).toEqual({ block: true, reason: "agent-only" });
	});

	it("should cache settings hooks on session_start and reuse on subsequent events", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const projectDir = join(tmpDir, "myproject3");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "echo 'cached'" }],
				},
			}),
		);

		await emitEvent(pi, "session_start", {}, { cwd: projectDir });
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Loaded"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("settings hooks"));

		const result1 = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Bash",
			},
			{ cwd: projectDir },
		);
		expect(result1).toBeUndefined();

		const result2 = await emitEvent(
			pi,
			"tool_call",
			{
				toolName: "Read",
			},
			{ cwd: projectDir },
		);
		expect(result2).toBeUndefined();

		consoleSpy.mockRestore();
	});
});
