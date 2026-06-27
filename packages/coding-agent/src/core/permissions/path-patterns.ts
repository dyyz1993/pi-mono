import { minimatch } from "minimatch";

export function normalizePermissionPath(filePath: string): string {
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
		return `/${resolved.filter((p) => p !== "").join("/")}`;
	}
	return resolved.join("/") || ".";
}

/** Match a file path against a glob; iterates over subpaths to allow patterns
 * like `docs/**` to match absolute or relative paths. */
export function matchPathGlob(filePath: string, pattern: string): boolean {
	if (pattern === "**") return true;
	const normalized = normalizePermissionPath(filePath);
	const parts = normalized.split("/");
	for (let i = 0; i < parts.length; i++) {
		const subpath = parts.slice(i).join("/");
		if (subpath.length === 0) continue;
		try {
			if (minimatch(subpath, pattern, { dot: true })) return true;
		} catch {
			// Invalid pattern; treat as no match for this subpath.
		}
	}
	return false;
}

export function matchesAnyPathPattern(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (matchPathGlob(filePath, pattern)) return true;
	}
	return false;
}
