import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { SessionManager } from "../src/core/session-manager.js";
import { createHarness, type Harness } from "./test-harness.js";

describe("AgentSession tierModels persistence", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("setTierModels appends a tier_models_change entry to session", async () => {
		harness = createHarness({ responses: ["ok"] });

		await harness.session.prompt("hello");

		const mapping = { fast: "openai/gpt-4o-mini", max: "anthropic/claude-opus-4-6" };
		harness.session.setTierModels(mapping);

		const entries = harness.sessionManager.getBranch();
		const tierEntry = entries.find((e) => e.type === "tier_models_change");
		expect(tierEntry).toBeDefined();
		expect(tierEntry!.type).toBe("tier_models_change");
		if (tierEntry!.type === "tier_models_change") {
			expect(tierEntry!.tierModels).toEqual(mapping);
		}
	});

	it("tier_models_change entry is written to session file", async () => {
		const tempDir = harness?.tempDir ?? createHarness().tempDir;
		const standaloneHarness = createHarness({ responses: ["ok"] });
		harness = standaloneHarness;

		await harness.session.prompt("hello");

		const mapping = { fast: "google/gemini-2.5-flash" };
		harness.session.setTierModels(mapping);

		const sessionFile = harness.sessionManager.getSessionFile();
		if (!sessionFile) {
			return;
		}

		const content = readFileSync(sessionFile, "utf-8");
		const lines = content.trim().split("\n");
		const tierLine = lines.find((l) => l.includes("tier_models_change"));
		expect(tierLine).toBeDefined();
		const parsed = JSON.parse(tierLine!);
		expect(parsed.type).toBe("tier_models_change");
		expect(parsed.tierModels.fast).toBe("google/gemini-2.5-flash");
	});

	it("multiple setTierModels calls create multiple entries", async () => {
		harness = createHarness({ responses: ["ok"] });

		await harness.session.prompt("hello");

		harness.session.setTierModels({ fast: "model-a" });
		harness.session.setTierModels({ fast: "model-b", pro: "model-c" });

		const entries = harness.sessionManager.getEntries();
		const tierEntries = entries.filter((e) => e.type === "tier_models_change");
		expect(tierEntries.length).toBe(2);

		expect(harness.session.getTierModels()).toEqual({ fast: "model-b", pro: "model-c" });
	});

	it("restored session reflects tier_models from session file", async () => {
		harness = createHarness({ responses: ["ok"] });

		await harness.session.prompt("hello");

		const mapping = { fast: "model-x", smart: "model-y" };
		harness.session.setTierModels(mapping);

		const sessionFile = harness.sessionManager.getSessionFile();
		if (!sessionFile) {
			return;
		}

		harness.sessionManager.flush();

		const restored = SessionManager.open(sessionFile);
		const branch = restored.getBranch();
		const tierEntry = branch.find((e) => e.type === "tier_models_change");
		expect(tierEntry).toBeDefined();
		if (tierEntry!.type === "tier_models_change") {
			expect(tierEntry!.tierModels).toEqual(mapping);
		}
	});
});
