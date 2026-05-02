import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPrefetch } from "../../extensions/auto-memory/index.js";
import { buildFrontmatter } from "../../extensions/auto-memory/utils.js";
import {
	evaluateRules,
	getDefaultStore,
	getGlobalMemoryDir,
	loadSkipWordStore,
	type PurificationResult,
	type SkipWordStore,
	saveSkipWordStore,
} from "../../extensions/prefetch/index.js";
import type { CallLLMOptions } from "../../src/core/extensions/index.js";

let tempDir: string;
let memoryDir: string;
let originalHome: string | undefined;

beforeEach(() => {
	originalHome = process.env.HOME;
	tempDir = mkdtempSync(join(tmpdir(), "purify-b-"));
	process.env.HOME = tempDir;
	memoryDir = join(tempDir, "project-memory");
	mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
	process.env.HOME = originalHome;
	rmSync(tempDir, { recursive: true, force: true });
});

function createMemoryFile(filename: string, content: string) {
	const fm = buildFrontmatter({
		name: filename.replace(/\.md$/, ""),
		description: "test file",
		type: "project",
	});
	writeFileSync(join(memoryDir, filename), `${fm}\n\n${content}`);
}

async function waitForSettled(prefetch: MemoryPrefetch, timeout = 3000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (prefetch.collect() !== null) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error("Timeout waiting for prefetch to settle");
}

function mockLLM(responses: Array<{ selected: string[]; purification?: PurificationResult }>) {
	let callCount = 0;
	const callLLM = async (_opts: CallLLMOptions): Promise<string> => {
		const idx = Math.min(callCount, responses.length - 1);
		callCount++;
		return JSON.stringify(responses[idx]);
	};
	return { callLLM, getCallCount: () => callCount };
}

function getStore(prefetch: MemoryPrefetch): SkipWordStore {
	return (prefetch as unknown as { store: SkipWordStore }).store;
}

