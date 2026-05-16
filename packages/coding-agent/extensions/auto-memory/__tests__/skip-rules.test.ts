import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addHistoryEntry,
	applyPurification,
	evaluateRules,
	getDefaultStore,
	loadSkipWordStore,
	matchRule,
	saveSkipWordStore,
	type HistoryEntry,
	type SkipRule,
	type SkipWordStore,
} from "../skip-rules.js";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		query: "test query",
		selected: [],
		skipped: false,
		skip_hits: [],
		guard_hits: [],
		timestamp: Date.now(),
		...overrides,
	};
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "skip-rules-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("addHistoryEntry with userMarkedIrrelevant", () => {
	it("adds entry with userMarkedIrrelevant:true and irrelevantFiles", () => {
		const store = getDefaultStore();
		const entry = makeEntry({
			query: "继续",
			userMarkedIrrelevant: true,
			irrelevantFiles: ["src/foo.ts", "src/bar.ts"],
		});
		const result = addHistoryEntry(store, entry);
		expect(result.history).toHaveLength(1);
		expect(result.history[0].userMarkedIrrelevant).toBe(true);
		expect(result.history[0].irrelevantFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
	});

	it("preserves existing entries when adding new one", () => {
		const store = getDefaultStore();
		const e1 = makeEntry({ query: "first" });
		const s1 = addHistoryEntry(store, e1);
		const e2 = makeEntry({
			query: "second",
			userMarkedIrrelevant: true,
			irrelevantFiles: ["a.ts"],
		});
		const s2 = addHistoryEntry(s1, e2);
		expect(s2.history).toHaveLength(2);
		expect(s2.history[0].query).toBe("first");
		expect(s2.history[1].query).toBe("second");
		expect(s2.history[1].userMarkedIrrelevant).toBe(true);
	});

	it("trims to MAX_HISTORY (20) even with irrelevant entries", () => {
		const store = getDefaultStore();
		let current = store;
		for (let i = 0; i < 25; i++) {
			current = addHistoryEntry(current, makeEntry({
				query: `q${i}`,
				userMarkedIrrelevant: i % 2 === 0,
				irrelevantFiles: i % 2 === 0 ? [`file${i}.ts`] : undefined,
			}));
		}
		expect(current.history).toHaveLength(20);
		expect(current.history[0].query).toBe("q5");
		expect(current.history[19].query).toBe("q24");
	});

	it("handles mixed history: some with userMarkedIrrelevant, some without", () => {
		const store = getDefaultStore();
		let current = store;
		current = addHistoryEntry(current, makeEntry({ query: "normal" }));
		current = addHistoryEntry(current, makeEntry({
			query: "irrelevant",
			userMarkedIrrelevant: true,
			irrelevantFiles: ["x.ts"],
		}));
		current = addHistoryEntry(current, makeEntry({ query: "another normal" }));

		expect(current.history).toHaveLength(3);
		expect(current.history[0].userMarkedIrrelevant).toBeUndefined();
		expect(current.history[0].irrelevantFiles).toBeUndefined();
		expect(current.history[1].userMarkedIrrelevant).toBe(true);
		expect(current.history[1].irrelevantFiles).toEqual(["x.ts"]);
		expect(current.history[2].userMarkedIrrelevant).toBeUndefined();
	});
});

describe("matchRule", () => {
	it("exact match: 'ok' matches 'ok'", () => {
		const rule: SkipRule = { pattern: "ok", mode: "exact", action: "skip", builtin: true };
		expect(matchRule("ok", rule)).toBe(true);
	});

	it("exact match: 'ok' does not match 'okay'", () => {
		const rule: SkipRule = { pattern: "ok", mode: "exact", action: "skip", builtin: true };
		expect(matchRule("okay", rule)).toBe(false);
	});

	it("prefix match: '帮' matches '帮我看看'", () => {
		const rule: SkipRule = { pattern: "帮", mode: "prefix", action: "guard", builtin: true };
		expect(matchRule("帮我看看", rule)).toBe(true);
	});

	it("prefix match: '帮' does not match '请帮我'", () => {
		const rule: SkipRule = { pattern: "帮", mode: "prefix", action: "guard", builtin: true };
		expect(matchRule("请帮我", rule)).toBe(false);
	});

	it("contains match: '?' matches '怎么弄?'", () => {
		const rule: SkipRule = { pattern: "?", mode: "contains", action: "guard", builtin: true };
		expect(matchRule("怎么弄?", rule)).toBe(true);
	});

	it("contains match: '\\n' matches 'line1\\nline2'", () => {
		const rule: SkipRule = { pattern: "\n", mode: "contains", action: "guard", builtin: true };
		expect(matchRule("line1\nline2", rule)).toBe(true);
	});

	it("regex match: pattern '^test.+$' matches 'test123'", () => {
		const rule: SkipRule = { pattern: "^test.+$", mode: "regex", action: "skip" };
		expect(matchRule("test123", rule)).toBe(true);
	});

	it("regex match: invalid regex returns false without crashing", () => {
		const rule: SkipRule = { pattern: "([unclosed", mode: "regex", action: "skip" };
		expect(matchRule("anything", rule)).toBe(false);
	});

	it("empty query returns false", () => {
		const rule: SkipRule = { pattern: "ok", mode: "exact", action: "skip" };
		expect(matchRule("", rule)).toBe(false);
	});

	it("empty pattern returns false", () => {
		const rule: SkipRule = { pattern: "", mode: "exact", action: "skip" };
		expect(matchRule("ok", rule)).toBe(false);
	});
});

