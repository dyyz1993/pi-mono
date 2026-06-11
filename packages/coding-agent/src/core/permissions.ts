/**
 * Tool permission checks for sub-agents.
 *
 * Implemented in core so that `AgentConfig.permissionMode`, `tools` (allowlist),
 * and `disallowedTools` (blocklist) are enforced even when no permission
 * extension is loaded. The legacy `agent-permissions` extension in
 * `extensions/agent-permissions/` remains as a compatibility layer.
 *
 * Permission resolution order for each tool call:
 *   1. Allowlist (AgentConfig.tools) — block if tool not in list
 *   2. Blocklist (AgentConfig.disallowedTools) — block if tool matches
 *   3. Path constraints (AgentConfig.paths)
 *   4. Dangerous bash patterns (normal mode only)
 */

import { minimatch } from "minimatch";
import { asRecord, getPathArg as getPathArgFromHelpers, type UnknownRecord } from "../utils/type-helpers.ts";
import type { PathConfig } from "./agent-types.ts";

export type CorePermissionMode = "normal" | "yolo";

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
const READ_TOOLS = new Set(["read"]);
const SKIP_PATH_TOOLS = new Set(["grep", "glob", "find", "ls"]);

/** Bash command patterns that are blocked in `normal` mode. */
const DANGEROUS_BASH_PATTERNS: readonly RegExp[] = [
	/\brm\s+-rf\b/,
	/\bgit\s+push\s+.*--force\b/,
	/--no-verify/,
	/\bsudo\b/,
	/\bchmod\s+777\b/,
	/\.env/,
	/credentials/i,
];

export interface CheckToolPermissionInput {
	toolName: string;
	input: unknown;
	permissionMode: CorePermissionMode;
	allowedTools?: string[] | undefined;
	disallowedTools?: string[] | undefined;
	/** Optional path constraints (write/read/bash). */
	paths?: PathConfig | undefined;
}

export interface PermissionBlock {
	block: true;
	reason: string;
}

export type PermissionResult = PermissionBlock | null;

/**
 * Check whether a tool call is permitted for the current agent.
 * Returns `{ block, reason }` to reject, or `null` to allow.
 */
export function checkToolPermission(input: CheckToolPermissionInput): PermissionResult {
	const { toolName, permissionMode, allowedTools, disallowedTools, paths } = input;
	const blockDangerousBash = permissionMode === "normal";
	const inputRecord = inputToRecord(input.input);

	// 1. Allowlist (AgentConfig.tools) — if defined, only listed tools run.
	if (allowedTools && allowedTools.length > 0) {
		const matched = allowedTools.some((pattern) => matchesToolPattern(toolName, inputRecord, pattern));
		if (!matched) {
			return {
				block: true,
				reason: `Tool "${toolName}" not in allowed tools. Allowed: ${allowedTools.join(", ")}`,
			};
		}
	}

	// 2. Blocklist (AgentConfig.disallowedTools).
	if (disallowedTools && disallowedTools.length > 0) {
		const matched = disallowedTools.some((pattern) => matchesToolPattern(toolName, inputRecord, pattern));
		if (matched) {
			return { block: true, reason: `Tool "${toolName}" is explicitly disallowed.` };
		}
	}

	// 3. Path constraints (AgentConfig.paths).
	if (paths) {
		const pathResult = checkPathPermission(toolName, input.input, paths);
		if (pathResult) return pathResult;
	}

	// 4. Dangerous bash patterns (normal mode only).
	if (blockDangerousBash && toolName === "bash") {
		const command = (input.input as { command?: unknown } | undefined)?.command;
		if (typeof command === "string") {
			for (const pat of DANGEROUS_BASH_PATTERNS) {
				if (pat.test(command)) {
					return { block: true, reason: `Blocked dangerous bash command: ${command}` };
				}
			}
		}
	}

	return null;
}

function checkPathPermission(toolName: string, rawInput: unknown, paths: PathConfig): PermissionResult {
	const input = inputToRecord(rawInput);

	if (WRITE_TOOLS.has(toolName)) {
		const writePaths = paths.write;
		if (writePaths && writePaths.length > 0) {
			const rawPath = getPathArgFromHelpers(input);
			if (rawPath !== undefined && rawPath.length > 0) {
				const normalized = normalizeFilePath(rawPath);
				if (!matchesAnyPattern(normalized, writePaths)) {
					return {
						block: true,
						reason: `Path ${normalized} is not in the allowed write paths: ${writePaths.join(", ")}`,
					};
				}
			}
		}
		return null;
	}

	if (READ_TOOLS.has(toolName)) {
		const readPaths = paths.read;
		if (readPaths && readPaths.length > 0) {
			const rawPath = getPathArgFromHelpers(input);
			if (rawPath !== undefined && rawPath.length > 0) {
				const normalized = normalizeFilePath(rawPath);
				if (!matchesAnyPattern(normalized, readPaths)) {
					return {
						block: true,
						reason: `Path ${normalized} is not in the allowed read paths: ${readPaths.join(", ")}`,
					};
				}
			}
		}
		return null;
	}

	if (SKIP_PATH_TOOLS.has(toolName)) return null;

	return null;
}

function inputToRecord(input: unknown): UnknownRecord {
	return asRecord(input);
}

/**
 * Match a tool name + input against a permission pattern.
 * Supports `tool`, `tool*`, `*tool`, `*tool*`, and `tool(glob1|glob2)` where
 * the glob matches against `command`, `file_path`/`filePath`/`path`, or
 * the JSON-stringified input.
 */
function matchesToolPattern(toolName: string, input: UnknownRecord, pattern: string): boolean {
	const parenIdx = pattern.indexOf("(");
	if (parenIdx === -1) {
		return matchToolName(toolName, pattern);
	}

	const baseTool = pattern.substring(0, parenIdx).trim();
	if (baseTool !== "" && baseTool !== "*" && baseTool !== toolName) return false;

	const globPattern = pattern.substring(parenIdx + 1, pattern.lastIndexOf(")")).trim();
	if (!globPattern || globPattern === "*") return true;

	const parts = globPattern.split("|");
	const command = typeof input.command === "string" ? input.command : "";
	const filePath = getPathArgFromHelpers(input) ?? "";
	const inputStr = JSON.stringify(input);
	const targets = [command, filePath, inputStr].filter((t) => t.length > 0);

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

function normalizeFilePath(filePath: string): string {
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

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (matchPathGlob(filePath, pattern)) return true;
	}
	return false;
}

/** Match a file path against a glob; iterates over subpaths to allow patterns
 * like `docs/**` to match absolute or relative paths. */
function matchPathGlob(filePath: string, pattern: string): boolean {
	if (pattern === "**") return true;
	const normalized = normalizeFilePath(filePath);
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
