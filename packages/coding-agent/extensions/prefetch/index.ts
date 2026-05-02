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
}

export interface SkipWordStore {
	version: number;
	rules: SkipRule[];
	history: HistoryEntry[];
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
			} catch {
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
		return parsed;
	} catch {
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
					const isBuiltin = rules.some((r) => r.pattern === matchedPattern && r.action === "skip" && r.builtin);
					if (isBuiltin && bad.suggestion === "add_guard") {
						rules.push({
							pattern: matchedPattern,
							mode: "exact",
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

	return {
		...store,
		rules,
		lastPurifyTimestamp: Date.now(),
	};
}
