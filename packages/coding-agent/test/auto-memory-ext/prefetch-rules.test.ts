import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addHistoryEntry,
	applyPurification,
	evaluateRules,
	getDefaultRules,
	getDefaultStore,
	getGlobalMemoryDir,
	type HistoryEntry,
	loadSkipWordStore,
	matchRule,
	type PurificationResult,
	type SkipRule,
	type SkipWordStore,
	saveSkipWordStore,
} from "../../extensions/auto-memory/skip-rules.js";

function makeSkipRule(overrides: Partial<SkipRule> & { pattern: string }): SkipRule {
	return {
		mode: "exact",
		action: "skip",
		builtin: false,
		...overrides,
	};
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> & { query: string }): HistoryEntry {
	return {
		selected: [],
		skipped: false,
		skip_hits: [],
		guard_hits: [],
		timestamp: Date.now(),
		...overrides,
	};
}

describe("prefetch-rules", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `prefetch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("matchRule()", () => {
		it("exact: matches identical query", () => {
			const rule = makeSkipRule({ pattern: "继续", mode: "exact" });
			expect(matchRule("继续", rule)).toBe(true);
		});

		it("exact: does NOT match different query", () => {
			const rule = makeSkipRule({ pattern: "继续", mode: "exact" });
			expect(matchRule("继续吧", rule)).toBe(false);
		});

		it("prefix: matches query starting with pattern", () => {
			const rule = makeSkipRule({ pattern: "继续", mode: "prefix" });
			expect(matchRule("继续吧", rule)).toBe(true);
		});

		it("prefix: does NOT match query ending with pattern", () => {
			const rule = makeSkipRule({ pattern: "继续", mode: "prefix" });
			expect(matchRule("好的继续", rule)).toBe(false);
		});

		it("contains: matches query containing pattern", () => {
			const rule = makeSkipRule({ pattern: "部署", mode: "contains" });
			expect(matchRule("帮我看看部署日志", rule)).toBe(true);
		});

		it("contains: does NOT match query without pattern", () => {
			const rule = makeSkipRule({ pattern: "部署", mode: "contains" });
			expect(matchRule("帮忙看看日志", rule)).toBe(false);
		});

		it("regex: matches patterns within bounds", () => {
			const rule = makeSkipRule({ pattern: "^继续.{0,4}$", mode: "regex" });
			expect(matchRule("继续", rule)).toBe(true);
			expect(matchRule("继续吧", rule)).toBe(true);
			expect(matchRule("继续执行", rule)).toBe(true);
		});

		it("regex: does NOT match patterns outside bounds", () => {
			const rule = makeSkipRule({ pattern: "^继续.{0,3}$", mode: "regex" });
			expect(matchRule("继续执行部署", rule)).toBe(false);
		});

		it("case insensitive for exact mode", () => {
			const rule = makeSkipRule({ pattern: "OK", mode: "exact" });
			expect(matchRule("ok", rule)).toBe(true);
			expect(matchRule("Ok", rule)).toBe(true);
		});

		it("case insensitive for prefix mode", () => {
			const rule = makeSkipRule({ pattern: "OK", mode: "prefix" });
			expect(matchRule("ok", rule)).toBe(true);
			expect(matchRule("Ok!", rule)).toBe(true);
		});

		it("case insensitive for contains mode", () => {
			const rule = makeSkipRule({ pattern: "OK", mode: "contains" });
			expect(matchRule("say ok now", rule)).toBe(true);
		});

		it("returns false for empty query", () => {
			const rule = makeSkipRule({ pattern: "继续", mode: "exact" });
			expect(matchRule("", rule)).toBe(false);
		});

		it("returns false for empty pattern", () => {
			const rule = makeSkipRule({ pattern: "", mode: "exact" });
			expect(matchRule("继续", rule)).toBe(false);
		});

		it("returns false for invalid regex without crashing", () => {
			const rule = makeSkipRule({ pattern: "([invalid", mode: "regex" });
			expect(matchRule("anything", rule)).toBe(false);
		});
	});

	describe("evaluateRules()", () => {
		it("returns no match with empty rules", () => {
			const result = evaluateRules("继续", []);
			expect(result).toEqual({ shouldSkip: false, skipHits: [], guardHits: [] });
		});

		it("single skip rule matches", () => {
			const rules = [makeSkipRule({ pattern: "继续", mode: "exact", action: "skip" })];
			const result = evaluateRules("继续", rules);
			expect(result.shouldSkip).toBe(true);
			expect(result.skipHits).toEqual(["继续"]);
			expect(result.guardHits).toEqual([]);
		});

		it("multiple skip rules match", () => {
			const rules = [
				makeSkipRule({ pattern: "继续", mode: "exact", action: "skip" }),
				makeSkipRule({ pattern: "^继续.{0,4}$", mode: "regex", action: "skip" }),
			];
			const result = evaluateRules("继续", rules);
			expect(result.shouldSkip).toBe(true);
			expect(result.skipHits).toEqual(["继续", "^继续.{0,4}$"]);
			expect(result.guardHits).toEqual([]);
		});

		it("guard overrides skip", () => {
			const rules = [
				makeSkipRule({ pattern: "好的", mode: "contains", action: "skip" }),
				makeSkipRule({ pattern: "？", mode: "contains", action: "guard" }),
			];
			const result = evaluateRules("好的？帮我看看", rules);
			expect(result.shouldSkip).toBe(false);
			expect(result.skipHits).toEqual(["好的"]);
			expect(result.guardHits).toEqual(["？"]);
		});

		it("guard without skip", () => {
			const rules = [makeSkipRule({ pattern: "怎么", mode: "prefix", action: "guard" })];
			const result = evaluateRules("怎么配置", rules);
			expect(result.shouldSkip).toBe(false);
			expect(result.skipHits).toEqual([]);
			expect(result.guardHits).toEqual(["怎么"]);
		});

		it("guard has higher priority than skip", () => {
			const rules = [
				makeSkipRule({ pattern: "ok", mode: "exact", action: "skip" }),
				makeSkipRule({ pattern: "ok", mode: "exact", action: "guard" }),
			];
			const result = evaluateRules("ok", rules);
			expect(result.shouldSkip).toBe(false);
			expect(result.guardHits).toEqual(["ok"]);
		});

		it("builtin flag does not affect matching", () => {
			const builtin = makeSkipRule({ pattern: "继续", mode: "exact", action: "skip", builtin: true });
			const nonBuiltin = makeSkipRule({ pattern: "继续", mode: "exact", action: "skip", builtin: false });
			expect(matchRule("继续", builtin)).toBe(matchRule("继续", nonBuiltin));
		});

		it("mixed prefix + contains matches both", () => {
			const rules = [
				makeSkipRule({ pattern: "go", mode: "prefix", action: "skip" }),
				makeSkipRule({ pattern: "go", mode: "contains", action: "skip" }),
			];
			const result = evaluateRules("go ahead", rules);
			expect(result.skipHits).toEqual(["go", "go"]);
		});

		it("mixed exact + prefix + contains matches all on exact match", () => {
			const rules = [
				makeSkipRule({ pattern: "go", mode: "exact", action: "skip" }),
				makeSkipRule({ pattern: "go", mode: "prefix", action: "skip" }),
				makeSkipRule({ pattern: "go", mode: "contains", action: "skip" }),
			];
			const result = evaluateRules("go", rules);
			expect(result.skipHits).toEqual(["go", "go", "go"]);
		});

		it("regex skip rule matches", () => {
			const rules = [makeSkipRule({ pattern: "^好.{0,2}$", mode: "regex", action: "skip" })];
			const result = evaluateRules("好的", rules);
			expect(result.shouldSkip).toBe(true);
			expect(result.skipHits).toEqual(["^好.{0,2}$"]);
		});

		it("query with newline triggers guard", () => {
			const rules = [
				makeSkipRule({ pattern: "ok", mode: "exact", action: "skip" }),
				makeSkipRule({ pattern: "\\n", mode: "contains", action: "guard" }),
			];
			const result = evaluateRules("ok\nnext line", rules);
			expect(result.shouldSkip).toBe(false);
		});
	});

	describe("getDefaultRules()", () => {
		it("returns 11 builtin skip rules", () => {
			const rules = getDefaultRules();
			const skipRules = rules.filter((r) => r.action === "skip");
			expect(skipRules.length).toBe(11);
		});

		it("returns builtin guard rules", () => {
			const rules = getDefaultRules();
			const guardRules = rules.filter((r) => r.action === "guard");
			expect(guardRules.length).toBeGreaterThan(0);
		});

		it("all default skip rules have builtin: true", () => {
			const rules = getDefaultRules();
			const skipRules = rules.filter((r) => r.action === "skip");
			for (const rule of skipRules) {
				expect(rule.builtin).toBe(true);
			}
		});

		it("all default guard rules have builtin: true", () => {
			const rules = getDefaultRules();
			const guardRules = rules.filter((r) => r.action === "guard");
			for (const rule of guardRules) {
				expect(rule.builtin).toBe(true);
			}
		});

		it("default rules are deterministic", () => {
			const first = getDefaultRules();
			const second = getDefaultRules();
			expect(first).toEqual(second);
		});

		it('"继续" matches default skip rules', () => {
			const rules = getDefaultRules();
			const result = evaluateRules("继续", rules);
			expect(result.shouldSkip).toBe(true);
		});

		it('"怎么配置" is blocked by default guard rules', () => {
			const rules = getDefaultRules();
			const result = evaluateRules("怎么配置", rules);
			expect(result.shouldSkip).toBe(false);
		});

		it('"好的，帮我看看？" is blocked by guard (?)', () => {
			const rules = getDefaultRules();
			const result = evaluateRules("好的，帮我看看？", rules);
			expect(result.shouldSkip).toBe(false);
			expect(result.guardHits.length).toBeGreaterThan(0);
		});
	});

	describe("loadSkipWordStore / saveSkipWordStore", () => {
		it("load from nonexistent file returns default store", () => {
			const store = loadSkipWordStore(join(tempDir, "nonexistent"));
			expect(store.version).toBe(1);
			expect(store.rules).toEqual(getDefaultRules());
			expect(store.history).toEqual([]);
		});

		it("save then load returns same data", async () => {
			const original = getDefaultStore();
			original.rules.push(makeSkipRule({ pattern: "test-rule", mode: "exact" }));
			original.history.push(makeHistoryEntry({ query: "test-query" }));

			await saveSkipWordStore(tempDir, original);
			const loaded = loadSkipWordStore(tempDir);

			expect(loaded.rules).toEqual(original.rules);
			expect(loaded.history).toEqual(original.history);
			expect(loaded.version).toBe(original.version);
		});

		it("save creates parent directories", async () => {
			const deepDir = join(tempDir, "a", "b", "c");
			await saveSkipWordStore(deepDir, getDefaultStore());
			const loaded = loadSkipWordStore(deepDir);
			expect(loaded.version).toBe(1);
		});

		it("save handles empty history", async () => {
			const store = getDefaultStore();
			store.history = [];
			await saveSkipWordStore(tempDir, store);
			const loaded = loadSkipWordStore(tempDir);
			expect(loaded.history).toEqual([]);
		});

		it("save handles large rule set (50 rules)", async () => {
			const store = getDefaultStore();
			for (let i = 0; i < 50; i++) {
				store.rules.push(makeSkipRule({ pattern: `rule-${i}`, mode: "exact" }));
			}
			await saveSkipWordStore(tempDir, store);
			const loaded = loadSkipWordStore(tempDir);
			expect(loaded.rules.length).toBeGreaterThanOrEqual(50);
		});

		it("history is trimmed to 20 entries on load", async () => {
			const store = getDefaultStore();
			for (let i = 0; i < 30; i++) {
				store.history.push(makeHistoryEntry({ query: `q-${i}`, timestamp: i }));
			}
			await saveSkipWordStore(tempDir, store);
			const loaded = loadSkipWordStore(tempDir);
			expect(loaded.history.length).toBe(20);
			expect(loaded.history[0].query).toBe("q-10");
			expect(loaded.history[19].query).toBe("q-29");
		});
	});

	describe("addHistoryEntry()", () => {
		it("adds entry to empty history", () => {
			const store = getDefaultStore();
			store.history = [];
			const entry = makeHistoryEntry({ query: "hello" });
			const result = addHistoryEntry(store, entry);
			expect(result.history.length).toBe(1);
			expect(result.history[0].query).toBe("hello");
		});

		it("trims to 20 entries", () => {
			const store = getDefaultStore();
			store.history = [];
			for (let i = 0; i < 20; i++) {
				store.history.push(makeHistoryEntry({ query: `q-${i}` }));
			}
			const entry = makeHistoryEntry({ query: "overflow" });
			const result = addHistoryEntry(store, entry);
			expect(result.history.length).toBe(20);
			expect(result.history[0].query).toBe("q-1");
			expect(result.history[19].query).toBe("overflow");
		});

		it("preserves order (oldest first)", () => {
			const store = getDefaultStore();
			store.history = [];
			const e1 = makeHistoryEntry({ query: "first", timestamp: 100 });
			const e2 = makeHistoryEntry({ query: "second", timestamp: 200 });
			let result = addHistoryEntry(store, e1);
			result = addHistoryEntry(result, e2);
			expect(result.history[0].query).toBe("first");
			expect(result.history[1].query).toBe("second");
		});

		it("handles entries with skip_hits", () => {
			const store = getDefaultStore();
			store.history = [];
			const entry = makeHistoryEntry({
				query: "继续",
				skipped: true,
				skip_hits: ["继续"],
			});
			const result = addHistoryEntry(store, entry);
			expect(result.history[0].skip_hits).toEqual(["继续"]);
		});

		it("handles entries with guard_hits", () => {
			const store = getDefaultStore();
			store.history = [];
			const entry = makeHistoryEntry({
				query: "怎么配置",
				skipped: false,
				guard_hits: ["怎么"],
			});
			const result = addHistoryEntry(store, entry);
			expect(result.history[0].guard_hits).toEqual(["怎么"]);
		});
	});

	describe("applyPurification()", () => {
		it("add_rules: adds new skip rule", () => {
			const store = getDefaultStore();
			const result: PurificationResult = {
				add_rules: [{ pattern: "测试跳过", mode: "exact", action: "skip" }],
			};
			const updated = applyPurification(store, result);
			const added = updated.rules.find((r) => r.pattern === "测试跳过");
			expect(added).toBeDefined();
			expect(added!.action).toBe("skip");
			expect(added!.builtin).toBeFalsy();
		});

		it("add_rules: adds new guard rule", () => {
			const store = getDefaultStore();
			const result: PurificationResult = {
				add_rules: [{ pattern: "测试守卫", mode: "prefix", action: "guard" }],
			};
			const updated = applyPurification(store, result);
			const added = updated.rules.find((r) => r.pattern === "测试守卫");
			expect(added).toBeDefined();
			expect(added!.action).toBe("guard");
		});

		it("add_rules: does not exceed 50 skip rules (trims oldest non-builtin)", () => {
			const store = getDefaultStore();
			const builtinSkipCount = store.rules.filter((r) => r.action === "skip").length;
			for (let i = 0; i < 50; i++) {
				store.rules.push(makeSkipRule({ pattern: `custom-skip-${i}`, mode: "exact", action: "skip" }));
			}
			const result: PurificationResult = {
				add_rules: [{ pattern: "overflow-skip", mode: "exact", action: "skip" }],
			};
			const updated = applyPurification(store, result);
			const nonBuiltinSkips = updated.rules.filter((r) => r.action === "skip" && !r.builtin);
			expect(nonBuiltinSkips.length).toBeLessThanOrEqual(50);
			expect(updated.rules.find((r) => r.pattern === "overflow-skip")).toBeDefined();
			expect(updated.rules.find((r) => r.pattern === "custom-skip-0")).toBeUndefined();
		});

		it("add_rules: does not exceed 30 guard rules (trims oldest non-builtin)", () => {
			const store = getDefaultStore();
			for (let i = 0; i < 30; i++) {
				store.rules.push(makeSkipRule({ pattern: `custom-guard-${i}`, mode: "exact", action: "guard" }));
			}
			const result: PurificationResult = {
				add_rules: [{ pattern: "overflow-guard", mode: "exact", action: "guard" }],
			};
			const updated = applyPurification(store, result);
			const nonBuiltinGuards = updated.rules.filter((r) => r.action === "guard" && !r.builtin);
			expect(nonBuiltinGuards.length).toBeLessThanOrEqual(30);
			expect(updated.rules.find((r) => r.pattern === "overflow-guard")).toBeDefined();
		});

		it("add_rules: deduplicates same pattern+mode+action", () => {
			const store = getDefaultStore();
			const result: PurificationResult = {
				add_rules: [{ pattern: "dedup-test", mode: "exact", action: "skip" }],
			};
			const first = applyPurification(store, result);
			const second = applyPurification(first, result);
			const matches = second.rules.filter(
				(r) => r.pattern === "dedup-test" && r.mode === "exact" && r.action === "skip",
			);
			expect(matches.length).toBe(1);
		});

		it("remove_rules: removes matching rule", () => {
			const store = getDefaultStore();
			store.rules.push(makeSkipRule({ pattern: "removable", mode: "exact", action: "skip" }));
			const result: PurificationResult = {
				remove_rules: [{ pattern: "removable", mode: "exact" }],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.find((r) => r.pattern === "removable")).toBeUndefined();
		});

		it("remove_rules: cannot remove builtin rules", () => {
			const store = getDefaultStore();
			const builtin = store.rules.find((r) => r.builtin && r.action === "skip");
			expect(builtin).toBeDefined();
			const result: PurificationResult = {
				remove_rules: [{ pattern: builtin!.pattern, mode: builtin!.mode }],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.find((r) => r.pattern === builtin!.pattern)).toBeDefined();
		});

		it("remove_rules: no match = no change", () => {
			const store = getDefaultStore();
			const countBefore = store.rules.length;
			const result: PurificationResult = {
				remove_rules: [{ pattern: "nonexistent-pattern", mode: "exact" }],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.length).toBe(countBefore);
		});

		it("bad_skips processing: removes skip rule that caused bad skip (if not builtin)", () => {
			const store = getDefaultStore();
			store.rules.push(makeSkipRule({ pattern: "bad-skip-rule", mode: "exact", action: "skip" }));
			const result: PurificationResult = {
				bad_skips: [
					{
						query: "bad-skip-rule matched",
						matched_rules: ["bad-skip-rule"],
						reason: "should not have been skipped",
						suggestion: "remove",
					},
				],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.find((r) => r.pattern === "bad-skip-rule")).toBeUndefined();
		});

		it("bad_skips processing: cannot remove builtin skip, adds guard instead", () => {
			const store = getDefaultStore();
			const builtin = store.rules.find((r) => r.builtin && r.action === "skip");
			expect(builtin).toBeDefined();
			const guardCountBefore = store.rules.filter((r) => r.action === "guard").length;
			const result: PurificationResult = {
				bad_skips: [
					{
						query: "some query",
						matched_rules: [builtin!.pattern],
						reason: "bad skip",
						suggestion: "add_guard",
					},
				],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.find((r) => r.pattern === builtin!.pattern)).toBeDefined();
			const guardCountAfter = updated.rules.filter((r) => r.action === "guard").length;
			expect(guardCountAfter).toBeGreaterThan(guardCountBefore);
		});

		it("combined: add + remove in one call", () => {
			const store = getDefaultStore();
			store.rules.push(makeSkipRule({ pattern: "to-remove", mode: "exact", action: "skip" }));
			const result: PurificationResult = {
				add_rules: [{ pattern: "to-add", mode: "prefix", action: "skip" }],
				remove_rules: [{ pattern: "to-remove", mode: "exact" }],
			};
			const updated = applyPurification(store, result);
			expect(updated.rules.find((r) => r.pattern === "to-add")).toBeDefined();
			expect(updated.rules.find((r) => r.pattern === "to-remove")).toBeUndefined();
		});
	});

	describe("getGlobalMemoryDir()", () => {
		it("returns path ending with .pi/agent/memory", () => {
			const dir = getGlobalMemoryDir();
			expect(dir).toMatch(/\.pi[\\/]+agent[\\/]+memory$/);
		});
	});

	describe("integration", () => {
		it("full cycle: load → evaluate '继续' → skip → add history → save → reload → still skips", async () => {
			const store = loadSkipWordStore(tempDir);
			const eval1 = evaluateRules("继续", store.rules);
			expect(eval1.shouldSkip).toBe(true);

			const entry = makeHistoryEntry({
				query: "继续",
				skipped: true,
				skip_hits: eval1.skipHits,
			});
			const updated = addHistoryEntry(store, entry);
			await saveSkipWordStore(tempDir, updated);

			const reloaded = loadSkipWordStore(tempDir);
			const eval2 = evaluateRules("继续", reloaded.rules);
			expect(eval2.shouldSkip).toBe(true);
			expect(reloaded.history.length).toBe(1);
		});

		it("full cycle: evaluate '好的，帮我看看？' → guard blocks skip → correct", () => {
			const store = getDefaultStore();
			const result = evaluateRules("好的，帮我看看？", store.rules);
			expect(result.shouldSkip).toBe(false);
			expect(result.guardHits.length).toBeGreaterThan(0);
		});

		it("full cycle: evaluate '继续吧' → skip via prefix → add rule → evaluate again", () => {
			const store = getDefaultStore();
			let result = evaluateRules("继续吧", store.rules);
			expect(result.shouldSkip).toBe(true);

			store.rules.push(makeSkipRule({ pattern: "继续吧", mode: "exact", action: "skip" }));
			result = evaluateRules("继续吧", store.rules);
			expect(result.shouldSkip).toBe(true);
			expect(result.skipHits).toContain("继续吧");
		});

		it("full cycle: add many rules → max cap enforced → oldest non-builtin removed", () => {
			const store = getDefaultStore();
			for (let i = 0; i < 55; i++) {
				store.rules.push(makeSkipRule({ pattern: `bulk-${i}`, mode: "exact", action: "skip" }));
			}
			const result: PurificationResult = {
				add_rules: [{ pattern: "new-after-bulk", mode: "exact", action: "skip" }],
			};
			const updated = applyPurification(store, result);
			const nonBuiltinSkips = updated.rules.filter((r) => r.action === "skip" && !r.builtin);
			expect(nonBuiltinSkips.length).toBeLessThanOrEqual(50);
			expect(updated.rules.find((r) => r.pattern === "new-after-bulk")).toBeDefined();
			expect(updated.rules.find((r) => r.pattern === "bulk-0")).toBeUndefined();
		});

		it("full cycle: bad skip detected → remove rule → next time not skipped", () => {
			let store = getDefaultStore();
			store.rules.push(makeSkipRule({ pattern: "remove-me", mode: "exact", action: "skip" }));

			let result = evaluateRules("remove-me", store.rules);
			expect(result.shouldSkip).toBe(true);

			const purification: PurificationResult = {
				bad_skips: [
					{
						query: "remove-me",
						matched_rules: ["remove-me"],
						reason: "should not skip",
						suggestion: "remove",
					},
				],
			};
			store = applyPurification(store, purification);

			result = evaluateRules("remove-me", store.rules);
			expect(result.shouldSkip).toBe(false);
		});
	});
});