describe("prefetch-purify-B: 反向净化 + 纠错", () => {
	describe("反向净化 — bad_skip 检测", () => {
		it("1. bad_skips with suggestion 'remove' → skip rule removed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "go on", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "go on",
								matched_rules: ["go on"],
								reason: "user actually wanted something",
								suggestion: "remove",
							},
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const storeAfterAdd = getStore(prefetch);
			expect(
				storeAfterAdd.rules.find((r) => r.pattern === "go on" && r.action === "skip" && !r.builtin),
			).toBeDefined();

			prefetch.start("another query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "go on" && r.action === "skip" && !r.builtin)).toBeUndefined();
		});

		it("2. bad_skips targeting builtin rule → builtin NOT removed, guard added instead", async () => {
			createMemoryFile("testing.md", "Test content.");

			const builtinPattern = "好的";
			const guardCountBefore = getDefaultStore().rules.filter(
				(r) => r.action === "guard" && r.pattern === builtinPattern,
			).length;

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "好的",
								matched_rules: [builtinPattern],
								reason: "should not skip this",
								suggestion: "add_guard",
							},
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("tell me about testing", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const storeAfter = getStore(prefetch);
			expect(
				storeAfter.rules.find((r) => r.pattern === builtinPattern && r.action === "skip" && r.builtin),
			).toBeDefined();

			const guardCountAfter = storeAfter.rules.filter(
				(r) => r.action === "guard" && r.pattern === builtinPattern,
			).length;
			expect(guardCountAfter).toBeGreaterThan(guardCountBefore);
		});

		it("3. bad_skips with suggestion 'add_guard' for non-builtin → skip rule kept, no guard added", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "next", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "next",
								matched_rules: ["next"],
								reason: "should add guard",
								suggestion: "add_guard",
							},
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const skipRule = store.rules.find((r) => r.pattern === "next" && r.action === "skip" && !r.builtin);
			expect(skipRule).toBeDefined();

			const guardRule = store.rules.find((r) => r.pattern === "next" && r.action === "guard" && !r.builtin);
			expect(guardRule).toBeUndefined();
		});

		it("4. multiple bad_skips in one response → all processed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "skip-a", mode: "exact", action: "skip" },
							{ pattern: "skip-b", mode: "exact", action: "skip" },
						],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "skip-a",
								matched_rules: ["skip-a"],
								reason: "bad",
								suggestion: "remove",
							},
							{
								query: "skip-b",
								matched_rules: ["skip-b"],
								reason: "bad",
								suggestion: "remove",
							},
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "skip-a" && r.action === "skip" && !r.builtin)).toBeUndefined();
			expect(store.rules.find((r) => r.pattern === "skip-b" && r.action === "skip" && !r.builtin)).toBeUndefined();
		});

		it("5. bad_skips with invalid suggestion → ignored, no crash", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "keep-me", mode: "exact", action: "skip" }],
						bad_skips: [
							{
								query: "keep-me",
								matched_rules: ["keep-me"],
								reason: "invalid suggestion",
								suggestion: "invalid_action" as "remove",
							},
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "keep-me" && r.action === "skip" && !r.builtin)).toBeDefined();
		});

		it("6. bad_skips removal + add_rules in same response → both applied", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "old-rule", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "old-rule",
								matched_rules: ["old-rule"],
								reason: "bad",
								suggestion: "remove",
							},
						],
						add_rules: [{ pattern: "new-rule", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("first", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "old-rule" && r.action === "skip" && !r.builtin)).toBeUndefined();
			expect(store.rules.find((r) => r.pattern === "new-rule" && r.action === "skip" && !r.builtin)).toBeDefined();
		});
	});

	describe("反向净化 — remove_rules", () => {
		it("7. remove_rules → matching non-builtin rule removed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "removeme", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [{ pattern: "removeme", mode: "exact" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("first", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "removeme")).toBeUndefined();
		});

		it("8. remove_rules for builtin → ignored (builtin cannot be removed)", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [{ pattern: "好的", mode: "exact" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "好的" && r.builtin)).toBeDefined();
		});

		it("9. remove_rules for nonexistent rule → no crash, no change", async () => {
			createMemoryFile("testing.md", "Test content.");

			const store = getDefaultStore();
			const countBefore = store.rules.length;

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [{ pattern: "nonexistent-xyz", mode: "exact" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const storeAfter = getStore(prefetch);
			expect(storeAfter.rules.length).toBe(countBefore);
		});

		it("10. multiple remove_rules → all matching removed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "rule-a", mode: "exact", action: "skip" },
							{ pattern: "rule-b", mode: "prefix", action: "guard" },
							{ pattern: "rule-c", mode: "contains", action: "skip" },
						],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [
							{ pattern: "rule-a", mode: "exact" },
							{ pattern: "rule-c", mode: "contains" },
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("first", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			expect(store.rules.find((r) => r.pattern === "rule-a")).toBeUndefined();
			expect(store.rules.find((r) => r.pattern === "rule-b" && r.action === "guard" && !r.builtin)).toBeDefined();
			expect(store.rules.find((r) => r.pattern === "rule-c")).toBeUndefined();
		});

		it("11. remove_rules preserves rule order (only target removed)", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "before-target", mode: "exact", action: "skip" },
							{ pattern: "target-to-remove", mode: "exact", action: "skip" },
							{ pattern: "after-target", mode: "exact", action: "skip" },
						],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [{ pattern: "target-to-remove", mode: "exact" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("first", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("second", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const customRules = store.rules.filter(
				(r) => ["before-target", "after-target", "target-to-remove"].includes(r.pattern) && !r.builtin,
			);
			const patterns = customRules.map((r) => r.pattern);
			expect(patterns).toContain("before-target");
			expect(patterns).toContain("after-target");
			expect(patterns).not.toContain("target-to-remove");

			const beforeIdx = store.rules.findIndex((r) => r.pattern === "before-target");
			const afterIdx = store.rules.findIndex((r) => r.pattern === "after-target");
			expect(beforeIdx).toBeLessThan(afterIdx);
		});
	});

	describe("反向净化 — guard 拦截正确性", () => {
		it("12. guard '但是' blocks skip '好的' prefix → goes to LLM", async () => {
			createMemoryFile("testing.md", "Guard test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "好的", mode: "prefix", action: "skip" },
							{ pattern: "但是", mode: "contains", action: "guard" },
						],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			prefetch.start("好的，但是我想问部署", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("好的");
			expect(lastEntry.guard_hits).toContain("但是");
		});

		it("13. '继续？我还有问题' → guard '？' blocks skip '继续' → goes to LLM", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			prefetch.start("继续？我还有问题", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("继续");
			expect(lastEntry.guard_hits).toContain("？");
		});

		it("14. '没问题\\n这是一个新的需求' → guard '\\n' blocks skip → goes to LLM", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "没问题", mode: "prefix", action: "skip" }],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			prefetch.start("没问题\n这是一个新的需求", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("没问题");
			expect(lastEntry.guard_hits).toContain("\n");
		});

		it("15. '执行吧，帮我配置一下' → guard '帮我' blocks skip → goes to LLM", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "执行", mode: "prefix", action: "skip" },
							{ pattern: "帮我", mode: "contains", action: "guard" },
						],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			prefetch.start("执行吧，帮我配置一下", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("执行");
			expect(lastEntry.guard_hits).toContain("帮我");
		});
	});

	describe("反向净化 — 综合场景", () => {
		it("16. full cycle: skip added → later found bad → removed → next time not skipped", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "go on", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "go on",
								matched_rules: ["go on"],
								reason: "bad skip",
								suggestion: "remove",
							},
						],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("go on", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			const storeAfterSkip = getStore(prefetch);
			const skipEntry = storeAfterSkip.history[storeAfterSkip.history.length - 1];
			expect(skipEntry.skipped).toBe(true);

			prefetch.start("another query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			prefetch.start("go on", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(3);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.query).toBe("go on");
		});

		it("17. full cycle: guard added → later removed → next time skip works again", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "继续", mode: "prefix", action: "skip" },
							{ pattern: "部署", mode: "contains", action: "guard" },
						],
					},
				},
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						remove_rules: [{ pattern: "部署", mode: "contains" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("继续部署", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const storeAfterGuard = getStore(prefetch);
			const guardEntry = storeAfterGuard.history[storeAfterGuard.history.length - 1];
			expect(guardEntry.skipped).toBe(false);
			expect(guardEntry.guard_hits).toContain("部署");

			prefetch.start("cleanup query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(3);

			prefetch.start("继续部署", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(true);
			expect(lastEntry.skip_hits).toContain("继续");
		});

		it("18. full cycle: builtin '好的' exact skip → guard '好的' exact added → '好的' now goes to LLM", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						bad_skips: [
							{
								query: "好的",
								matched_rules: ["好的"],
								reason: "builtin skip causing problems",
								suggestion: "add_guard",
							},
						],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup query to trigger purification", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const storeAfterGuard = getStore(prefetch);
			expect(
				storeAfterGuard.rules.find((r) => r.pattern === "好的" && r.action === "skip" && r.builtin),
			).toBeDefined();
			expect(
				storeAfterGuard.rules.find((r) => r.pattern === "好的" && r.action === "guard" && !r.builtin),
			).toBeDefined();

			prefetch.start("好的", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("好的");
			expect(lastEntry.guard_hits).toContain("好的");
		});

		it("19. LLM returns malformed purification → ignored, selected files still returned", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: "not an object" as unknown as PurificationResult,
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");

			const store = getStore(prefetch);
			const nonBuiltin = store.rules.filter((r) => !r.builtin);
			expect(nonBuiltin).toHaveLength(0);
		});

		it("20. LLM returns purification with all empty arrays → no changes, no crash", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [],
						remove_rules: [],
						bad_skips: [],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");

			const store = getStore(prefetch);
			const defaultStore = getDefaultStore();
			expect(store.rules.length).toBe(defaultStore.rules.length);
		});
	});
});
