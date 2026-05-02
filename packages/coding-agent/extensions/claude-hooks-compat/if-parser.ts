import type { IfClause } from "./types.js";

export function parseIfClause(ifClause: string): IfClause | null {
	const match = ifClause.match(/^(\w+)\((.+)\)$/);
	if (!match) return null;
	return { tool: match[1], pattern: match[2] };
}

export function matchesIfClause(
	ifClause: string | undefined,
	toolName: string,
	toolInput: Record<string, unknown>,
): boolean {
	if (!ifClause) return true;

	const parsed = parseIfClause(ifClause);
	if (!parsed) return true;
	if (parsed.tool !== toolName) return false;

	if (toolName === "Bash") {
		const command = (toolInput.command as string) ?? "";
		return globMatch(parsed.pattern, command);
	}

	if (toolName === "Edit" || toolName === "Write") {
		const filePath = (toolInput.file_path as string) ?? (toolInput.path as string) ?? "";
		return globMatch(parsed.pattern, filePath);
	}

	if (toolName === "Read") {
		const filePath = (toolInput.file_path as string) ?? (toolInput.path as string) ?? "";
		return globMatch(parsed.pattern, filePath);
	}

	return true;
}

function globMatch(pattern: string, text: string): boolean {
	const regex = globToRegex(pattern);
	try {
		return new RegExp(regex).test(text);
	} catch {
		return false;
	}
}

function globToRegex(pattern: string): string {
	return pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
}
