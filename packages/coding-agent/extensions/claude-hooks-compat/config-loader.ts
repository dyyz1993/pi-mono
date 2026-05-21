import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeHookConfig, MatcherGroup } from "./types.js";

export interface ConfigSource {
	path: string;
	scope: "policy" | "global" | "project" | "local";
	exists: boolean;
	disabled: boolean;
}

function loadSingleConfig(path: string): ClaudeHookConfig | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8").trim();
		if (!raw) return null;
		return JSON.parse(raw);
	} catch (err) {
		return null;
	}
}

function annotateGroups(groups: MatcherGroup[], scope: string): MatcherGroup[] {
	return groups.map(g => Object.assign(g, { __source__: scope }));
}

export function loadConfigs(projectDir: string): Map<string, MatcherGroup[]> {
	const merged = new Map<string, MatcherGroup[]>();

	const policyPath = process.env.CLAUDE_POLICY_FILE ?? "";
	if (policyPath) {
		const policy = loadSingleConfig(policyPath);
		if (policy?.disableAllHooks) return merged;
		if (policy?.hooks) {
			for (const [eventName, groups] of Object.entries(policy.hooks)) {
				merged.set(eventName, annotateGroups(groups, "policy"));
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
			merged.set(eventName, [...existing, ...annotateGroups(groups, source.name)]);
		}
	}

	return merged;
}

export function loadConfigSources(projectDir: string): ConfigSource[] {
	const result: ConfigSource[] = [];

	const policyPath = process.env.CLAUDE_POLICY_FILE ?? "";
	if (policyPath) {
		const config = loadSingleConfig(policyPath);
		result.push({
			path: policyPath,
			scope: "policy",
			exists: config !== null,
			disabled: config?.disableAllHooks ?? false,
		});
	}

	const files = [
		{ path: join(homedir(), ".claude/settings.json"), scope: "global" as const },
		{ path: join(projectDir, ".claude/settings.json"), scope: "project" as const },
		{ path: join(projectDir, ".claude/settings.local.json"), scope: "local" as const },
	];

	for (const f of files) {
		const config = loadSingleConfig(f.path);
		result.push({
			path: f.path,
			scope: f.scope,
			exists: config !== null,
			disabled: config?.disableAllHooks ?? false,
		});
	}

	return result;
}
