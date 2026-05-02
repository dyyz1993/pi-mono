import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

const INCLUDE_REGEX = /<!--\s*@include\s+(.+?)\s*-->/g;

const TEXT_EXTENSIONS = new Set([
	".md",
	".mdc",
	".txt",
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".yaml",
	".yml",
	".toml",
	".css",
	".html",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".h",
	".cpp",
	".hpp",
	".sh",
	".bash",
	".zsh",
	".sql",
	".graphql",
	".proto",
	".env",
	".ini",
	".cfg",
	".conf",
]);

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;
const DEFAULT_MAX_TOTAL_SIZE = 5 * 1024 * 1024;

export interface IncludeDiagnostic {
	type: "warning" | "error";
	path: string;
	message: string;
}

export interface IncludeResult {
	content: string;
	diagnostics: IncludeDiagnostic[];
	includedPaths: string[];
}

interface ContentRegion {
	type: "text" | "code";
	content: string;
}

function splitContentRegions(content: string): ContentRegion[] {
	const regions: ContentRegion[] = [];
	const lines = content.split("\n");
	let inCode = false;
	let current: string[] = [];

	for (const line of lines) {
		const trimmed = line.trimEnd();
		if (!inCode && trimmed.endsWith("```")) {
			inCode = true;
			current.push(line);
			regions.push({ type: "text", content: current.join("\n") });
			current = [line];
			continue;
		}
		if (inCode && trimmed === "```") {
			current.push(line);
			regions.push({ type: "code", content: current.join("\n") });
			current = [];
			inCode = false;
			continue;
		}
		current.push(line);
	}

	if (current.length > 0) {
		regions.push({ type: inCode ? "code" : "text", content: current.join("\n") });
	}

	return regions;
}

function resolveIncludePath(rawPath: string, sourceDir: string): string {
	if (rawPath.startsWith("~/")) {
		return join(homedir(), rawPath.slice(2));
	}
	if (rawPath.startsWith("~")) {
		return join(homedir(), rawPath.slice(1));
	}
	if (isAbsolute(rawPath)) {
		return rawPath;
	}
	return resolve(sourceDir, rawPath);
}

