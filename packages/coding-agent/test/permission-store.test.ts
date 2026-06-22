import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PermissionStore } from "../src/core/permissions/index.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("PermissionStore", () => {
	let agentDir: string;
	let projectDir: string;
	let manager: SettingsManager;
	let store: PermissionStore;

	beforeEach(() => {
		const root = join(tmpdir(), `pi-permission-store-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		agentDir = join(root, "agent");
		projectDir = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		manager = SettingsManager.create(projectDir, agentDir);
		store = new PermissionStore(manager);
	});

	afterEach(() => {
		rmSync(join(projectDir, ".."), { recursive: true, force: true });
	});

	it("creates project settings when adding the first rule", async () => {
		await store.addRule({
			id: "perm_write_src",
			provider: "path-access",
			subject: "file.write",
			pattern: "src/**",
			action: "allow",
			createdAt: "2026-06-21T00:00:00.000Z",
		});

		const settingsPath = join(projectDir, ".pi", "settings.json");
		expect(existsSync(settingsPath)).toBe(true);
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.permissions.rules).toEqual([
			{
				id: "perm_write_src",
				provider: "path-access",
				subject: "file.write",
				pattern: "src/**",
				action: "allow",
				scope: "project",
				createdAt: "2026-06-21T00:00:00.000Z",
			},
		]);
	});

	it("preserves unrelated project settings fields", async () => {
		const settingsDir = join(projectDir, ".pi");
		mkdirSync(settingsDir, { recursive: true });
		writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ theme: "dark" }, null, 2));
		manager = SettingsManager.create(projectDir, agentDir);
		store = new PermissionStore(manager);

		await store.addRule({
			provider: "path-access",
			subject: "file.write",
			pattern: "docs/**",
			action: "allow",
		});

		const settings = JSON.parse(readFileSync(join(settingsDir, "settings.json"), "utf-8"));
		expect(settings.theme).toBe("dark");
		expect(settings.permissions.rules).toHaveLength(1);
	});

	it("matches project file rules with path globs", async () => {
		await store.addRule({
			provider: "path-access",
			subject: "file.write",
			pattern: "src/**",
			action: "allow",
		});

		expect(
			store.findDecision({
				provider: "path-access",
				subject: "file.write",
				value: join(projectDir, "src/app.ts"),
			})?.action,
		).toBe("allow");
	});

	it("downgrades project rules to session rules when the project is not trusted", async () => {
		manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
		store = new PermissionStore(manager);

		const rule = await store.addRule({
			id: "perm_untrusted_hook",
			provider: "pi-hooks",
			subject: "hook.approval",
			pattern: "write|.pi/hooks/guard-write.sh|*",
			action: "allow",
			scope: "project",
			createdAt: "2026-06-21T00:00:00.000Z",
		});

		expect(rule.scope).toBe("session");
		expect(existsSync(join(projectDir, ".pi", "settings.json"))).toBe(false);
		expect(
			store.findDecision({
				provider: "pi-hooks",
				subject: "hook.approval",
				value: "write|.pi/hooks/guard-write.sh|*",
				scope: "session",
			})?.action,
		).toBe("allow");
		expect(
			store.findDecision({
				provider: "pi-hooks",
				subject: "hook.approval",
				value: "write|.pi/hooks/guard-write.sh|*",
				scope: "project",
			}),
		).toBeUndefined();
	});

	it("matches command rules with glob patterns", async () => {
		await store.addRule({
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm install *",
			action: "allow",
		});

		expect(
			store.findDecision({
				provider: "dangerous-command",
				subject: "command.run",
				value: "npm install lodash",
			})?.action,
		).toBe("allow");
	});

	it("keeps provider decisions isolated", async () => {
		await store.addRule({
			provider: "path-access",
			subject: "file.write",
			pattern: "src/**",
			action: "allow",
		});

		expect(
			store.findDecision({
				provider: "pi-hooks",
				subject: "file.write",
				value: "src/app.ts",
			}),
		).toBeUndefined();
	});

	it("prefers exact rules over broader wildcard rules", async () => {
		await store.addRule({
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm install *",
			action: "allow",
			createdAt: "2026-06-21T00:00:00.000Z",
		});
		await store.addRule({
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm install lodash",
			action: "deny",
			createdAt: "2026-06-21T00:00:01.000Z",
		});

		const decision = store.findDecision({
			provider: "dangerous-command",
			subject: "command.run",
			value: "npm install lodash",
		});

		expect(decision?.action).toBe("deny");
		expect(decision?.rule.pattern).toBe("npm install lodash");
	});

	it("lets deny win over allow at the same specificity", async () => {
		await store.addRule({
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm *",
			action: "allow",
		});
		await store.addRule({
			provider: "dangerous-command",
			subject: "command.run",
			pattern: "npm ?",
			action: "deny",
		});

		expect(
			store.findDecision({
				provider: "dangerous-command",
				subject: "command.run",
				value: "npm x",
			})?.action,
		).toBe("deny");
	});

	it("fails closed when the permissions field is malformed", () => {
		const settingsDir = join(projectDir, ".pi");
		mkdirSync(settingsDir, { recursive: true });
		const settingsPath = join(settingsDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ theme: "dark", permissions: "bad" }, null, 2));
		manager = SettingsManager.create(projectDir, agentDir);
		store = new PermissionStore(manager);

		expect(
			store.findDecision({
				provider: "path-access",
				subject: "file.write",
				value: "src/app.ts",
			}),
		).toBeUndefined();
		expect(JSON.parse(readFileSync(settingsPath, "utf-8")).theme).toBe("dark");
	});
});
