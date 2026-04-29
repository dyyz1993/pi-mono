import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { RulesConfig } from "./types.js";

const DEFAULT_CACHE_TTL = 30_000;

const DEFAULT_DIRS = {
	managed: ["/etc/claude-code/.claude/rules"],
	user: [path.join(homedir(), ".claude", "rules"), path.join(homedir(), ".config", "opencode", "rules")],
	pi: [".pi/rules"],
	project: [".claude/rules", ".opencode/rules", ".trae/rules"],
};

function defaultConfig(): RulesConfig {
	return {
		cacheTTL: DEFAULT_CACHE_TTL,
		notifyOnLoad: true,
		notifyOnMatch: true,
	};
}

export async function loadConfig(projectDir: string): Promise<RulesConfig> {
	const configFiles = [
		".rules-config.json",
		".pi/rules-config.json",
		".claude/rules-config.json",
		".opencode/rules-config.json",
	];

	for (const name of configFiles) {
		const fp = path.resolve(projectDir, name);
		try {
			const raw = fs.readFileSync(fp, "utf-8");
			const parsed = JSON.parse(raw);
			return {
				...defaultConfig(),
				...parsed,
				cacheTTL: parsed.cacheTTL ?? DEFAULT_CACHE_TTL,
				notifyOnLoad: parsed.notifyOnLoad ?? true,
				notifyOnMatch: parsed.notifyOnMatch ?? true,
			};
		} catch {}
	}

	return defaultConfig();
}

export function resolveDirs(
	projectDir: string,
	config: RulesConfig,
): Array<{ scope: string; dir: string; source: string }> {
	const sources = config.dirs || DEFAULT_DIRS;
	const result: Array<{ scope: string; dir: string; source: string }> = [];

	for (const [scope, paths] of Object.entries(sources)) {
		for (const p of paths) {
			result.push({
				scope,
				dir: p.startsWith("/") || p.startsWith("~") ? p.replace(/^~/, homedir()) : path.resolve(projectDir, p),
				source: p,
			});
		}
	}

	return result;
}
