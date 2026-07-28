import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

/**
 * Regression tests for issue #160: retry.maxRetries/baseDelayMs/maxDelayMs
 * silently dropped during persistence after a prior setRetryEnabled() call.
 *
 * Root cause: applyOverrides() called markModified(key) without registering
 * the nested keys of object-valued overrides. Then persistScopedSettings()
 * entered its nested-merge branch (because modifiedNestedFields.has("retry")
 * was true from a prior setRetryEnabled), and only wrote the previously-
 * registered "enabled" field, dropping the freshly-overridden values.
 *
 * Fix: applyOverrides now enumerates nested keys of object-valued overrides
 * and registers each one via markModified(field, nestedKey).
 */
describe("SettingsManager - Issue #160 retry persistence", () => {
	const testDir = join(process.cwd(), "test-settings-issue160-tmp");
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

	it("persists retry.maxRetries after a back-to-back setRetryEnabled() (issue #160)", async () => {
		const settingsPath = join(agentDir, "settings.json");

		// Bug trigger: setRetryEnabled and applyOverrides happen back-to-back
		// WITHOUT awaiting flush in between — modifiedNestedFields still
		// contains ("retry", "enabled") from the first call when the second
		// triggers its own save(). Without the fix, persistScopedSettings
		// enters the nested-merge branch and only writes "enabled".
		const manager = SettingsManager.create(projectDir, agentDir);

		// Step 1: User toggles retry.enabled via UI — registers ("retry", "enabled")
		manager.setRetryEnabled(true);

		// Step 2: IMMEDIATELY — app calls setSettings with full retry block
		// (this is exactly what the app does on SettingsPanel save when both
		// enabled and maxRetries changed in the same panel action).
		manager.applyOverrides({
			retry: {
				enabled: true,
				maxRetries: 20,
				baseDelayMs: 5000,
				maxDelayMs: 600000,
			},
		});
		await manager.flush();

		const saved = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(saved.retry).toBeTruthy();
		expect(saved.retry.enabled).toBe(true);
		expect(saved.retry.maxRetries).toBe(20);
		expect(saved.retry.baseDelayMs).toBe(5000);
		// Note: migrateSettings moves retry.maxDelayMs -> retry.provider.maxRetryDelayMs
		// during load, but the override path writes raw, so the freshly-written
		// settings.json should contain the literal maxDelayMs field.
		expect(saved.retry.maxDelayMs ?? saved.retry?.provider?.maxRetryDelayMs).toBe(600000);
	});

	it("getRetrySettings().maxRetries === 20 after reload (end-to-end)", async () => {
		const settingsPath = join(agentDir, "settings.json");

		// First session: same back-to-back sequence as the prior test.
		const first = SettingsManager.create(projectDir, agentDir);
		first.setRetryEnabled(true);
		first.applyOverrides({
			retry: {
				enabled: true,
				maxRetries: 20,
				baseDelayMs: 5000,
				maxDelayMs: 600000,
			},
		});
		await first.flush();

		// Second session: reload from disk and confirm maxRetries survives.
		const second = SettingsManager.create(projectDir, agentDir);
		expect(second.getRetrySettings().maxRetries).toBe(20);
		expect(second.getRetrySettings().baseDelayMs).toBe(5000);
		expect(second.getRetrySettings().enabled).toBe(true);
	});

	it("persists retry override on a clean (empty) settings.json", async () => {
		const settingsPath = join(agentDir, "settings.json");
		// No initial file — first write must create it.
		const manager = SettingsManager.create(projectDir, agentDir);
		manager.applyOverrides({
			retry: { enabled: true, maxRetries: 20, baseDelayMs: 5000, maxDelayMs: 600000 },
		});
		await manager.flush();

		const saved = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(saved.retry.maxRetries).toBe(20);
		expect(saved.retry.baseDelayMs).toBe(5000);
		expect(saved.retry.enabled).toBe(true);
	});

	it("does not regress: compaction override still persists all nested keys", async () => {
		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ compaction: { enabled: true } }, null, 2));

		const manager = SettingsManager.create(projectDir, agentDir);
		manager.applyOverrides({
			compaction: {
				enabled: false,
				reserveTokens: 9999,
				keepRecentTokens: 12345,
				thresholdPercent: 80,
			},
		});
		await manager.flush();

		const saved = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(saved.compaction.enabled).toBe(false);
		expect(saved.compaction.reserveTokens).toBe(9999);
		expect(saved.compaction.keepRecentTokens).toBe(12345);
		expect(saved.compaction.thresholdPercent).toBe(80);
	});
});
