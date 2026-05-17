import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkipRule {
	pattern: string;
	mode: "exact" | "prefix" | "contains" | "regex";
	action: "skip" | "guard";
	builtin?: boolean;
}

export interface HistoryEntry {
	query: string;
	selected: string[];
	skipped: boolean;
	skip_hits: string[];
	guard_hits: string[];
	timestamp: number;
	userMarkedIrrelevant?: boolean;
	irrelevantFiles?: string[];
}

export interface SkipWordStore {
	version: number;
	rules: SkipRule[];
	history: HistoryEntry[];
	excludeKeywords: string[];
	lastPurifyTimestamp: number;
}

export interface PurificationResult {
	add_rules?: Array<{ pattern: string; mode: SkipRule["mode"]; action: SkipRule["action"] }>;
	remove_rules?: Array<{ pattern: string; mode: SkipRule["mode"] }>;
	bad_skips?: Array<{
		query: string;
		matched_rules: string[];
		reason: string;
		suggestion: "remove" | "add_guard";
	}>;
}

const MAX_HISTORY = 20;
const MAX_SKIP_RULES = 50;
const MAX_GUARD_RULES = 30;
const STORE_FILENAME = ".prefetch-skip-words.json";

export function getGlobalMemoryDir(): string {
	return join(homedir(), ".pi", "agent", "memory");
}

export function getDefaultRules(): SkipRule[] {
	const skipPatterns: Array<{ pattern: string; mode: SkipRule["mode"] }> = [
		{ pattern: "继续", mode: "exact" },
		{ pattern: "continue", mode: "exact" },
		{ pattern: "好的", mode: "exact" },
		{ pattern: "ok", mode: "exact" },
		{ pattern: "OK", mode: "exact" },
		{ pattern: "yes", mode: "exact" },
		{ pattern: "y", mode: "exact" },
		{ pattern: "是", mode: "exact" },
		{ pattern: "对", mode: "exact" },
		{ pattern: "嗯", mode: "exact" },
		{ pattern: "继续", mode: "prefix" },
		{ pattern: "谢谢", mode: "exact" },
		{ pattern: "感谢", mode: "exact" },
		{ pattern: "thanks", mode: "exact" },
		{ pattern: "thx", mode: "exact" },
		{ pattern: "收到", mode: "exact" },
		{ pattern: "明白", mode: "exact" },
		{ pattern: "了解", mode: "exact" },
		{ pattern: "知道了", mode: "exact" },
		{ pattern: "行", mode: "exact" },
		{ pattern: "可以", mode: "exact" },
		{ pattern: "没问题", mode: "exact" },
		{ pattern: "不用了", mode: "exact" },
		{ pattern: "算了", mode: "exact" },
		{ pattern: "稍等", mode: "exact" },
		{ pattern: "等一下", mode: "exact" },
		{ pattern: "好的谢谢", mode: "exact" },
		{ pattern: "好", mode: "exact" },
		{ pattern: "done", mode: "exact" },
		{ pattern: "got it", mode: "exact" },
		{ pattern: "right", mode: "exact" },
		{ pattern: "sure", mode: "exact" },
		{ pattern: "no", mode: "exact" },
		{ pattern: "nope", mode: "exact" },
		{ pattern: "嗯嗯", mode: "exact" },
		{ pattern: "哦", mode: "exact" },
		{ pattern: "啊", mode: "exact" },
		{ pattern: "哈哈", mode: "exact" },
		{ pattern: "懂了", mode: "exact" },
		{ pattern: "没错", mode: "exact" },
		{ pattern: "对的", mode: "exact" },
		{ pattern: "那就这样", mode: "exact" },
		{ pattern: "可以的", mode: "exact" },
		{ pattern: "差不多", mode: "exact" },
		{ pattern: "看起来不错", mode: "exact" },
		{ pattern: "就这样吧", mode: "exact" },
	];

	const guardPatterns: Array<{ pattern: string; mode: SkipRule["mode"] }> = [
		{ pattern: "?", mode: "contains" },
		{ pattern: "？", mode: "contains" },
		{ pattern: "怎么", mode: "prefix" },
		{ pattern: "如何", mode: "prefix" },
		{ pattern: "为什么", mode: "prefix" },
		{ pattern: "什么", mode: "prefix" },
		{ pattern: "哪", mode: "prefix" },
		{ pattern: "吗", mode: "contains" },
		{ pattern: "呢", mode: "contains" },
		{ pattern: "帮", mode: "prefix" },
		{ pattern: "帮我", mode: "prefix" },
		{ pattern: "请", mode: "prefix" },
		{ pattern: "麻烦", mode: "prefix" },
		{ pattern: "\n", mode: "contains" },
		{ pattern: "看看", mode: "contains" },
		{ pattern: "查看", mode: "prefix" },
		{ pattern: "查一下", mode: "prefix" },
		{ pattern: "找", mode: "prefix" },
		{ pattern: "搜", mode: "prefix" },
		{ pattern: "分析", mode: "prefix" },
		{ pattern: "解释", mode: "prefix" },
		{ pattern: "写", mode: "prefix" },
		{ pattern: "改", mode: "prefix" },
		{ pattern: "修", mode: "prefix" },
		{ pattern: "删", mode: "prefix" },
		{ pattern: "新增", mode: "prefix" },
		{ pattern: "优化", mode: "prefix" },
		{ pattern: "重构", mode: "prefix" },
		{ pattern: "设计", mode: "prefix" },
		{ pattern: "实现", mode: "prefix" },
		{ pattern: "创建", mode: "prefix" },
	];

	return [
		...skipPatterns.map((p) => ({ ...p, action: "skip" as const, builtin: true })),
		...guardPatterns.map((p) => ({ ...p, action: "guard" as const, builtin: true })),
	];
}

