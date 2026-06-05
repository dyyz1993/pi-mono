import { minimatch } from "minimatch";

export interface PathConfig {
	write?: string[];
	read?: string[];
	bash?: string[];
}

export interface PathPermissionResult {
	block: true;
	reason: string;
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
const READ_TOOLS = new Set(["read"]);
const SKIP_PATH_TOOLS = new Set(["grep", "glob", "find", "ls"]);

export function normalizeFilePath(filePath: string): string {
	let normalized = filePath;
	if (normalized.startsWith("file://")) {
		normalized = normalized.slice("file://".length);
	}
	const parts = normalized.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") {
			if (resolved.length > 0 && resolved[resolved.length - 1] !== "") {
				resolved.pop();
			}
		} else if (part !== "." && part !== "") {
			resolved.push(part);
		} else if (part === "" && resolved.length === 0) {
			resolved.push("");
		}
	}
	if (normalized.startsWith("/")) {
		return "/" + resolved.filter((p) => p !== "").join("/");
	}
	return resolved.join("/") || ".";
}

export function matchPathGlob(filePath: string, pattern: string): boolean {
	if (pattern === "**") return true;

	const normalized = normalizeFilePath(filePath);
	const parts = normalized.split("/");

	for (let i = 0; i < parts.length; i++) {
		const subpath = parts.slice(i).join("/");
		try {
			if (minimatch(subpath, pattern, { dot: true })) {
				return true;
			}
		} catch {
			// Invalid glob pattern — treat as no match for this subpath
		}
	}

	return false;
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (matchPathGlob(filePath, pattern)) {
			return true;
		}
	}
	return false;
}

export function createPathPermissionHandler(
	paths: PathConfig | undefined,
): ((input: { toolName: string; input: Record<string, unknown> }) => PathPermissionResult | null) | null {
	if (paths === undefined) return null;

	const hasWrite = paths.write !== undefined && paths.write.length > 0;
	const hasRead = paths.read !== undefined && paths.read.length > 0;
	const hasBash = paths.bash !== undefined && paths.bash.length > 0;

	if (!hasWrite && !hasRead && !hasBash) return null;

	return (event: { toolName: string; input: Record<string, unknown> }): PathPermissionResult | null => {
		const { toolName, input } = event;

		if (WRITE_TOOLS.has(toolName)) {
			if (!hasWrite) return null;

			const rawPath = (input.file_path ?? input.filePath ?? input.path) as string | undefined;
			if (!rawPath) return null;

			const normalized = normalizeFilePath(rawPath);

			if (matchesAnyPattern(normalized, paths.write!)) return null;

			return {
				block: true,
				reason: `Path ${normalized} is not in the allowed write paths: ${paths.write!.join(", ")}`,
			};
		}

		if (READ_TOOLS.has(toolName)) {
			if (!hasRead) return null;

			const rawPath = (input.file_path ?? input.filePath ?? input.path) as string | undefined;
			if (!rawPath) return null;

			const normalized = normalizeFilePath(rawPath);

			if (matchesAnyPattern(normalized, paths.read!)) return null;

			return {
				block: true,
				reason: `Path ${normalized} is not in the allowed read paths: ${paths.read!.join(", ")}`,
			};
		}

		if (SKIP_PATH_TOOLS.has(toolName)) return null;

		return null;
	};
}