function isPathUnderRoot(target: string, root: string): boolean {
	const normalizedTarget = resolve(target);
	const normalizedRoot = resolve(root);
	return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function isPathAllowed(resolvedPath: string, cwd: string, agentDir: string): boolean {
	const home = homedir();
	const allowedRoots = [cwd, agentDir, join(home, ".pi"), join(home, ".claude")];

	let realPath: string;
	try {
		realPath = realpathSync(resolvedPath);
	} catch {
		realPath = resolvedPath;
	}

	for (const root of allowedRoots) {
		let realRoot: string;
		try {
			realRoot = realpathSync(root);
		} catch {
			realRoot = root;
		}
		if (isPathUnderRoot(realPath, realRoot)) {
			return true;
		}
	}
	return false;
}

function resolveIncludesRecursive(
	content: string,
	sourcePath: string,
	options: {
		cwd: string;
		agentDir: string;
		maxDepth: number;
		maxFileSize: number;
		maxTotalSize: number;
	},
	state: {
		depth: number;
		totalSize: number;
		visited: Set<string>;
		diagnostics: IncludeDiagnostic[];
		includedPaths: string[];
	},
): string {
	if (state.depth > options.maxDepth) {
		state.diagnostics.push({
			type: "warning",
			path: sourcePath,
			message: `maximum include depth (${options.maxDepth}) exceeded`,
		});
		return content;
	}

	const regions = splitContentRegions(content);
	const result: string[] = [];

	for (const region of regions) {
		if (region.type === "code") {
			result.push(region.content);
			continue;
		}

		const regionContent = region.content;
		const matches: Array<{ fullMatch: string; rawPath: string; index: number }> = [];

		const regex = new RegExp(INCLUDE_REGEX.source, "g");
		let match: RegExpExecArray | null = regex.exec(regionContent);
		while (match !== null) {
			matches.push({
				fullMatch: match[0],
				rawPath: match[1],
				index: match.index,
			});
			match = regex.exec(regionContent);
		}

		if (matches.length === 0) {
			result.push(regionContent);
			continue;
		}

		const segments: string[] = [];
		let lastIndex = 0;

		for (const m of matches) {
			segments.push(regionContent.slice(lastIndex, m.index));

			const sourceDir = dirname(sourcePath);
			const resolvedPath = resolveIncludePath(m.rawPath, sourceDir);

			let realPath: string;
			try {
				realPath = realpathSync(resolvedPath);
			} catch {
				realPath = resolvedPath;
			}

			if (state.visited.has(realPath)) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `circular include detected: ${resolvedPath}`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: circular include -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			const ext = extname(resolvedPath).toLowerCase();
			if (ext !== "" && !TEXT_EXTENSIONS.has(ext)) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `file extension "${ext}" is not allowed`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: disallowed file extension -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			if (!isPathAllowed(resolvedPath, options.cwd, options.agentDir)) {
				state.diagnostics.push({
					type: "error",
					path: m.rawPath,
					message: `path is outside allowed directories`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: path not allowed -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			if (!existsSync(resolvedPath)) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `file not found: ${resolvedPath}`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: file not found -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			let stats: ReturnType<typeof statSync>;
			try {
				stats = statSync(resolvedPath);
			} catch {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `cannot stat file: ${resolvedPath}`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: cannot stat file -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			if (!stats.isFile()) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `not a file: ${resolvedPath}`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: not a file -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			if (stats.size > options.maxFileSize) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `file exceeds max size (${stats.size} > ${options.maxFileSize})`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: file too large -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			if (state.totalSize + stats.size > options.maxTotalSize) {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `total include size limit exceeded`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: total size limit exceeded -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			let includedContent: string;
			try {
				includedContent = readFileSync(resolvedPath, "utf-8");
			} catch {
				state.diagnostics.push({
					type: "warning",
					path: m.rawPath,
					message: `cannot read file: ${resolvedPath}`,
				});
				segments.push(`<!-- @include ${m.rawPath} FAILED: cannot read file -->`);
				lastIndex = m.index + m.fullMatch.length;
				continue;
			}

			state.totalSize += stats.size;
			state.visited.add(realPath);
			state.includedPaths.push(realPath);

			const resolved = resolveIncludesRecursive(includedContent, resolvedPath, options, {
				depth: state.depth + 1,
				totalSize: state.totalSize,
				visited: state.visited,
				diagnostics: state.diagnostics,
				includedPaths: state.includedPaths,
			});

			state.totalSize = Math.max(state.totalSize, resolved.length);

			segments.push(resolved);
			lastIndex = m.index + m.fullMatch.length;
		}

		segments.push(regionContent.slice(lastIndex));
		result.push(segments.join(""));
	}

	return result.join("\n");
}

export function resolveIncludes(
	content: string,
	sourcePath: string,
	options: {
		cwd: string;
		agentDir: string;
		maxDepth?: number;
		maxFileSize?: number;
		maxTotalSize?: number;
	},
): IncludeResult {
	const diagnostics: IncludeDiagnostic[] = [];
	const includedPaths: string[] = [];
	const visited = new Set<string>();

	let realSourcePath: string;
	try {
		realSourcePath = realpathSync(sourcePath);
	} catch {
		realSourcePath = resolve(sourcePath);
	}
	visited.add(realSourcePath);

	const resolved = resolveIncludesRecursive(
		content,
		sourcePath,
		{
			cwd: options.cwd,
			agentDir: options.agentDir,
			maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
			maxFileSize: options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
			maxTotalSize: options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE,
		},
		{
			depth: 0,
			totalSize: content.length,
			visited,
			diagnostics,
			includedPaths,
		},
	);

	return {
		content: resolved,
		diagnostics,
		includedPaths,
	};
}