export function matchRule(query: string, rule: SkipRule): boolean {
	if (!query || !rule.pattern) return false;
	const q = query.toLowerCase();
	const p = rule.pattern.toLowerCase();

	switch (rule.mode) {
		case "exact":
			return q === p;
		case "prefix":
			return q.startsWith(p);
		case "contains":
			return q.includes(p);
		case "regex": {
			try {
				const re = new RegExp(rule.pattern);
				return re.test(query);
			} catch (err) {
				console.debug("[auto-memory] regex evaluation failed:", err instanceof Error ? err.message : err);
				return false;
			}
		}
	}
}

export function evaluateRules(
	query: string,
	rules: SkipRule[],
): { shouldSkip: boolean; skipHits: string[]; guardHits: string[] } {
	const skipHits: string[] = [];
	const guardHits: string[] = [];

	for (const rule of rules) {
		if (matchRule(query, rule)) {
			if (rule.action === "skip") {
				skipHits.push(rule.pattern);
			} else {
				guardHits.push(rule.pattern);
			}
		}
	}

	return {
		shouldSkip: skipHits.length > 0 && guardHits.length === 0,
		skipHits,
		guardHits,
	};
}

export function getDefaultStore(): SkipWordStore {
	return {
		version: 1,
		rules: getDefaultRules(),
		history: [],
		excludeKeywords: [],
		lastPurifyTimestamp: 0,
	};
}

export function loadSkipWordStore(dir: string): SkipWordStore {
	const filePath = join(dir, STORE_FILENAME);
	if (!existsSync(filePath)) {
		return getDefaultStore();
	}
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as SkipWordStore;
		if (parsed.history.length > MAX_HISTORY) {
			parsed.history = parsed.history.slice(-MAX_HISTORY);
		}
		// 向后兼容：如果没有 excludeKeywords 字段，使用空数组
		if (!parsed.excludeKeywords) {
			parsed.excludeKeywords = [];
		}
		return parsed;
	} catch (err) {
		console.debug("[auto-memory] skip word store load failed:", err instanceof Error ? err.message : err);
		return getDefaultStore();
	}
}

