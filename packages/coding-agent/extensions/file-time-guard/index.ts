import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { minimatch } from "minimatch";
import { DEFAULT_CONFIG, type FileTimeGuardConfig } from "./config.ts";

interface FileStamp {
	readTime: number;
	mtime: number;
	ctime: number;
	size: number;
}

const fileRecords = new Map<string, Map<string, FileStamp>>();
const fileConfigs = new Map<string, FileTimeGuardConfig>();

function shouldIgnorePath(p: string, cfg: FileTimeGuardConfig): boolean {
	for (const pattern of cfg.ignorePatterns) {
		if (minimatch(p, pattern)) {
			return true;
		}
	}
	return false;
}

/**
 * Extract target file paths from in-place editing bash commands.
 * Recognized: sed -i, perl -pi, awk -i inplace
 * Returns empty array if no in-place edit is detected or parsing fails.
 * All regex matching is try-caught to prevent blocking on unexpected input.
 */
export function extractBashInPlaceFiles(command: string): string[] {
	try {
		const trimmed = command.trim();
		if (!trimmed) return [];

		// Quoted string pattern
		const Q = "(?:'[^']*'|\"[^\"]*\")";

		// sed -i [backup] ([ -e Q ]+ | Q) files
		// Handles: sed -i 'expr' f, sed -i.bak 'expr' f, sed -i -e 'expr' f,
		//          sed -i -e 'e1' -e 'e2' f, sed -i -n -e 'expr/p' f
		const sedResult = matchSedInPlace(trimmed, Q);
		if (sedResult) return sedResult;

		// perl -pi [.bak] [flags] -e 'expr' files
		// Handles: perl -pi -e '...' f, perl -pi -l -e '...' f
		const perlResult = matchPerlInPlace(trimmed, Q);
		if (perlResult) return perlResult;

		// awk [flags] -i inplace [flags] '{expr}' files
		const awkResult = matchAwkInPlace(trimmed, Q);
		if (awkResult) return awkResult;

		return [];
	} catch {
		return [];
	}
}

/**
 * Match sed -i command and extract file paths.
 * Separated from main function for clarity.
 */
function matchSedInPlace(cmd: string, Q: string): string[] | null {
	// sed [flags] -i[backup] [expr-or-flags] ([ -e Q ]+ | Q) files
	// Backup suffix: optional group after -i matching quoted string or bare word
	// - -n before -i: matched by [a-zA-Z]* before i
	// - multiple -e: (?:-e\s+Q\s+)*-e\s+Q consumes all -e pairs (backtracking greedy)
	// - single Q: direct expression without -e
	const re = new RegExp(
		`\\bsed\\s+-[a-zA-Z]*i[a-zA-Z]*(?:\\s*(?:${Q}|\\S+))?\\s+(?:(?:-e\\s+${Q}\\s+)*-e\\s+${Q}|${Q})\\s+([\\s\\S]+)`,
	);
	const m = cmd.match(re);
	if (!m) return null;
	return parseFileTokens(m[1]);
}

/**
 * Match perl -pi -e command and extract file paths.
 */
function matchPerlInPlace(cmd: string, Q: string): string[] | null {
	// perl -pi[.bak] [single-char-flags] -e 'expr' files
	// The (?:\s+-[a-z]+)* matches flags like -l, -i, -n between -pi and -e
	const re = new RegExp(
		`\\bperl\\s+-pi(?:\\.[a-zA-Z]+)?(?:\\s+-[a-z]+)*\\s+-e\\s+${Q}\\s+([\\s\\S]+)`,
	);
	const m = cmd.match(re);
	if (!m) return null;
	return parseFileTokens(m[1]);
}

/**
 * Match awk -i inplace command and extract file paths.
 */
function matchAwkInPlace(cmd: string, Q: string): string[] | null {
	// awk [flags-and-values]* -i inplace [flags-and-values]* '{expr}' files
	// Flags with values: -v VAR=VAL, -F'sep', etc.
	const F = `(?:-[a-zA-Z]+(?:\\s+(?:${Q}|\\S+))?\\s+)*`;
	const re = new RegExp(`\\bawk\\s+${F}-i\\s+inplace\\s+${F}'[^']*'\\s+([\\s\\S]+)`);
	const m = cmd.match(re);
	if (!m) return null;
	return parseFileTokens(m[1]);
}

