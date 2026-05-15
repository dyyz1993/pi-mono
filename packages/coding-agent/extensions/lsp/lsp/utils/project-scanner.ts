import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { ResolvedLspServerConfig } from "../config/resolver.js";

export interface ProjectScanResult {
	discoveredExtensions: Set<string>;
}

/**
 * Scan the project for file types present on disk.
 * Uses `git ls-files` when available (fast, respects .gitignore),
 * falls back to a shallow `find` otherwise.
 */
export function scanProjectFileTypes(cwd: string): ProjectScanResult {
	const extensions = new Set<string>();

	// Strategy 1: git ls-files (fast, respects gitignore)
	const gitFiles = tryGitLsFiles(cwd);
	if (gitFiles.length > 0) {
		for (const file of gitFiles) {
			const ext = extname(file).toLowerCase();
			if (ext) {
				extensions.add(ext);
			}
		}
		return { discoveredExtensions: extensions };
	}

	// Strategy 2: shallow find (maxdepth 3, skip node_modules etc.)
	try {
		const output = execSync(
			'find . -maxdepth 3 -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/target/*" -not -path "*/dist/*" -not -path "*/.pi/*" 2>/dev/null | head -2000',
			{ cwd, timeout: 3000, encoding: "utf8" },
		);
		for (const line of output.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const ext = extname(trimmed).toLowerCase();
			if (ext) {
				extensions.add(ext);
			}
		}
	} catch {
		// If scan fails, return empty — will fall back to starting all servers
	}

	return { discoveredExtensions: extensions };
}

function tryGitLsFiles(cwd: string): string[] {
	// Check if we're in a git repo
	if (!existsSync(join(cwd, ".git"))) {
		return [];
	}

	try {
		const output = execSync("git ls-files --cached --others --exclude-standard 2>/dev/null | head -2000", {
			cwd,
			timeout: 3000,
			encoding: "utf8",
		});
		const files = output.split("\n").filter(Boolean);
		return files.length > 0 ? files : [];
	} catch {
		return [];
	}
}

/**
 * Filter server configs to only those whose fileTypes match files in the project.
 * Servers WITHOUT fileTypes (catch-all) are always included.
 * If the project has no discoverable files, all servers are started (safe fallback).
 */
export function filterServersByProject(
	servers: ResolvedLspServerConfig[],
	scanResult: ProjectScanResult,
): ResolvedLspServerConfig[] {
	const { discoveredExtensions } = scanResult;

	// Safe fallback: if scan found nothing, start everything
	if (discoveredExtensions.size === 0) {
		return servers;
	}

	const filtered: ResolvedLspServerConfig[] = [];
	for (const server of servers) {
		// No fileTypes = catch-all server, always include
		if (!server.fileTypes || server.fileTypes.length === 0) {
			filtered.push(server);
			continue;
		}

		// Include if ANY of the server's fileTypes exist in the project
		const hasMatch = server.fileTypes.some((ft) => discoveredExtensions.has(ft.toLowerCase()));
		if (hasMatch) {
			filtered.push(server);
		}
	}

	return filtered;
}