export async function saveSkipWordStore(dir: string, store: SkipWordStore): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, STORE_FILENAME);
	const tmpPath = filePath + ".tmp";
	const data = JSON.stringify(store, null, 2);
	writeFileSync(tmpPath, data, "utf-8");
	renameSync(tmpPath, filePath);
}

export function addHistoryEntry(store: SkipWordStore, entry: HistoryEntry): SkipWordStore {
	const history = [...store.history, entry];
	if (history.length > MAX_HISTORY) {
		history.splice(0, history.length - MAX_HISTORY);
	}
	return { ...store, history };
}

export function applyPurification(store: SkipWordStore, result: PurificationResult): SkipWordStore {
	const rules = [...store.rules];

	if (result.add_rules) {
		for (const add of result.add_rules) {
			const exists = rules.some((r) => r.pattern === add.pattern && r.mode === add.mode && r.action === add.action);
			if (!exists) {
				rules.push({ pattern: add.pattern, mode: add.mode, action: add.action, builtin: false });
			}
		}
	}

	if (result.remove_rules) {
		for (const rem of result.remove_rules) {
			const idx = rules.findIndex((r) => r.pattern === rem.pattern && r.mode === rem.mode && !r.builtin);
			if (idx !== -1) {
				rules.splice(idx, 1);
			}
		}
	}

	if (result.bad_skips) {
		for (const bad of result.bad_skips) {
			for (const matchedPattern of bad.matched_rules) {
				const idx = rules.findIndex((r) => r.pattern === matchedPattern && r.action === "skip" && !r.builtin);
				if (idx !== -1) {
					if (bad.suggestion === "remove") {
						rules.splice(idx, 1);
					}
				} else {
					const builtinRule = rules.find((r) => r.pattern === matchedPattern && r.action === "skip" && r.builtin);
					if (builtinRule && bad.suggestion === "add_guard") {
						rules.push({
							pattern: builtinRule.pattern,
							mode: builtinRule.mode,
							action: "guard",
							builtin: false,
						});
					}
				}
			}
		}
	}

	const nonBuiltinSkips = rules.filter((r) => r.action === "skip" && !r.builtin);
	if (nonBuiltinSkips.length > MAX_SKIP_RULES) {
		const toRemove = nonBuiltinSkips.slice(0, nonBuiltinSkips.length - MAX_SKIP_RULES);
		for (const r of toRemove) {
			const idx = rules.indexOf(r);
			if (idx !== -1) rules.splice(idx, 1);
		}
	}

	const nonBuiltinGuards = rules.filter((r) => r.action === "guard" && !r.builtin);
	if (nonBuiltinGuards.length > MAX_GUARD_RULES) {
		const toRemove = nonBuiltinGuards.slice(0, nonBuiltinGuards.length - MAX_GUARD_RULES);
		for (const r of toRemove) {
			const idx = rules.indexOf(r);
			if (idx !== -1) rules.splice(idx, 1);
		}
	}

	// 从历史中提取用户标记的文件关键词
	const irrelevantEntries = store.history.filter((h) => h.userMarkedIrrelevant && h.irrelevantFiles);
	const excludeKeywords = new Set<string>(store.excludeKeywords);
	for (const entry of irrelevantEntries) {
		for (const file of entry.irrelevantFiles ?? []) {
			const name = file.replace(/\.md$/, "").replace(/\.json$/, "");
			const parts = name.split(/[\s_-]+/);
			for (const part of parts) {
				const clean = part.trim().toLowerCase();
				if (clean.length >= 3 && clean.length <= 20) {
					excludeKeywords.add(clean);
				}
			}
		}
	}

	return {
		...store,
		rules,
		excludeKeywords: Array.from(excludeKeywords),
		lastPurifyTimestamp: Date.now(),
	};
}
