import { describe, it, expect } from "vitest";
import { buildPrefetchUserMessage } from "../index.js";
import type { SkipRule, HistoryEntry } from "../skip-rules.js";

function extractHistoryJSON(output: string): unknown[] {
	const marker = "## 最近 Prefetch 历史\n";
	const idx = output.indexOf(marker);
	if (idx === -1) throw new Error("history section not found in output");
	const json = output.slice(idx + marker.length);
	return JSON.parse(json);
}

const baseRule: SkipRule = { pattern: "test", mode: "exact", action: "skip", builtin: true };
const customRule: SkipRule = { pattern: "custom_", mode: "prefix", action: "skip", builtin: false };

function makeHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		query: "test query",
		selected: ["file1.md"],
		skipped: false,
		skip_hits: [],
		guard_hits: [],
		timestamp: Date.now(),
		...overrides,
	};
}

describe("buildPrefetchUserMessage", () => {
	it("serializes history entry with userMarkedIrrelevant: true", () => {
		const history = [makeHistory({ userMarkedIrrelevant: true })];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed[0].userMarkedIrrelevant).toBe(true);
	});

	it("serializes history entry with userMarkedIrrelevant: false", () => {
		const history = [makeHistory({ userMarkedIrrelevant: false })];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed[0].userMarkedIrrelevant).toBe(false);
	});

	it("serializes history entry with irrelevantFiles", () => {
		const history = [makeHistory({ irrelevantFiles: ["a.ts", "b.ts"] })];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed[0].irrelevantFiles).toEqual(["a.ts", "b.ts"]);
	});

	it("produces valid output with empty history", () => {
		const output = buildPrefetchUserMessage("q", "manifest", [], []);
		const parsed = extractHistoryJSON(output);
		expect(parsed).toEqual([]);
		expect(output).toContain("## 当前查询\nq");
		expect(output).toContain("## 可用文件\nmanifest");
	});

	it("includes custom rules when present", () => {
		const output = buildPrefetchUserMessage("q", "manifest", [baseRule, customRule], []);
		expect(output).toContain('"pattern": "custom_"');
		expect(output).toContain('"mode": "prefix"');
		expect(output).toContain('"action": "skip"');
	});

	it('shows "(no custom rules)" when no custom rules', () => {
		const output = buildPrefetchUserMessage("q", "manifest", [baseRule], []);
		expect(output).toContain("(no custom rules)");
	});

	it("serializes multiple history entries", () => {
		const history = [
			makeHistory({ query: "q1", selected: ["a.md"] }),
			makeHistory({ query: "q2", selected: ["b.md"] }),
			makeHistory({ query: "q3", selected: ["c.md"] }),
		];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed).toHaveLength(3);
		expect(parsed[0].query).toBe("q1");
		expect(parsed[1].query).toBe("q2");
		expect(parsed[2].query).toBe("q3");
	});

	it("handles large history (>5 entries) without crashing", () => {
		const history = Array.from({ length: 10 }, (_, i) =>
			makeHistory({ query: `q${i}`, selected: [`f${i}.md`], timestamp: 1000 + i }),
		);
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed).toHaveLength(10);
		expect(parsed[0].query).toBe("q0");
		expect(parsed[9].query).toBe("q9");
	});

	it("includes query in output", () => {
		const output = buildPrefetchUserMessage("find all todos", "manifest", [], []);
		expect(output).toContain("## 当前查询\nfind all todos");
	});

	it("includes manifest in output", () => {
		const output = buildPrefetchUserMessage("q", "file list here", [], []);
		expect(output).toContain("## 可用文件\nfile list here");
	});

	it("serializes entry with both userMarkedIrrelevant and irrelevantFiles", () => {
		const history = [
			makeHistory({
				userMarkedIrrelevant: true,
				irrelevantFiles: ["x.ts", "y.ts"],
				query: "bad query",
			}),
		];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed[0].userMarkedIrrelevant).toBe(true);
		expect(parsed[0].irrelevantFiles).toEqual(["x.ts", "y.ts"]);
		expect(parsed[0].query).toBe("bad query");
	});

	it("handles entry without userMarkedIrrelevant field (backward compat)", () => {
		const history: HistoryEntry[] = [
			{
				query: "old query",
				selected: ["old.md"],
				skipped: false,
				skip_hits: [],
				guard_hits: [],
				timestamp: 5000,
			},
		];
		const output = buildPrefetchUserMessage("q", "manifest", [], history);
		const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
		expect(parsed[0].userMarkedIrrelevant).toBe(false);
		expect(parsed[0].irrelevantFiles).toEqual([]);
	});
});
