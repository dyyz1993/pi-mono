import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let getRules: (
	projectDir: string,
	config: import("../../extensions/rules-engine/types.js").RulesConfig,
) => Promise<import("../../extensions/rules-engine/types.js").ParsedRule[]>;
let invalidateCache: () => void;

try {
	const mod = await import("../../extensions/rules-engine/cache.js");
	getRules = mod.getRules;
	invalidateCache = mod.invalidateCache;
} catch {
	getRules = () => {
		throw new Error("not implemented yet");
	};
	invalidateCache = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Cache: TTL-based caching", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rules-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		mkdirSync(join(tempDir, ".claude", "rules"), { recursive: true });
		invalidateCache();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("getRules: basic loading", () => {
		it("should load rules from configured directory", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "test.md"), "---\n---\n# Test Rule\nBody");
			const config = {
				cacheTTL: 30000,
				dirs: { project: [".claude/rules"] },
			};
			const rules = await getRules(tempDir, config);
			expect(rules.length).toBeGreaterThanOrEqual(1);
			expect(rules.some((r: any) => r.title === "Test Rule")).toBe(true);
		});

		it("should return empty array for empty rules directory", async () => {
			const config = {
				cacheTTL: 30000,
				dirs: { project: [".claude/rules"] },
			};
			const rules = await getRules(tempDir, config);
			expect(rules).toEqual([]);
		});
	});

	describe("getRules: TTL behavior", () => {
		it("should return cached rules within TTL", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "cached.md"), "---\n---\n# Cached Rule");
			const config = {
				cacheTTL: 60000,
				dirs: { project: [".claude/rules"] },
			};

			const first = await getRules(tempDir, config);
			const second = await getRules(tempDir, config);
			expect(first).toBe(second);
		});

		it("should reload rules after TTL expires", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "old.md"), "---\n---\n# Old Rule");
			const config = {
				cacheTTL: 0,
				dirs: { project: [".claude/rules"] },
			};

			const first = await getRules(tempDir, config);
			writeFileSync(join(tempDir, ".claude", "rules", "new.md"), "---\n---\n# New Rule");

			const second = await getRules(tempDir, config);
			expect(second.length).toBeGreaterThan(first.length);
		});
	});

	describe("getRules: deduplication", () => {
		it("should deduplicate rules by filePath", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "unique.md"), "---\n---\n# Unique Rule");
			const config = {
				cacheTTL: 60000,
				dirs: { project: [".claude/rules", ".claude/rules"] },
			};
			const rules = await getRules(tempDir, config);
			const paths = rules.map((r: any) => r.filePath);
			const uniquePaths = new Set(paths);
			expect(paths.length).toBe(uniquePaths.size);
		});
	});

	describe("invalidateCache: manual cache clear", () => {
		it("should force reload after invalidateCache", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "a.md"), "---\n---\n# Rule A");
			const config = {
				cacheTTL: 60000,
				dirs: { project: [".claude/rules"] },
			};

			const first = await getRules(tempDir, config);
			invalidateCache();
			writeFileSync(join(tempDir, ".claude", "rules", "b.md"), "---\n---\n# Rule B");
			const second = await getRules(tempDir, config);
			expect(second.length).toBeGreaterThan(first.length);
		});
	});

	describe("getRules: idempotency", () => {
		it("should return identical results on consecutive calls within TTL", async () => {
			writeFileSync(join(tempDir, ".claude", "rules", "stable.md"), "---\n---\n# Stable Rule");
			const config = {
				cacheTTL: 60000,
				dirs: { project: [".claude/rules"] },
			};

			const first = await getRules(tempDir, config);
			const second = await getRules(tempDir, config);
			expect(first).toEqual(second);
		});
	});
});
