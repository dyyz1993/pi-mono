import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeHookConfig, MatcherGroup } from "./types.js";

function loadSingleConfig(path: string): ClaudeHookConfig | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

export function loadConfigs(projectDir: string): Map<string, MatcherGroup[]> {
	const merged = new Map<string, MatcherGroup[]>();

	const policyPath = process.env.CLAUDE_POLICY_FILE ?? "";
	if (policyPath) {
		const policy = loadSingleConfig(policyPath);
		if (policy?.disableAllHooks) return merged;
		if (policy?.hooks) {
			for (const [eventName, groups] of Object.entries(policy.hooks)) {
				merged.set(eventName, [...groups]);
			}
		}
	}

	const sources = [
		{ path: join(homedir(), ".claude/settings.json"), name: "global" },
		{ path: join(projectDir, ".claude/settings.json"), name: "project" },
		{ path: join(projectDir, ".claude/settings.local.json"), name: "local" },
	];

	for (const source of sources) {
		const config = loadSingleConfig(source.path);
		if (!config) continue;
		if (config.disableAllHooks) continue;
		if (!config.hooks) continue;

		for (const [eventName, groups] of Object.entries(config.hooks)) {
			const existing = merged.get(eventName) ?? [];
			merged.set(eventName, [...existing, ...groups]);
		}
	}

	return merged;
}
