import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { minimatch } from "minimatch";
import { DEFAULT_CONFIG, type FileTimeGuardConfig } from "./config.js";

interface FileStamp {
	readTime: number;
	mtime: number;
	ctime: number;
	size: number;
}

const fileRecords = new Map<string, Map<string, FileStamp>>();

export default function (pi: ExtensionAPI) {
	const config: FileTimeGuardConfig = { ...DEFAULT_CONFIG };

	pi.on("session_start", async (_event, ctx) => {
		if (!config.enabled) return;

		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;

		fileRecords.set(sessionId, new Map());
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (sessionId) {
			fileRecords.delete(sessionId);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!config.enabled) return;

		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;

		const records = fileRecords.get(sessionId);
		if (!records) return;

		if (event.toolName === "read") {
			const relativePath = (event.input as { path: string }).path;
			const absolutePath = resolve(ctx.cwd, relativePath);

			if (shouldIgnorePath(absolutePath)) return;

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

			if (shouldIgnorePath(absolutePath)) return;

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
	});

	function shouldIgnorePath(path: string): boolean {
		for (const pattern of config.ignorePatterns) {
			if (minimatch(path, pattern)) {
				return true;
			}
		}
		return false;
	}

	pi.registerCommand("file-time-status", {
		description: "查看文件时间戳检查状态",
		handler: async (_args, ctx) => {
			const sessionId = ctx.sessionManager.getSessionId();
			if (!sessionId) {
				ctx.ui.notify("无活动会话", "info");
				return;
			}

			const records = fileRecords.get(sessionId);
			if (!records) {
				ctx.ui.notify("会话无文件记录", "info");
				return;
			}

			const count = records.size;
			const lines = [
				`文件时间戳检查: ${config.enabled ? "启用" : "禁用"}`,
				`检查模式: ${config.checkMode}`,
				`已追踪文件: ${count}`,
			];

			if (count > 0 && count <= 10) {
				lines.push("\n已追踪文件:");
				for (const [path] of Array.from(records.entries())) {
					lines.push(`  ${path}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

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
}