/** Parse space-separated file tokens, respecting quoted strings, stopping at command boundaries and redirects. */
function parseFileTokens(rest: string): string[] {
	const files: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (const ch of rest) {
		if (inQuote) {
			if (ch === inQuote) {
				inQuote = null;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (ch === " " || ch === "\t") {
			if (current) {
				files.push(current);
				current = "";
			}
		} else {
			// Stop at command boundaries and redirects
			if (ch === "|" || ch === ";" || ch === "&" || ch === ">" || ch === "<") break;
			current += ch;
		}
	}
	if (current) files.push(current);

	// Filter out flags and pure-digit redirect FD tokens (e.g. "2" from "2>&1")
	return files.filter((f) => f.length > 0 && !f.startsWith("-") && !/^\d+$/.test(f));
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("file-time-check-mode", {
		description: "文件时间戳检查模式 (block/warn/ignore)",
		type: "string",
		default: "block",
	});

	pi.registerFlag("disable-file-time-check", {
		description: "禁用文件时间戳检查",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		const disabled = pi.getFlag("disable-file-time-check");
		const mode = pi.getFlag("file-time-check-mode");

		if (disabled === true) return;

		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;

		fileRecords.set(sessionId, new Map());
		fileConfigs.set(sessionId, {
			...DEFAULT_CONFIG,
			...(mode === "block" || mode === "warn" || mode === "ignore" ? { checkMode: mode } : {}),
		});
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (sessionId) {
			fileRecords.delete(sessionId);
			fileConfigs.delete(sessionId);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;

		const config = fileConfigs.get(sessionId);
		if (!config) return;

		const records = fileRecords.get(sessionId);
		if (!records) return;

		if (event.toolName === "read") {
			const relativePath = (event.input as { path: string }).path;
			const absolutePath = resolve(ctx.cwd, relativePath);

			if (shouldIgnorePath(absolutePath, config)) return;

			try {
				const stats = await stat(absolutePath);

				records.set(absolutePath, {
					readTime: Date.now(),
					mtime: stats.mtimeMs,
					ctime: stats.ctimeMs,
					size: stats.size,
				});
			} catch (err) {
				console.debug("[file-time-guard] file stat failed:", err instanceof Error ? err.message : err);
			}
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const relativePath = (event.input as { path: string }).path;
			const absolutePath = resolve(ctx.cwd, relativePath);

			if (shouldIgnorePath(absolutePath, config)) return;

			// write (create new file): skip read-before-edit check
			// Only check edit (modify existing file)
			if (event.toolName === "edit") {
				const record = records.get(absolutePath);

				if (!record) {
					if (config.checkMode === "block") {
						ctx.ui.notify(
							`文件未读取过: ${relativePath}\n请先读取文件再修改`,
							"error",
						);
						return { block: true, reason: "文件未读取过" };
					}
					if (config.checkMode === "warn") {
						ctx.ui.notify(
							`警告: 文件未读取过: ${relativePath}`,
							"warning",
						);
					}
					return;
				}

				try {
					const currentStats = await stat(absolutePath);

					const isModified =
						currentStats.mtimeMs !== record.mtime ||
						currentStats.ctimeMs !== record.ctime ||
						currentStats.size !== record.size;

					if (isModified) {
						if (config.checkMode === "block") {
							ctx.ui.notify(
								`文件已被外部修改: ${relativePath}\n请重新读取文件`,
								"error",
							);
							return { block: true, reason: "文件已被外部修改" };
						}
						if (config.checkMode === "warn") {
							ctx.ui.notify(
								`警告: 文件已被外部修改: ${relativePath}`,
								"warning",
							);
						}
					}
				} catch (err) {
					console.debug("[file-time-guard] current file stat failed:", err instanceof Error ? err.message : err);
				}
			}
		}

		// Check bash commands that perform in-place file editing (sed -i, perl -pi, awk -i inplace)
		if (event.toolName === "bash") {
			const command = (event.input as { command: string }).command;
			if (typeof command !== "string") return;

			const targetFiles = extractBashInPlaceFiles(command);
			if (targetFiles.length === 0) return;

			const unreadFiles: string[] = [];
			for (const file of targetFiles) {
				const absolutePath = resolve(ctx.cwd, file);
				if (shouldIgnorePath(absolutePath, config)) continue;
				if (!records.has(absolutePath)) {
					unreadFiles.push(file);
				}
			}

			if (unreadFiles.length > 0) {
				const fileList = unreadFiles.join(", ");
				if (config.checkMode === "block") {
					ctx.ui.notify(
						`以下文件未读取过: ${fileList}\n请先读取文件再通过 bash 修改`,
						"error",
					);
					return { block: true, reason: `文件未读取过: ${fileList}` };
				}
				if (config.checkMode === "warn") {
					ctx.ui.notify(
						`警告: 以下文件未读取过: ${fileList}`,
						"warning",
					);
				}
			}
		}
	});

	pi.registerCommand("file-time-status", {
		description: "查看文件时间戳检查状态",
		handler: async (_args, ctx) => {
			const sessionId = ctx.sessionManager.getSessionId();
			if (!sessionId) {
				ctx.ui.notify("无活动会话", "info");
				return;
			}

			const records = fileRecords.get(sessionId);
			const config = fileConfigs.get(sessionId);
			if (!records || !config) {
				ctx.ui.notify("会话无文件记录", "info");
				return;
			}

			const count = records.size;
			const disabled = pi.getFlag("disable-file-time-check");
			const lines = [
				`文件时间戳检查: ${disabled === true ? "禁用" : "启用"}`,
				`检查模式: ${config.checkMode}`,
				`已追踪文件: ${count}`,
			];

			if (count > 0 && count <= 10) {
				lines.push("\n已追踪文件:");
				for (const [p] of Array.from(records.entries())) {
					lines.push(`  ${p}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
