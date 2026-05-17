import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { ResolvedLspServerConfig } from "../config/resolver.js";

export interface ProjectScanResult {
	discoveredExtensions: Set<string>;
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
const EXCLUDED_DIRS = [
	"node_modules", ".git", "target", "dist", "build", ".pi",
	".next", ".nuxt", ".output", ".vercel",
	"venv", "env", ".venv", "envs", ".envs", "__pycache__",
	".vscode", ".idea",
	"coverage", ".nyc_output",
	".cache", "tmp", "temp",
	".DS_Store", "Thumbs.db",
];

// Maximum files to scan before stopping
const MAX_FILES_TO_SCAN = 5000;

/**
 * Scan the project for file types present on disk.
 * Uses `git ls-files` when available (fast, respects .gitignore),
 * falls back to a shallow `find` otherwise.
 */
export function scanProjectFileTypes(cwd: string): ProjectScanResult {
	const extensions = new Set<string>();
	let fileCount = 0;

	// Strategy 1: git ls-files (fast, respects gitignore)
	const gitFiles = tryGitLsFiles(cwd);
	if (gitFiles.length > 0) {
		for (const file of gitFiles) {
			fileCount++;
			if (fileCount > MAX_FILES_TO_SCAN) {
				console.warn(`[lsp] Stopped scan after ${MAX_FILES_TO_SCAN} files (too many files)`);
				break;
			}

			const ext = extname(file).toLowerCase();
			// Only collect common source code extensions
			if (ext && COMMON_SOURCE_EXTENSIONS.has(ext)) {
				extensions.add(ext);
			}
		}
		console.log(`[lsp] Project scan found ${extensions.size} file types from ${fileCount} files (git mode)`);
		return { discoveredExtensions: extensions, fileCount };
	}

	// Strategy 2: shallow find (maxdepth 3, skip many common dirs)
	try {
		const excludeArgs = EXCLUDED_DIRS.map((dir) => `-not -path "*/${dir}/*"`).join(" ");
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

			// Check memory usage periodically
			if (fileCount % 1000 === 0) {
				const memUsage = process.memoryUsage();
				const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
				const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

				// If we're using >3GB of heap, stop scanning
				if (heapUsedMB > 3000) {
					console.warn(`[lsp] Stopping scan due to high memory usage (${heapUsedMB}MB heap used)`);
					break;
				}
			}

			const ext = extname(trimmed).toLowerCase();
			// Only collect common source code extensions
			if (ext && COMMON_SOURCE_EXTENSIONS.has(ext)) {
				extensions.add(ext);
			}
		}

		console.log(`[lsp] Project scan found ${extensions.size} file types from ${fileCount} files (find mode)`);
	} catch (error) {
		if (error instanceof Error) {
			console.warn(`[lsp] Project scan failed: ${error.message}`);
		}
		// If scan fails, return empty — will fall back to starting all servers
	}

	return { discoveredExtensions: extensions, fileCount };
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
	const { discoveredExtensions, fileCount } = scanResult;

	// Safe fallback: if scan found nothing, start everything
	if (discoveredExtensions.size === 0) {
		console.log(`[lsp] No file types discovered, starting all ${servers.length} servers`);
		return servers;
	}

	// If we scanned very few files (<10), might be an empty project - start all servers
	if (fileCount !== undefined && fileCount < 10) {
		console.log(`[lsp] Only ${fileCount} files scanned, starting all ${servers.length} servers`);
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