describe("evaluateRules", () => {
	it("skip rule only → shouldSkip=true", () => {
		const rules: SkipRule[] = [
			{ pattern: "ok", mode: "exact", action: "skip", builtin: true },
		];
		const result = evaluateRules("ok", rules);
		expect(result.shouldSkip).toBe(true);
		expect(result.skipHits).toEqual(["ok"]);
		expect(result.guardHits).toEqual([]);
	});

	it("guard rule only → shouldSkip=false", () => {
		const rules: SkipRule[] = [
			{ pattern: "?", mode: "contains", action: "guard", builtin: true },
		];
		const result = evaluateRules("how?", rules);
		expect(result.shouldSkip).toBe(false);
		expect(result.guardHits).toEqual(["?"]);
	});

	it("both skip and guard match → shouldSkip=false (guard wins)", () => {
		const rules: SkipRule[] = [
			{ pattern: "ok", mode: "prefix", action: "skip", builtin: true },
			{ pattern: "?", mode: "contains", action: "guard", builtin: true },
		];
		const result = evaluateRules("ok?", rules);
		expect(result.shouldSkip).toBe(false);
		expect(result.skipHits).toEqual(["ok"]);
		expect(result.guardHits).toEqual(["?"]);
	});

	it("no rules match → shouldSkip=false", () => {
		const rules: SkipRule[] = [
			{ pattern: "ok", mode: "exact", action: "skip", builtin: true },
		];
		const result = evaluateRules("hello world", rules);
		expect(result.shouldSkip).toBe(false);
		expect(result.skipHits).toEqual([]);
		expect(result.guardHits).toEqual([]);
	});

	it("multiple skip rules match → all listed in skipHits", () => {
		const rules: SkipRule[] = [
			{ pattern: "好的", mode: "exact", action: "skip", builtin: true },
			{ pattern: "好的", mode: "prefix", action: "skip", builtin: true },
			{ pattern: "好", mode: "prefix", action: "skip", builtin: true },
		];
		const result = evaluateRules("好的", rules);
		expect(result.shouldSkip).toBe(true);
		expect(result.skipHits).toEqual(["好的", "好的", "好"]);
	});
});

