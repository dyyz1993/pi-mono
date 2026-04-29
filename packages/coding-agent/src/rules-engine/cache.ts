import { resolveDirs } from "./config.js";
import { loadRules } from "./loader.js";
import type { ParsedRule, RulesConfig } from "./types.js";

let cache: { rules: ParsedRule[]; loadedAt: number } | null = null;

export async function getRules(projectDir: string, config: RulesConfig): Promise<ParsedRule[]> {
	if (cache && Date.now() - cache.loadedAt < config.cacheTTL) {
		return cache.rules;
	}

	const rules = await loadAllRules(projectDir, config);
	cache = { rules, loadedAt: Date.now() };
	return rules;
}

export function invalidateCache(): void {
	cache = null;
}

async function loadAllRules(projectDir: string, config: RulesConfig): Promise<ParsedRule[]> {
	const sources = resolveDirs(projectDir, config);
	const result: ParsedRule[] = [];
	const seen = new Set<string>();

	for (const { scope, dir, source } of sources) {
		const ruleCache = loadRules(dir);
		for (const rule of ruleCache.rules) {
			if (seen.has(rule.filePath)) continue;
			seen.add(rule.filePath);
			rule.scope = scope as ParsedRule["scope"];
			rule.source = source;
			result.push(rule);
		}
	}

	return result;
}
