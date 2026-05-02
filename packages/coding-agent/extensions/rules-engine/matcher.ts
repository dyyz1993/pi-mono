import ignore from "ignore";

function expandBraces(pattern: string): string[] {
	const braceIndex = pattern.indexOf("{");
	if (braceIndex === -1) return [pattern];
	const closeIndex = pattern.indexOf("}", braceIndex);
	if (closeIndex === -1) return [pattern];

	const prefix = pattern.slice(0, braceIndex);
	const suffix = pattern.slice(closeIndex + 1);
	const options = pattern.slice(braceIndex + 1, closeIndex).split(",");

	const results: string[] = [];
	for (const opt of options) {
		results.push(...expandBraces(prefix + opt.trim() + suffix));
	}
	return results;
}

function expandPatterns(patterns: string[]): string[] {
	const expanded: string[] = [];
	for (const p of patterns) {
		expanded.push(...expandBraces(p));
	}
	return expanded;
}

function toRelative(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

export function matchGlob(pattern: string, target: string): boolean {
	if (!pattern || !target) return false;
	const expanded = expandBraces(pattern);
	const ig = ignore().add(expanded);
	return ig.ignores(toRelative(target));
}

export function matchesAnyGlob(globs: string[], filePath: string): boolean {
	if (!filePath || globs.length === 0) return false;
	const expanded = expandPatterns(globs);
	const ig = ignore().add(expanded);
	return ig.ignores(toRelative(filePath));
}

export function createMatcher(globs: string[]): (filePath: string) => boolean {
	if (globs.length === 0) return () => false;
	const expanded = expandPatterns(globs);
	const ig = ignore().add(expanded);
	return (filePath: string) => ig.ignores(toRelative(filePath));
}
