import { afterEach, describe, expect, test } from "vitest";
import { createHarness } from "./test-harness.js";

describe("AgentSession tier models", () => {
	let harness: ReturnType<typeof createHarness>;

	afterEach(() => {
		harness?.cleanup();
	});

	test("getTierModels returns empty object by default", () => {
		harness = createHarness();
		const result = harness.session.getTierModels();
		expect(result).toEqual({});
	});

	test("setTierModels stores mapping and getTierModels returns it", () => {
		harness = createHarness();
		const mapping = { "fast:model": "gpt-4o-mini", "smart:model": "claude-sonnet-4-20250514" };
		harness.session.setTierModels(mapping);
		expect(harness.session.getTierModels()).toEqual(mapping);
	});

	test("setTierModels creates a shallow copy", () => {
		harness = createHarness();
		const original: Record<string, string> = { "fast:model": "gpt-4o-mini" };
		harness.session.setTierModels(original);
		original["fast:model"] = "MUTATED";
		expect(harness.session.getTierModels()["fast:model"]).toBe("gpt-4o-mini");
	});

	test("calling setTierModels again replaces previous mapping", () => {
		harness = createHarness();
		harness.session.setTierModels({ "fast:model": "a" });
		harness.session.setTierModels({ "smart:model": "b" });
		const result = harness.session.getTierModels();
		expect(result).toEqual({ "smart:model": "b" });
		expect("fast:model" in result).toBe(false);
	});
});
