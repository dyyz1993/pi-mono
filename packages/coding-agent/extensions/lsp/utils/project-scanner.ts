import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { ResolvedLspServerConfig } from "../config/resolver.js";

export interface ProjectScanResult {
	discoveredExtensions: Set<string>;
	extensionCounts: Map<string, number>;
	fileCount?: number;
}

// Common source code file extensions to scan for
// This prevents scanning unnecessary files like .bak, .log, .bin, etc.
const COMMON_SOURCE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
	".vue", ".svelte", ".jsx",
	".py", ".pyi",
	".rs",
	".go",
	".java", ".kt", ".kts",
	".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx",
	".cs", ".vb",
	".php",
	".rb",
	".swift", ".m", ".mm",
	".dart",
	".lua",
	".sh", ".bash", ".zsh",
	".sql",
	".graphql", ".gql",
	".yaml", ".yml",
	".toml",
	".json",
	".md",
	".xml", ".html", ".htm", ".css", ".scss", ".less", ".sass",
	".txt",
]);

// Directories to exclude from scanning (in addition to .git, node_modules)
const EXCLUDED_DIRS = new Set([
	"node_modules", ".git", "target", "dist", "build", ".pi",
	".next", ".nuxt", ".output", ".vercel",
	"venv", "env", ".venv", "envs", ".envs", "__pycache__",
	".vscode", ".idea",
	"coverage", ".nyc_output",
	".cache", "tmp", "temp",
	".DS_Store", "Thumbs.db",
]);

// If this many consecutive files yield no new extensions, stop early
const EARLY_EXIT_WINDOW = 200;

// Maximum files to scan before stopping
const MAX_FILES_TO_SCAN = 5000;

/**
 * Check if a file path is under an excluded directory.
 */
function isUnderExcludedDir(filePath: string): boolean {
	const parts = filePath.split("/");
	for (const part of parts) {
		if (EXCLUDED_DIRS.has(part)) {
			return true;
		}
	}
	return false;
}

/**
 * Scan the project for file types present on disk.
 * Uses `git ls-files` when available (fast, respects .gitignore),
 * falls back to a shallow `find` otherwise.
 */
export function scanProjectFileTypes(cwd: string): ProjectScanResult {
	const extensions = new Set<string>();
	const extensionCounts = new Map<string, number>();
	let fileCount = 0;
	let skippedCount = 0;
	const skippedDirs = new Map<string, number>();

	// Strategy 1: git ls-files (fast, respects gitignore)
	const gitFiles = tryGitLsFiles(cwd);
	if (gitFiles.length > 0) {
		let noNewExtCount = 0;

		for (const file of gitFiles) {
			// Skip files under excluded directories (frames/, dist/, etc.)
			if (isUnderExcludedDir(file)) {
				skippedCount++;
				const topDir = file.split("/")[0];
				if (topDir && topDir !== file) {
					skippedDirs.set(topDir, (skippedDirs.get(topDir) ?? 0) + 1);
				}
				continue;
			}

			fileCount++;
			if (fileCount > MAX_FILES_TO_SCAN) {
				console.warn(`[lsp] Stopped scan after ${MAX_FILES_TO_SCAN} files (too many files)`);
				break;
			}

			const prevSize = extensions.size;
			const ext = extname(file).toLowerCase();
			if (ext && COMMON_SOURCE_EXTENSIONS.has(ext)) {
				extensions.add(ext);
				extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
			}

			// Early exit: if no new extension found for a while, stop
			if (extensions.size === prevSize) {
				noNewExtCount++;
				if (noNewExtCount >= EARLY_EXIT_WINDOW) {
					console.log(`[lsp] Early exit: no new extensions in last ${EARLY_EXIT_WINDOW} files, scanned ${fileCount}/${gitFiles.length}`);
					break;
				}
			} else {
				noNewExtCount = 0;
			}
		}

		const extDetails = [...extensionCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([ext, count]) => `${ext}(${count})`)
			.join(", ");
		console.log(`[lsp] Project scan found ${extensions.size} file types from ${fileCount} files (git mode, skipped ${skippedCount} in excluded dirs)`);
		console.log(`[lsp] Project file types: ${extDetails}`);

		if (skippedDirs.size > 0) {
			const topSkipped = [...skippedDirs.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([dir, count]) => `${dir}/(${count})`)
				.join(", ");
			console.log(`[lsp] Skipped dirs (top 5): ${topSkipped}`);
		}

		return { discoveredExtensions: extensions, extensionCounts, fileCount };
	}

	// Strategy 2: shallow find (maxdepth 3, skip many common dirs)
	try {
		const excludeArgs = [...EXCLUDED_DIRS].map((dir) => `-not -path "*/${dir}/*"`).join(" ");
		const command = `find . -maxdepth 3 -type f ${excludeArgs} 2>/dev/null | head -${MAX_FILES_TO_SCAN}`;
		const output = execSync(command, {
			cwd,
			timeout: 3000,
			encoding: "utf8",
		});

		const lines = output.split("\n").filter(Boolean);
		fileCount = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			fileCount++;

			if (fileCount % 1000 === 0) {
				const memUsage = process.memoryUsage();
				const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
				const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

				if (heapUsedMB > 3000) {
					console.warn(`[lsp] Stopping scan due to high memory usage (${heapUsedMB}MB heap used)`);
					break;
				}
			}

			const ext = extname(trimmed).toLowerCase();
			if (ext && COMMON_SOURCE_EXTENSIONS.has(ext)) {
				extensions.add(ext);
				extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
			}
		}

		console.log(`[lsp] Project scan found ${extensions.size} file types from ${fileCount} files (find mode)`);
	} catch (error) {
		if (error instanceof Error) {
			console.warn(`[lsp] Project scan failed: ${error.message}`);
		}
	}

	return { discoveredExtensions: extensions, extensionCounts, fileCount };
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
 *
 * @deprecated Will be removed once index.ts is updated to use extensionCounts directly.
 */
export function filterServersByProject(
	servers: ResolvedLspServerConfig[],
	scanResult: ProjectScanResult,
): ResolvedLspServerConfig[] {
	const { discoveredExtensions } = scanResult;

	// Safe fallback: if scan found no source file types at all, start everything
	if (discoveredExtensions.size === 0) {
		console.log(`[lsp] No file types discovered, starting all ${servers.length} servers`);
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

	console.log(`[lsp] Filtered to ${filtered.length}/${servers.length} servers based on project files`);

	return filtered;
}