describe("applyPurification", () => {
	it("add_rules adds custom skip rule", () => {
		const store = getDefaultStore();
		const result = applyPurification(store, {
			add_rules: [{ pattern: "custom_skip", mode: "exact", action: "skip" }],
		});
		const added = result.rules.find(
			(r) => r.pattern === "custom_skip" && r.action === "skip" && !r.builtin,
		);
		expect(added).toBeDefined();
		expect(added!.mode).toBe("exact");
	});

	it("add_rules does not duplicate existing rule", () => {
		const store = getDefaultStore();
		const s1 = applyPurification(store, {
			add_rules: [{ pattern: "dup", mode: "exact", action: "skip" }],
		});
		const countBefore = s1.rules.filter((r) => r.pattern === "dup").length;
		const s2 = applyPurification(s1, {
			add_rules: [{ pattern: "dup", mode: "exact", action: "skip" }],
		});
		const countAfter = s2.rules.filter((r) => r.pattern === "dup").length;
		expect(countBefore).toBe(countAfter);
	});

	it("remove_rules removes non-builtin rule only", () => {
		const store = getDefaultStore();
		const s1 = applyPurification(store, {
			add_rules: [{ pattern: "removeme", mode: "exact", action: "skip" }],
		});
		expect(s1.rules.some((r) => r.pattern === "removeme")).toBe(true);
		const s2 = applyPurification(s1, {
			remove_rules: [{ pattern: "removeme", mode: "exact" }],
		});
		expect(s2.rules.some((r) => r.pattern === "removeme")).toBe(false);
	});

	it("remove_rules does NOT remove builtin rule", () => {
		const store = getDefaultStore();
		const builtinCountBefore = store.rules.filter((r) => r.pattern === "ok" && r.builtin).length;
		const result = applyPurification(store, {
			remove_rules: [{ pattern: "ok", mode: "exact" }],
		});
		const builtinCountAfter = result.rules.filter((r) => r.pattern === "ok" && r.builtin).length;
		expect(builtinCountAfter).toBe(builtinCountBefore);
	});

	it("bad_skips with suggestion 'remove' removes non-builtin skip", () => {
		const store = getDefaultStore();
		const s1 = applyPurification(store, {
			add_rules: [{ pattern: "bad_skip", mode: "exact", action: "skip" }],
		});
		const s2 = applyPurification(s1, {
			bad_skips: [{
				query: "bad_skip",
				matched_rules: ["bad_skip"],
				reason: "too aggressive",
				suggestion: "remove",
			}],
		});
		expect(s2.rules.some((r) => r.pattern === "bad_skip" && !r.builtin)).toBe(false);
	});

	it("bad_skips with suggestion 'add_guard' adds guard for builtin skip", () => {
		const store = getDefaultStore();
		const result = applyPurification(store, {
			bad_skips: [{
				query: "ok",
				matched_rules: ["ok"],
				reason: "should not skip questions",
				suggestion: "add_guard",
			}],
		});
		const guard = result.rules.find(
			(r) => r.pattern === "ok" && r.action === "guard" && !r.builtin,
		);
		expect(guard).toBeDefined();
		expect(guard!.mode).toBe("exact");
	});

	it("enforces MAX_SKIP_RULES (50) limit", () => {
		const store = getDefaultStore();
		const add_rules = Array.from({ length: 55 }, (_, i) => ({
			pattern: `custom_skip_${i}`,
			mode: "exact" as const,
			action: "skip" as const,
		}));
		const result = applyPurification(store, { add_rules });
		const nonBuiltinSkips = result.rules.filter((r) => r.action === "skip" && !r.builtin);
		expect(nonBuiltinSkips.length).toBeLessThanOrEqual(50);
	});

	it("enforces MAX_GUARD_RULES (30) limit", () => {
		const store = getDefaultStore();
		const add_rules = Array.from({ length: 35 }, (_, i) => ({
			pattern: `custom_guard_${i}`,
			mode: "exact" as const,
			action: "guard" as const,
		}));
		const result = applyPurification(store, { add_rules });
		const nonBuiltinGuards = result.rules.filter((r) => r.action === "guard" && !r.builtin);
		expect(nonBuiltinGuards.length).toBeLessThanOrEqual(30);
	});

	it("updates lastPurifyTimestamp", () => {
		const store = getDefaultStore();
		expect(store.lastPurifyTimestamp).toBe(0);
		const before = Date.now();
		const result = applyPurification(store, { add_rules: [] });
		const after = Date.now();
		expect(result.lastPurifyTimestamp).toBeGreaterThanOrEqual(before);
		expect(result.lastPurifyTimestamp).toBeLessThanOrEqual(after);
	});
});

describe("full flow: save and load with irrelevant files", () => {
	it("creates history with 3 irrelevant marks and verifies all present", () => {
		const store = getDefaultStore();
		let current = store;
		const files = [["a.ts"], ["b.ts", "c.ts"], ["d.ts"]];
		for (let i = 0; i < 3; i++) {
			current = addHistoryEntry(current, makeEntry({
				query: `q${i}`,
				userMarkedIrrelevant: true,
				irrelevantFiles: files[i],
			}));
		}
		for (let i = 0; i < 3; i++) {
			expect(current.history[i].userMarkedIrrelevant).toBe(true);
			expect(current.history[i].irrelevantFiles).toEqual(files[i]);
		}
	});

	it("saves store to temp file, loads back, and verifies data integrity", async () => {
		let store = getDefaultStore();
		store = addHistoryEntry(store, makeEntry({
			query: "save_test",
			userMarkedIrrelevant: true,
			irrelevantFiles: ["saved1.ts", "saved2.ts"],
		}));
		store = applyPurification(store, {
			add_rules: [{ pattern: "custom_rule", mode: "exact", action: "skip" }],
		});

		await saveSkipWordStore(tempDir, store);
		const loaded = loadSkipWordStore(tempDir);

		expect(loaded.version).toBe(store.version);
		expect(loaded.history).toHaveLength(1);
		expect(loaded.history[0].query).toBe("save_test");
		expect(loaded.history[0].userMarkedIrrelevant).toBe(true);
		expect(loaded.history[0].irrelevantFiles).toEqual(["saved1.ts", "saved2.ts"]);
		expect(loaded.rules.some((r) => r.pattern === "custom_rule")).toBe(true);
		expect(loaded.lastPurifyTimestamp).toBe(store.lastPurifyTimestamp);
	});
});
