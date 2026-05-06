import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("migrations", () => {
	let tempDir: string;
	let previousAgentDir: string | undefined;
	let previousCwd: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-migrations-test-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		previousCwd = process.cwd();
		process.env.PI_CODING_AGENT_DIR = tempDir;
	});

	afterEach(() => {
		process.chdir(previousCwd);
		rmSync(tempDir, { recursive: true, force: true });
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});

	describe("migrateAuthToAuthJson", () => {
		it("returns empty array when no legacy files exist", async () => {
			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();
			expect(result).toEqual([]);
		});

		it("returns empty array when auth.json already exists", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "auth.json"), JSON.stringify({ existing: { type: "api_key", key: "k" } }));
			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ provider1: { token: "t" } }));

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();
			expect(result).toEqual([]);
		});

		it("migrates oauth.json to auth.json", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ openai: { token: "abc", refresh: "def" } }));

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();

			expect(result).toEqual(["openai"]);
			expect(existsSync(join(tempDir, "auth.json"))).toBe(true);
			expect(existsSync(join(tempDir, "oauth.json.migrated"))).toBe(true);

			const auth = JSON.parse(readFileSync(join(tempDir, "auth.json"), "utf-8"));
			expect(auth.openai).toEqual({ type: "oauth", token: "abc", refresh: "def" });
		});

		it("migrates apiKeys from settings.json", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(
				join(tempDir, "settings.json"),
				JSON.stringify({ apiKeys: { anthropic: "sk-test-123", openai: "sk-open-456" }, other: true }),
			);

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();

			expect(result).toContain("anthropic");
			expect(result).toContain("openai");

			const auth = JSON.parse(readFileSync(join(tempDir, "auth.json"), "utf-8"));
			expect(auth.anthropic).toEqual({ type: "api_key", key: "sk-test-123" });
			expect(auth.openai).toEqual({ type: "api_key", key: "sk-open-456" });

			const settings = JSON.parse(readFileSync(join(tempDir, "settings.json"), "utf-8"));
			expect(settings.apiKeys).toBeUndefined();
			expect(settings.other).toBe(true);
		});

		it("prefers oauth over apiKey for same provider", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ openai: { token: "t" } }));
			writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ apiKeys: { openai: "sk-key" } }));

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();

			const auth = JSON.parse(readFileSync(join(tempDir, "auth.json"), "utf-8"));
			expect(auth.openai).toEqual({ type: "oauth", token: "t" });
		});

		it("skips malformed oauth.json", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "oauth.json"), "not json{{{");

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();
			expect(result).toEqual([]);
			expect(existsSync(join(tempDir, "auth.json"))).toBe(false);
		});

		it("skips malformed settings.json", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "settings.json"), "not json{{{");

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const result = migrateAuthToAuthJson();
			expect(result).toEqual([]);
		});

		it("is idempotent - running twice produces same result", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ openai: { token: "t" } }));

			const { migrateAuthToAuthJson } = await import("../src/migrations.js");
			const first = migrateAuthToAuthJson();
			const second = migrateAuthToAuthJson();

			expect(first).toEqual(["openai"]);
			expect(second).toEqual([]);
		});
	});

	describe("migrateSessionsFromAgentRoot", () => {
		it("does nothing when no jsonl files in agent root", async () => {
			mkdirSync(tempDir, { recursive: true });
			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			expect(() => migrateSessionsFromAgentRoot()).not.toThrow();
		});

		it("moves session files to correct session directory", async () => {
			mkdirSync(tempDir, { recursive: true });
			const sessionDir = join(tempDir, "sessions");
			mkdirSync(sessionDir, { recursive: true });

			const header = JSON.stringify({ type: "session", cwd: "/home/user/project" });
			const entry = JSON.stringify({ type: "message", role: "user", content: "hello" });
			writeFileSync(join(tempDir, "test-session.jsonl"), `${header}\n${entry}\n`);

			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			migrateSessionsFromAgentRoot();

			const safePath = "--home-user-project--";
			const expectedDir = join(sessionDir, safePath);
			expect(existsSync(expectedDir)).toBe(true);
			expect(existsSync(join(expectedDir, "test-session.jsonl"))).toBe(true);
			expect(existsSync(join(tempDir, "test-session.jsonl"))).toBe(false);
		});

		it("skips files without session header", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "bad.jsonl"), `some random content\n`);

			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			migrateSessionsFromAgentRoot();

			expect(existsSync(join(tempDir, "bad.jsonl"))).toBe(true);
		});

		it("skips files with wrong header type", async () => {
			mkdirSync(tempDir, { recursive: true });
			const header = JSON.stringify({ type: "other", cwd: "/home/user/project" });
			writeFileSync(join(tempDir, "wrong-type.jsonl"), `${header}\n`);

			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			migrateSessionsFromAgentRoot();

			expect(existsSync(join(tempDir, "wrong-type.jsonl"))).toBe(true);
		});

		it("skips files without cwd in header", async () => {
			mkdirSync(tempDir, { recursive: true });
			const header = JSON.stringify({ type: "session" });
			writeFileSync(join(tempDir, "no-cwd.jsonl"), `${header}\n`);

			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			migrateSessionsFromAgentRoot();

			expect(existsSync(join(tempDir, "no-cwd.jsonl"))).toBe(true);
		});

		it("skips if target file already exists", async () => {
			mkdirSync(tempDir, { recursive: true });
			const sessionDir = join(tempDir, "sessions");
			const safePath = "--home-user-project--";
			const targetDir = join(sessionDir, safePath);
			mkdirSync(targetDir, { recursive: true });

			const header = JSON.stringify({ type: "session", cwd: "/home/user/project" });
			writeFileSync(join(tempDir, "dup.jsonl"), `${header}\n`);
			writeFileSync(join(targetDir, "dup.jsonl"), "existing content");

			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			migrateSessionsFromAgentRoot();

			expect(readFileSync(join(targetDir, "dup.jsonl"), "utf-8")).toBe("existing content");
		});

		it("handles missing agent directory gracefully", async () => {
			process.env.PI_CODING_AGENT_DIR = join(tempDir, "nonexistent");
			const { migrateSessionsFromAgentRoot } = await import("../src/migrations.js");
			expect(() => migrateSessionsFromAgentRoot()).not.toThrow();
		});
	});

	describe("runMigrations", () => {
		it("runs all migrations and returns result", async () => {
			mkdirSync(tempDir, { recursive: true });
			mkdirSync(join(tempDir, "sessions"), { recursive: true });

			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ openai: { token: "t" } }));

			const { runMigrations } = await import("../src/migrations.js");
			const result = runMigrations(tempDir);

			expect(result.migratedAuthProviders).toContain("openai");
			expect(Array.isArray(result.deprecationWarnings)).toBe(true);
		});

		it("returns empty arrays for clean state", async () => {
			mkdirSync(tempDir, { recursive: true });

			const { runMigrations } = await import("../src/migrations.js");
			const result = runMigrations(tempDir);

			expect(result.migratedAuthProviders).toEqual([]);
			expect(result.deprecationWarnings).toEqual([]);
		});

		it("is idempotent", async () => {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(join(tempDir, "oauth.json"), JSON.stringify({ openai: { token: "t" } }));

			const { runMigrations } = await import("../src/migrations.js");
			const first = runMigrations(tempDir);
			const second = runMigrations(tempDir);

			expect(first.migratedAuthProviders).toContain("openai");
			expect(second.migratedAuthProviders).toEqual([]);
		});

		it("warns about deprecated hooks directory", async () => {
			mkdirSync(tempDir, { recursive: true });
			mkdirSync(join(tempDir, "hooks"));

			const { runMigrations } = await import("../src/migrations.js");
			const result = runMigrations(tempDir);

			expect(result.deprecationWarnings.some((w) => w.includes("hooks/"))).toBe(true);
		});

		it("warns about custom tools in tools/ directory", async () => {
			mkdirSync(tempDir, { recursive: true });
			const toolsDir = join(tempDir, "tools");
			mkdirSync(toolsDir);
			writeFileSync(join(toolsDir, "my-tool"), "#!/bin/bash\necho hello");

			const { runMigrations } = await import("../src/migrations.js");
			const result = runMigrations(tempDir);

			expect(result.deprecationWarnings.some((w) => w.includes("tools/") && w.includes("custom"))).toBe(true);
		});

		it("does not warn about fd/rg binaries in tools/", async () => {
			mkdirSync(tempDir, { recursive: true });
			const toolsDir = join(tempDir, "tools");
			mkdirSync(toolsDir);
			writeFileSync(join(toolsDir, "fd"), "binary");
			writeFileSync(join(toolsDir, "rg"), "binary");

			const { runMigrations } = await import("../src/migrations.js");
			const result = runMigrations(tempDir);

			expect(result.deprecationWarnings.some((w) => w.includes("tools/"))).toBe(false);
		});

		it("migrates commands/ to prompts/ for project", async () => {
			mkdirSync(tempDir, { recursive: true });
			const projectDir = join(tempDir, "project");
			const configDir = join(projectDir, ".pi");
			mkdirSync(join(configDir, "commands"), { recursive: true });
			writeFileSync(join(configDir, "commands", "test.md"), "# Test");

			const { runMigrations } = await import("../src/migrations.js");
			runMigrations(projectDir);

			expect(existsSync(join(configDir, "prompts", "test.md"))).toBe(true);
			expect(existsSync(join(configDir, "commands"))).toBe(false);
		});
	});
});
