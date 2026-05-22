import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager hooks merge", () => {
	const testDir = join(process.cwd(), "test-settings-hooks-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	it("should merge hooks by concatenating arrays per event key (global + project)", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "global-check" }],
				},
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "project-check" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([
			{ type: "command", command: "global-check" },
			{ type: "command", command: "project-check" },
		]);
	});

	it("should merge different event keys independently", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "g-start" }],
				},
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_complete: [{ type: "command", command: "p-complete" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([{ type: "command", command: "g-start" }]);
		expect(settings.hooks?.on_tool_complete).toEqual([{ type: "command", command: "p-complete" }]);
	});

	it("should keep global hooks when project has no hooks", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "global-only" }],
				},
			}),
		);
		writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({}));

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([{ type: "command", command: "global-only" }]);
	});

	it("should keep project hooks when global has no hooks", () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "project-only" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([{ type: "command", command: "project-only" }]);
	});

	it("should handle wildcard event key merging", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				hooks: {
					"*": [{ type: "command", command: "global-wildcard" }],
				},
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					"*": [{ type: "command", command: "project-wildcard" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.["*"]).toEqual([
			{ type: "command", command: "global-wildcard" },
			{ type: "command", command: "project-wildcard" },
		]);
	});

	it("should not merge hooks when global hooks value is not an object", () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ hooks: "invalid" }));
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "project-hook" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([{ type: "command", command: "project-hook" }]);
	});

	it("should skip non-array entries during hooks merge", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: [{ type: "command", command: "global" }],
				},
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					on_tool_start: "not-an-array",
					on_tool_complete: [{ type: "command", command: "project-complete" }],
				},
			}),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getMergedSettings();

		expect(settings.hooks?.on_tool_start).toEqual([{ type: "command", command: "global" }]);
		expect(settings.hooks?.on_tool_complete).toEqual([{ type: "command", command: "project-complete" }]);
	});
});
