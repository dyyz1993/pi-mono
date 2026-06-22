import { asRecord, getPathArg as getPathArgFromHelpers, type UnknownRecord } from "../../utils/type-helpers.ts";

export function inputToPermissionRecord(input: unknown): UnknownRecord {
	return asRecord(input);
}

/**
 * Match a tool name + input against a permission pattern.
 * Supports `tool`, `tool*`, `*tool`, `*tool*`, and `tool(glob1|glob2)` where
 * the glob matches against `command`, `file_path`/`filePath`/`path`, or
 * the JSON-stringified input.
 */
export function matchesToolPattern(toolName: string, input: UnknownRecord, pattern: string): boolean {
	const parenIdx = pattern.indexOf("(");
	if (parenIdx === -1) {
		return matchToolName(toolName, pattern);
	}

	const baseTool = pattern.substring(0, parenIdx).trim();
	if (baseTool !== "" && baseTool !== "*" && baseTool !== toolName) return false;

	const globEnd = pattern.lastIndexOf(")");
	const globPattern = pattern.substring(parenIdx + 1, globEnd === -1 ? pattern.length : globEnd).trim();
	if (!globPattern || globPattern === "*") return true;

	const parts = globPattern.split("|");
	const command = typeof input.command === "string" ? input.command : "";
	const filePath = getPathArgFromHelpers(input) ?? "";
	const inputStr = JSON.stringify(input);
	const targets = [command, filePath, inputStr].filter((target) => target.length > 0);

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		if (targets.some((target) => globToRegex(trimmed).test(target))) return true;
	}
	return false;
}

function matchToolName(toolName: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length >= 2) {
		const middle = pattern.slice(1, -1);
		return middle.length === 0 || toolName.includes(middle);
	}
	if (pattern.startsWith("*") && pattern.length > 1) {
		return toolName.endsWith(pattern.slice(1));
	}
	if (pattern.endsWith("*") && pattern.length > 1) {
		return toolName.startsWith(pattern.slice(0, -1));
	}
	return pattern === toolName;
}

function globToRegex(trimmed: string): RegExp {
	const startsWithWildcard = trimmed.startsWith("*");
	const endsWithWildcard = trimmed.endsWith("*");
	let regexStr = trimmed.replace(/[.+?^$()|\\]/g, "\\$&");
	regexStr = regexStr.replace(/\*/g, ".*");
	if (!startsWithWildcard) regexStr = `^${regexStr}`;
	if (!endsWithWildcard) regexStr = `${regexStr}$`;
	return new RegExp(regexStr);
}
