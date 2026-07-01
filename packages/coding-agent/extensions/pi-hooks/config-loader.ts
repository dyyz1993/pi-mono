import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeSessionHooks, parseSessionHooks } from "@dyyz1993/pi-coding-agent";
import type { ClaudeHookConfig, MatcherGroup } from "./types.ts";

export interface ConfigSource {
	path: string;
	scope: "policy" | "global" | "project" | "local" | "pi-global" | "pi-project";
	exists: boolean;
	disabled: boolean;
}

type ConfigFile = {
	path: string;
	scope: ConfigSource["scope"];
};

function getConfigFiles(projectDir: string): ConfigFile[] {
	const files: ConfigFile[] = [];
	const policyPath = process.env.CLAUDE_POLICY_FILE ?? "";
	if (policyPath) {
		files.push({ path: policyPath, scope: "policy" });
	}

	files.push(
		{ path: join(homedir(), ".claude/settings.json"), scope: "global" },
		{ path: join(projectDir, ".claude/settings.json"), scope: "project" },
		{ path: join(projectDir, ".claude/settings.local.json"), scope: "local" },
		{ path: join(homedir(), ".pi", "agent", "settings.json"), scope: "pi-global" },
		{ path: join(projectDir, ".pi", "settings.json"), scope: "pi-project" },
	);

	return files;
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

export function getConfigSignature(projectDir: string): string {
	return getConfigFiles(projectDir).map((source) => {
		if (!existsSync(source.path)) return `${source.scope}:${source.path}:missing`;
		try {
			return `${source.scope}:${source.path}:present:${readFileSync(source.path, "utf-8")}`;
		} catch (err) {
			return `${source.scope}:${source.path}:error:${String(err)}`;
		}
	}).join("\n---\n");
}

export function loadConfigs(projectDir: string): Map<string, MatcherGroup[]> {
	const merged = new Map<string, MatcherGroup[]>();

	for (const source of getConfigFiles(projectDir)) {
		const config = loadSingleConfig(source.path);
		if (!config) continue;
		if (config.disableAllHooks) {
			if (source.scope === "policy") return merged;
			continue;
		}
		const hooks = normalizeSessionHooks(parseSessionHooks(config.hooks), source.scope);
		if (hooks.size === 0) continue;

		if (source.scope === "policy") {
			for (const [eventName, groups] of hooks.entries()) {
				merged.set(eventName, groups);
			}
			continue;
		}

		for (const [eventName, groups] of hooks.entries()) {
			const existing = merged.get(eventName) ?? [];
			merged.set(eventName, [...existing, ...groups]);
		}
	}

	return merged;
}

export function loadConfigSources(projectDir: string): ConfigSource[] {
	return getConfigFiles(projectDir).map((source) => {
		const config = loadSingleConfig(source.path);
		return {
			path: source.path,
			scope: source.scope,
			exists: config !== null,
			disabled: config?.disableAllHooks ?? false,
		};
	});
}
