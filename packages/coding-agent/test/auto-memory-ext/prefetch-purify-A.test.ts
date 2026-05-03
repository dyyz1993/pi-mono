import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPrefetch } from "../../extensions/auto-memory/index.js";
import {
	evaluateRules,
	getDefaultStore,
	getGlobalMemoryDir,
	loadSkipWordStore,
	type PurificationResult,
	type SkipWordStore,
	saveSkipWordStore,
} from "../../extensions/auto-memory/skip-rules.js";
import { buildFrontmatter } from "../../extensions/auto-memory/utils.js";
import type { CallLLMOptions } from "../../src/core/extensions/index.js";

let tempDir: string;
let memoryDir: string;
let originalHome: string | undefined;

beforeEach(() => {
	originalHome = process.env.HOME;
	tempDir = mkdtempSync(join(tmpdir(), "purify-a-"));
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

describe("prefetch-purify-A: 正向净化", () => {
	describe("正向净化 — 同话题延续", () => {
		it("1. first query -> LLM selects files -> no purification", async () => {
			createMemoryFile("testing.md", "Never mock database.");
			createMemoryFile("deploy.md", "Deploy with Docker.");

			const { callLLM, getCallCount } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("how to test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("testing.md");
			expect(result).toContain("Never mock database.");
			expect(result).not.toContain("deploy.md");
			expect(getCallCount()).toBe(1);

			const store = getStore(prefetch);
			const nonBuiltin = store.rules.filter((r) => !r.builtin);
			expect(nonBuiltin).toHaveLength(0);
		});

		it("2. second query same topic -> LLM returns purification with new skip rule", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM, getCallCount } = mockLLM([
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "继续吧", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("how to test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("more about testing", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const added = store.rules.find((r) => r.pattern === "继续吧" && r.mode === "exact" && r.action === "skip");
			expect(added).toBeDefined();
			expect(added!.builtin).toBe(false);
		});

		it("3. third query '继续吧' -> hits skip rule -> skips LLM", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM, getCallCount } = mockLLM([
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "继续吧", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("how to test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("more about testing", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const countBeforeSkip = getCallCount();

			prefetch.start("继续吧", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(countBeforeSkip);

			const result = prefetch.collect();
			expect(result).toContain("Never mock database.");

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(true);
			expect(lastEntry.skip_hits).toContain("继续吧");
		});

		it("4. skip rule persisted to disk after purification", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM } = mockLLM([
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "继续吧", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("how to test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("more about testing", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const diskStore = loadSkipWordStore(getGlobalMemoryDir());
			const persisted = diskStore.rules.find(
				(r) => r.pattern === "继续吧" && r.mode === "exact" && r.action === "skip",
			);
			expect(persisted).toBeDefined();
			expect(persisted!.builtin).toBe(false);
		});

		it("5. multiple continuations -> accumulate multiple skip rules", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM } = mockLLM([
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "继续吧", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "go on", mode: "exact", action: "skip" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "next please", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("query 1", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("query 2", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("query 3", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("query 4", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const customSkips = store.rules.filter((r) => r.action === "skip" && !r.builtin);
			expect(customSkips).toHaveLength(3);

			const patterns = customSkips.map((r) => r.pattern);
			expect(patterns).toContain("继续吧");
			expect(patterns).toContain("go on");
			expect(patterns).toContain("next please");
		});

		it("6. skip rule from regex pattern", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM } = mockLLM([
				{ selected: ["testing.md"] },
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "^接着.{0,3}$", mode: "regex", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("how to test", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("more testing", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("接着做", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(true);
			expect(lastEntry.skip_hits).toContain("^接着.{0,3}$");
		});
	});

	describe("正向净化 — 提取多个关键词", () => {
		it("7. LLM returns add_rules with 2 patterns -> both added", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "继续吧", mode: "exact", action: "skip" },
							{ pattern: "go on", mode: "exact", action: "skip" },
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const rule1 = store.rules.find((r) => r.pattern === "继续吧" && r.action === "skip" && !r.builtin);
			const rule2 = store.rules.find((r) => r.pattern === "go on" && r.action === "skip" && !r.builtin);
			expect(rule1).toBeDefined();
			expect(rule2).toBeDefined();
		});

		it("8. LLM returns add_rules with duplicate of existing -> no duplicate in store", async () => {
			createMemoryFile("testing.md", "Test content.");

			const purification: PurificationResult = {
				add_rules: [{ pattern: "dedup-test", mode: "exact", action: "skip" }],
			};

			const { callLLM } = mockLLM([
				{ selected: ["testing.md"], purification },
				{ selected: ["testing.md"], purification },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("query 1", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("query 2", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const matches = store.rules.filter(
				(r) => r.pattern === "dedup-test" && r.mode === "exact" && r.action === "skip",
			);
			expect(matches).toHaveLength(1);
		});

		it("9. add_rules exceeding max -> oldest non-builtin removed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const store = getDefaultStore();
			for (let i = 0; i < 50; i++) {
				store.rules.push({
					pattern: `custom-skip-${i}`,
					mode: "exact",
					action: "skip",
					builtin: false,
				});
			}
			await saveSkipWordStore(getGlobalMemoryDir(), store);

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "overflow-skip", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = getStore(prefetch);
			const nonBuiltinSkips = result.rules.filter((r) => r.action === "skip" && !r.builtin);
			expect(nonBuiltinSkips.length).toBeLessThanOrEqual(50);
			expect(result.rules.find((r) => r.pattern === "overflow-skip")).toBeDefined();
			expect(result.rules.find((r) => r.pattern === "custom-skip-0")).toBeUndefined();
		});

		it("10. add_rules with invalid mode -> ignored, selected files still work", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "fuzzy-match", mode: "fuzzy" as any, action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");

			const store = getStore(prefetch);
			const fuzzyRule = store.rules.find((r) => r.pattern === "fuzzy-match");
			expect(fuzzyRule).toBeDefined();

			const evalResult = evaluateRules("fuzzy-match", store.rules);
			expect(evalResult.shouldSkip).toBe(false);
		});
	});

	describe("正向净化 — guard 规则积累", () => {
		it("11. LLM returns add_rules with action: guard -> guard rule added", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "部署", mode: "contains", action: "guard" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const guard = store.rules.find((r) => r.pattern === "部署" && r.action === "guard" && !r.builtin);
			expect(guard).toBeDefined();
			expect(guard!.mode).toBe("contains");
		});

		it("12. new guard rule blocks future skip", async () => {
			createMemoryFile("testing.md", "Never mock database.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "部署", mode: "contains", action: "guard" }],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("deploy strategy", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			prefetch.start("继续部署", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.guard_hits).toContain("部署");
			expect(lastEntry.skip_hits).toContain("继续");
		});

		it("13. multiple guard rules accumulated over multiple turns", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "部署", mode: "contains", action: "guard" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "测试", mode: "prefix", action: "guard" }],
					},
				},
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "发布", mode: "contains", action: "guard" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("deploy strategy", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("test strategy", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("release process", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const customGuards = store.rules.filter((r) => r.action === "guard" && !r.builtin);
			expect(customGuards).toHaveLength(3);

			const patterns = customGuards.map((r) => r.pattern);
			expect(patterns).toContain("部署");
			expect(patterns).toContain("测试");
			expect(patterns).toContain("发布");
		});

		it("14. guard rule with regex pattern works correctly", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "go", mode: "prefix", action: "skip" },
							{ pattern: "^go.*deploy$", mode: "regex", action: "guard" },
						],
					},
				},
				{ selected: ["testing.md"] },
			]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("setup query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("go ahead and deploy", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("go");
			expect(lastEntry.guard_hits).toContain("^go.*deploy$");
		});
	});

	describe("正向净化 — 历史 record 正确性", () => {
		it("15. history records skip_hits correctly when skipped", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("some query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("继续", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(true);
			expect(lastEntry.skip_hits.length).toBeGreaterThan(0);
			expect(lastEntry.skip_hits).toContain("继续");
			expect(lastEntry.selected).toEqual(["testing.md"]);
		});

		it("16. history records guard_hits correctly when guard blocks skip", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("some query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("继续吗", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("继续");
			expect(lastEntry.guard_hits).toContain("吗");
		});

		it("17. history records both skip_hits and guard_hits when both match", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("some query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			prefetch.start("继续？但我想问部署", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.skipped).toBe(false);
			expect(lastEntry.skip_hits).toContain("继续");
			expect(lastEntry.guard_hits).toContain("？");
		});

		it("18. history is trimmed to 20 entries after many turns", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("initial query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			for (let i = 0; i < 24; i++) {
				prefetch.start("ok", memoryDir, callLLM);
				await waitForSettled(prefetch);
			}

			const store = getStore(prefetch);
			expect(store.history.length).toBe(20);
			expect(store.history[0].query).toBe("ok");
		});
	});
});
