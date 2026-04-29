import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let loadConfig: (projectDir: string) => Promise<import("../../src/rules-engine/types.js").RulesConfig>;
let resolveDirs: (
	projectDir: string,
	config: import("../../src/rules-engine/types.js").RulesConfig,
) => Array<{ scope: string; dir: string; source: string }>;

try {
	const mod = await import("../../src/rules-engine/config.js");
	loadConfig = mod.loadConfig;
	resolveDirs = mod.resolveDirs;
} catch {
	loadConfig = () => {
		throw new Error("not implemented yet");
	};
	resolveDirs = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Config: configuration loading", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rules-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("loadConfig: file discovery", () => {
		it("should load from .rules-config.json", async () => {
			writeFileSync(join(tempDir, ".rules-config.json"), JSON.stringify({ cacheTTL: 60000 }));
			const config = await loadConfig(tempDir);
			expect(config.cacheTTL).toBe(60000);
		});

		it("should load from .pi/rules-config.json when .rules-config.json absent", async () => {
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(join(tempDir, ".pi", "rules-config.json"), JSON.stringify({ cacheTTL: 45000 }));
			const config = await loadConfig(tempDir);
			expect(config.cacheTTL).toBe(45000);
		});

		it("should load from .claude/rules-config.json when others absent", async () => {
			mkdirSync(join(tempDir, ".claude"), { recursive: true });
			writeFileSync(join(tempDir, ".claude", "rules-config.json"), JSON.stringify({ cacheTTL: 50000 }));
			const config = await loadConfig(tempDir);
			expect(config.cacheTTL).toBe(50000);
		});

		it("should load from .opencode/rules-config.json when others absent", async () => {
			mkdirSync(join(tempDir, ".opencode"), { recursive: true });
			writeFileSync(join(tempDir, ".opencode", "rules-config.json"), JSON.stringify({ cacheTTL: 55000 }));
			const config = await loadConfig(tempDir);
			expect(config.cacheTTL).toBe(55000);
		});

		it("should prefer .rules-config.json over other config files", async () => {
			writeFileSync(join(tempDir, ".rules-config.json"), JSON.stringify({ cacheTTL: 10000 }));
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(join(tempDir, ".pi", "rules-config.json"), JSON.stringify({ cacheTTL: 20000 }));
			const config = await loadConfig(tempDir);
			expect(config.cacheTTL).toBe(10000);
		});

		it("should return default config when no config files exist", async () => {
			const config = await loadConfig(tempDir);
			expect(config).toBeDefined();
			expect(config.cacheTTL).toBe(30000);
		});

		it("should handle malformed JSON gracefully", async () => {
			writeFileSync(join(tempDir, ".rules-config.json"), "not valid json {{{");
			const config = await loadConfig(tempDir);
			expect(config).toBeDefined();
			expect(config.cacheTTL).toBe(30000);
		});
	});

	describe("loadConfig: custom dirs", () => {
		it("should parse custom dir configuration", async () => {
			writeFileSync(
				join(tempDir, ".rules-config.json"),
				JSON.stringify({
					dirs: {
						user: ["~/.custom-rules"],
						project: [".custom-rules"],
						pi: [".pi/custom-rules"],
						managed: ["/opt/rules"],
					},
				}),
			);
			const config = await loadConfig(tempDir);
			expect(config.dirs?.user).toEqual(["~/.custom-rules"]);
			expect(config.dirs?.project).toEqual([".custom-rules"]);
			expect(config.dirs?.pi).toEqual([".pi/custom-rules"]);
			expect(config.dirs?.managed).toEqual(["/opt/rules"]);
		});
	});

	describe("resolveDirs: default directories", () => {
		it("should resolve default dirs when config has no custom dirs", async () => {
			const config = await loadConfig(tempDir);
			const dirs = resolveDirs(tempDir, config);

			const scopes = dirs.map((d) => d.scope);
			expect(scopes).toContain("user");
			expect(scopes).toContain("project");
			expect(scopes).toContain("pi");
		});

		it("should resolve absolute paths as-is", async () => {
			const config = { cacheTTL: 30000, dirs: { managed: ["/etc/rules"] } };
			const dirs = resolveDirs(tempDir, config);
			const managed = dirs.filter((d) => d.scope === "managed");
			expect(managed.length).toBeGreaterThan(0);
			expect(managed[0].dir).toBe("/etc/rules");
		});

		it("should resolve relative paths against projectDir", async () => {
			const config = {
				cacheTTL: 30000,
				dirs: { project: [".custom-rules", "nested/rules"] },
			};
			const dirs = resolveDirs(tempDir, config);
			const projectDirs = dirs.filter((d) => d.scope === "project");
			expect(projectDirs.length).toBe(2);
			expect(projectDirs[0].dir).toBe(join(tempDir, ".custom-rules"));
			expect(projectDirs[1].dir).toBe(join(tempDir, "nested/rules"));
		});
	});

	describe("resolveDirs: idempotency", () => {
		it("should return same results on repeated calls", async () => {
			const config = await loadConfig(tempDir);
			const dirs1 = resolveDirs(tempDir, config);
			const dirs2 = resolveDirs(tempDir, config);
			expect(dirs1).toEqual(dirs2);
		});
	});
});
