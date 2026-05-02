import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPrefetch } from "../../extensions/auto-memory/index.js";
import { buildFrontmatter } from "../../extensions/auto-memory/utils.js";
import {
	applyPurification,
	evaluateRules,
	getDefaultStore,
	getGlobalMemoryDir,
	type HistoryEntry,
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
	tempDir = mkdtempSync(join(tmpdir(), "purify-c-"));
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

describe("prefetch-purify-C: edge cases + stress + persistence + concurrency", () => {
	describe("边界情况 — 空/异常输入", () => {
		it("1. empty query -> no skip rules match -> LLM called, returns empty (no files selected from empty manifest content)", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([{ selected: [] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);
			expect(prefetch.collect()).toBe("");
		});

		it("2. very long query (10000 chars) -> truncated to 200 in history", async () => {
			createMemoryFile("testing.md", "Test content.");

			const longQuery = "a".repeat(10000);

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start(longQuery, memoryDir, callLLM);
			await waitForSettled(prefetch);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry).toBeDefined();
			expect(lastEntry.query.length).toBe(200);
			expect(lastEntry.query).toBe("a".repeat(200));
		});

		it("3. query with only whitespace -> no skip rules match -> LLM called normally", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("   ", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);
			expect(prefetch.collect()).toContain("Test content.");
		});

		it("4. query with special regex chars -> no crash in regex matching", async () => {
			createMemoryFile("testing.md", "Test content.");

			const specialQuery = ".*+?^${}()|[]";

			const { callLLM, getCallCount } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start(specialQuery, memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			const store = getStore(prefetch);
			const lastEntry = store.history[store.history.length - 1];
			expect(lastEntry.query).toBe(specialQuery.slice(0, 200));
		});

		it("5. Unicode: Japanese query -> not skipped (not in rules)", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM, getCallCount } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("継続してください", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(getCallCount()).toBe(1);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");
		});
	});

	describe("边界情况 — LLM 异常", () => {
		it("6. LLM returns non-JSON string -> collect returns empty (no crash)", async () => {
			createMemoryFile("testing.md", "Test content.");

			let callCount = 0;
			const callLLM = async (_opts: CallLLMOptions): Promise<string> => {
				callCount++;
				return "this is not JSON at all";
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(callCount).toBe(1);
			expect(prefetch.collect()).toBe("");
		});

		it("7. LLM returns JSON without 'selected' field -> treated as empty selection", async () => {
			createMemoryFile("testing.md", "Test content.");

			let callCount = 0;
			const callLLM = async (_opts: CallLLMOptions): Promise<string> => {
				callCount++;
				return JSON.stringify({ other_field: "value" });
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(callCount).toBe(1);
			expect(prefetch.collect()).toBe("");
		});

		it("8. LLM returns JSON with 'selected' as string instead of array -> treated as empty", async () => {
			createMemoryFile("testing.md", "Test content.");

			let callCount = 0;
			const callLLM = async (_opts: CallLLMOptions): Promise<string> => {
				callCount++;
				return JSON.stringify({ selected: "testing.md" });
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(callCount).toBe(1);
			expect(prefetch.collect()).toBe("");
		});

		it("9. LLM throws error -> collect returns empty (no crash)", async () => {
			createMemoryFile("testing.md", "Test content.");

			let callCount = 0;
			const callLLM = async (_opts: CallLLMOptions): Promise<string> => {
				callCount++;
				throw new Error("LLM service unavailable");
			};

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			expect(callCount).toBe(1);
			expect(prefetch.collect()).toBe("");
		});

		it("10. LLM returns purification with add_rules containing invalid mode -> selected still works", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "fuzzy-test", mode: "fuzzy" as any, action: "skip" }],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const result = prefetch.collect();
			expect(result).toContain("Test content.");

			const store = getStore(prefetch);
			const fuzzyRule = store.rules.find((r) => r.pattern === "fuzzy-test");
			expect(fuzzyRule).toBeDefined();

			const evalResult = evaluateRules("fuzzy-test", store.rules);
			expect(evalResult.shouldSkip).toBe(false);
		});
	});

	describe("压力测试 — 大量规则", () => {
		it("11. pre-populate 49 skip rules -> add 2 more -> oldest non-builtin evicted, max 50 enforced", async () => {
			createMemoryFile("testing.md", "Test content.");

			const store = getDefaultStore();
			for (let i = 0; i < 49; i++) {
				store.rules.push({
					pattern: `stress-skip-${i}`,
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
						add_rules: [
							{ pattern: "stress-skip-new1", mode: "exact", action: "skip" },
							{ pattern: "stress-skip-new2", mode: "exact", action: "skip" },
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const resultStore = getStore(prefetch);
			const nonBuiltinSkips = resultStore.rules.filter((r) => r.action === "skip" && !r.builtin);
			expect(nonBuiltinSkips.length).toBeLessThanOrEqual(50);
			expect(resultStore.rules.find((r) => r.pattern === "stress-skip-new1")).toBeDefined();
			expect(resultStore.rules.find((r) => r.pattern === "stress-skip-new2")).toBeDefined();
			expect(resultStore.rules.find((r) => r.pattern === "stress-skip-0")).toBeUndefined();
			expect(resultStore.rules.find((r) => r.pattern === "stress-skip-1")).toBeDefined();
		});

		it("12. pre-populate 29 guard rules -> add 2 more -> max 30 enforced", async () => {
			createMemoryFile("testing.md", "Test content.");

			const store = getDefaultStore();
			for (let i = 0; i < 29; i++) {
				store.rules.push({
					pattern: `stress-guard-${i}`,
					mode: "contains",
					action: "guard",
					builtin: false,
				});
			}
			await saveSkipWordStore(getGlobalMemoryDir(), store);

			const { callLLM } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [
							{ pattern: "stress-guard-new1", mode: "contains", action: "guard" },
							{ pattern: "stress-guard-new2", mode: "contains", action: "guard" },
						],
					},
				},
			]);

			const prefetch = new MemoryPrefetch();
			prefetch.start("test query", memoryDir, callLLM);
			await waitForSettled(prefetch);

			const resultStore = getStore(prefetch);
			const nonBuiltinGuards = resultStore.rules.filter((r) => r.action === "guard" && !r.builtin);
			expect(nonBuiltinGuards.length).toBeLessThanOrEqual(30);
			expect(resultStore.rules.find((r) => r.pattern === "stress-guard-new1")).toBeDefined();
			expect(resultStore.rules.find((r) => r.pattern === "stress-guard-new2")).toBeDefined();
			expect(resultStore.rules.find((r) => r.pattern === "stress-guard-0")).toBeUndefined();
		});

		it("13. 50 rapid consecutive prefetch calls -> all complete without crash, history trimmed", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch = new MemoryPrefetch();

			for (let i = 0; i < 50; i++) {
				prefetch.start(`query-${i}`, memoryDir, callLLM);
				await waitForSettled(prefetch);
			}

			const store = getStore(prefetch);
			expect(store.history.length).toBeLessThanOrEqual(20);
		});
	});

	describe("持久化 — 跨实例", () => {
		it("14. instance 1 does prefetch with purification -> save store -> instance 2 loads -> verify persisted", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM: callLLM1 } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "persist-test", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch1 = new MemoryPrefetch();
			prefetch1.start("test query", memoryDir, callLLM1);
			await waitForSettled(prefetch1);

			const diskStore = loadSkipWordStore(getGlobalMemoryDir());
			expect(
				diskStore.rules.find((r) => r.pattern === "persist-test" && r.action === "skip" && !r.builtin),
			).toBeDefined();

			const { callLLM: callLLM2 } = mockLLM([{ selected: ["testing.md"] }]);

			const prefetch2 = new MemoryPrefetch();
			prefetch2.start("test query 2", memoryDir, callLLM2);
			await waitForSettled(prefetch2);

			const store2 = getStore(prefetch2);
			expect(
				store2.rules.find((r) => r.pattern === "persist-test" && r.action === "skip" && !r.builtin),
			).toBeDefined();
		});

		it("15. instance 1 adds skip rule '继续吧' -> instance 2 receives query '继续吧' -> skipped", async () => {
			createMemoryFile("testing.md", "Test content.");

			const { callLLM: callLLM1 } = mockLLM([
				{
					selected: ["testing.md"],
					purification: {
						add_rules: [{ pattern: "继续吧", mode: "exact", action: "skip" }],
					},
				},
			]);

			const prefetch1 = new MemoryPrefetch();
			prefetch1.start("test query", memoryDir, callLLM1);
			await waitForSettled(prefetch1);

			let llm2Called = false;
			const callLLM2 = async (_opts: CallLLMOptions): Promise<string> => {
				llm2Called = true;
				return JSON.stringify({ selected: ["testing.md"] });
			};

			const prefetch2 = new MemoryPrefetch();
			prefetch2.start("继续吧", memoryDir, callLLM2);
			await waitForSettled(prefetch2);

			expect(llm2Called).toBe(false);

			const store2 = getStore(prefetch2);
			const lastEntry = store2.history[store2.history.length - 1];
			expect(lastEntry.skipped).toBe(true);
			expect(lastEntry.skip_hits).toContain("继续吧");
		});

		it("16. store file corrupted (invalid JSON) -> loadSkipWordStore returns default store", async () => {
			const globalDir = getGlobalMemoryDir();
			mkdirSync(globalDir, { recursive: true });
			writeFileSync(join(globalDir, ".prefetch-skip-words.json"), "NOT VALID JSON {{{");

			const store = loadSkipWordStore(globalDir);
			const defaultStore = getDefaultStore();
			expect(store.rules.length).toBe(defaultStore.rules.length);
			expect(store.history).toEqual([]);
		});
	});

	describe("并发安全", () => {
		it("17. two prefetch.start() calls in sequence -> second waits for first -> correct results", async () => {
			createMemoryFile("alpha.md", "Alpha content.");
			createMemoryFile("beta.md", "Beta content.");

			const { callLLM, getCallCount } = mockLLM([{ selected: ["alpha.md"] }, { selected: ["beta.md"] }]);

			const prefetch = new MemoryPrefetch();

			prefetch.start("first query", memoryDir, callLLM);
			await waitForSettled(prefetch);
			const result1 = prefetch.collect();
			expect(result1).toContain("Alpha content.");
			expect(getCallCount()).toBe(1);

			prefetch.start("second query", memoryDir, callLLM);
			await waitForSettled(prefetch);
			const result2 = prefetch.collect();
			expect(result2).toContain("Beta content.");
			expect(getCallCount()).toBe(2);

			const store = getStore(prefetch);
			expect(store.history.length).toBe(2);
			expect(store.history[0].selected).toEqual(["alpha.md"]);
			expect(store.history[1].selected).toEqual(["beta.md"]);
		});
	});
});
