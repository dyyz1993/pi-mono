import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TIER_ALIASES } from "../src/core/defaults.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager.getTierModels", () => {
	const testDir = join(process.cwd(), "test-tier-settings-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	it("returns DEFAULT_TIER_ALIASES when no tierModels in settings", () => {
		const manager = SettingsManager.create(projectDir, agentDir);
		const tierModels = manager.getTierModels();
		expect(tierModels).toEqual(DEFAULT_TIER_ALIASES);
	});

	it("returns merged defaults + user overrides for partial tierModels", () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ tierModels: { fast: "openai/gpt-4o" } }));

		const manager = SettingsManager.create(projectDir, agentDir);
		const tierModels = manager.getTierModels();

		expect(tierModels.fast).toBe("openai/gpt-4o");
		expect(tierModels.pro).toBe(DEFAULT_TIER_ALIASES.pro);
		expect(tierModels.max).toBe(DEFAULT_TIER_ALIASES.max);
	});

	it("returns full override when all defaults are replaced", () => {
		const custom = {
			fast: "google/gemini-2.5-flash",
			pro: "google/gemini-2.5-pro",
			max: "google/gemini-3.1-pro-high",
		};
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ tierModels: custom }));

		const manager = SettingsManager.create(projectDir, agentDir);
		expect(manager.getTierModels()).toEqual(custom);
	});

	it("returns a copy — mutations do not affect internal state", () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));

		const manager = SettingsManager.create(projectDir, agentDir);
		const first = manager.getTierModels();
		first.fast = "mutated";

		const second = manager.getTierModels();
		expect(second.fast).toBe(DEFAULT_TIER_ALIASES.fast);
	});

	it("project settings override global tierModels", () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ tierModels: { fast: "global/fast-model", pro: "global/pro-model" } }),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ tierModels: { pro: "project/pro-model" } }),
		);

		const manager = SettingsManager.create(projectDir, agentDir);
		const tierModels = manager.getTierModels();

		expect(tierModels.fast).toBe("global/fast-model");
		expect(tierModels.pro).toBe("project/pro-model");
		expect(tierModels.max).toBe(DEFAULT_TIER_ALIASES.max);
	});

	it("supports custom tier keys beyond fast/pro/max", () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ tierModels: { reasoning: "openai/o3" } }));

		const manager = SettingsManager.create(projectDir, agentDir);
		const tierModels = manager.getTierModels();

		expect(tierModels.reasoning).toBe("openai/o3");
		expect(tierModels.fast).toBe(DEFAULT_TIER_ALIASES.fast);
	});
});
