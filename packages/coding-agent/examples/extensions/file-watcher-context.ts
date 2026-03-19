/**
 * File Watcher Context Extension
 *
 * Watches specific files/directories and injects their content into context
 * when they change. Perfect for:
 * - Monitoring config files
 * - Tracking TODO.md changes
 * - Auto-injecting error logs
 * - Syncing shared state files
 *
 * Usage:
 * 1. Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 * 2. Create .pi/watcher-config.json with paths to watch:
 *    {
 *      "watch": ["./src/config.ts", "./TODO.md", "./logs/error.log"],
 *      "injectContent": true
 *    }
 * 3. Use /watcher to manage
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface WatcherConfig {
	watch: string[];
	injectContent: boolean;
	maxContentLength?: number;
}

interface WatchedFile {
	path: string;
	lastContent: string;
	lastModified: number;
}

const DEFAULT_CONFIG: WatcherConfig = {
	watch: [],
	injectContent: true,
	maxContentLength: 2000,
};

export default function fileWatcherExtension(pi: ExtensionAPI) {
	const config: WatcherConfig = { ...DEFAULT_CONFIG };
	const watchedFiles = new Map<string, WatchedFile>();
	const watchers = new Map<string, ReturnType<typeof watch>>();
	let enabled = true;

	// Load config from .pi/watcher-config.json
	const loadConfig = () => {
		const configPath = join(pi.cwd, ".pi", "watcher-config.json");
		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf-8");
				const loaded = JSON.parse(content);
				Object.assign(config, loaded);
			} catch (error) {
				// Use defaults if config invalid
			}
		}
	};

	// Read file content safely
	const readFileContent = (filePath: string): string => {
		try {
			const absPath = filePath.startsWith("/") ? filePath : join(pi.cwd, filePath);
			if (!existsSync(absPath)) return "";

			const content = readFileSync(absPath, "utf-8");
			const maxLen = config.maxContentLength || 2000;
			return content.length > maxLen ? content.slice(0, maxLen) + "... (truncated)" : content;
		} catch {
			return "";
		}
	};

	// Start watching a file
	const startWatching = (filePath: string) => {
		if (watchers.has(filePath)) return;

		const absPath = filePath.startsWith("/") ? filePath : join(pi.cwd, filePath);
		const initialContent = readFileContent(filePath);

		watchedFiles.set(filePath, {
			path: filePath,
			lastContent: initialContent,
			lastModified: Date.now(),
		});

		try {
			const watcher = watch(absPath, (eventType) => {
				if (eventType === "change" && enabled) {
					const newContent = readFileContent(filePath);
					const cached = watchedFiles.get(filePath);

					if (cached && newContent !== cached.lastContent) {
						cached.lastContent = newContent;
						cached.lastModified = Date.now();

						// Notify user of change
						if (pi.hasUI()) {
							pi.ui.notify(`File changed: ${filePath}`, "info");
						}
					}
				}
			});
			watchers.set(filePath, watcher);
		} catch (error) {
			// File may not exist yet, will retry on next check
		}
	};

	// Stop watching a file
	const stopWatching = (filePath: string) => {
		const watcher = watchers.get(filePath);
		if (watcher) {
			watcher.close();
			watchers.delete(filePath);
		}
		watchedFiles.delete(filePath);
	};

	// Refresh all watched files
	const refreshWatchList = () => {
		// Stop watching removed paths
		for (const path of watchers.keys()) {
			if (!config.watch.includes(path)) {
				stopWatching(path);
			}
		}

		// Start watching new paths
		for (const path of config.watch) {
			startWatching(path);
		}
	};

	// Build context from watched files
	const buildContextContent = (): string => {
		if (!enabled || watchedFiles.size === 0) return "";

		const parts: string[] = [];
		parts.push("[FILE WATCHER CONTEXT]");
		parts.push(`Monitoring ${watchedFiles.size} file(s), updates auto-injected\n`);

		for (const [path, data] of watchedFiles) {
			const timeAgo = Math.round((Date.now() - data.lastModified) / 1000);
			parts.push(`--- File: ${path} (updated ${timeAgo}s ago) ---`);
			if (config.injectContent && data.lastContent) {
				parts.push(data.lastContent);
			} else {
				parts.push(`(content tracking disabled, ${data.lastContent.length} bytes)`);
			}
			parts.push("");
		}

		return parts.join("\n");
	};

	// Register /watcher command
	pi.registerCommand("watcher", {
		description: "Manage file watcher context (status/add/remove/reload)",
		getArgumentCompletions: (prefix) => {
			const commands = ["status", "add", "remove", "reload", "enable", "disable"];
			return commands
				.filter((c) => c.startsWith(prefix.toLowerCase()))
				.map((c) => ({ label: c, description: `/${c}` }));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase();

			switch (subcommand) {
				case "status": {
					const status = enabled ? "enabled" : "disabled";
					const files = config.watch.join(", ") || "(none)";
					ctx.ui.notify(`Watcher: ${status}\nFiles: ${files}\nActive: ${watchedFiles.size}`, "info");
					break;
				}

				case "add": {
					const pathToAdd = parts[1];
					if (!pathToAdd) {
						ctx.ui.notify("Usage: /watcher add <path>", "warning");
						return;
					}
					if (!config.watch.includes(pathToAdd)) {
						config.watch.push(pathToAdd);
						startWatching(pathToAdd);
						ctx.ui.notify(`Watching: ${pathToAdd}`, "info");
					}
					break;
				}

				case "remove": {
					const pathToRemove = parts[1];
					if (!pathToRemove) {
						ctx.ui.notify("Usage: /watcher remove <path>", "warning");
						return;
					}
					const idx = config.watch.indexOf(pathToRemove);
					if (idx >= 0) {
						config.watch.splice(idx, 1);
						stopWatching(pathToRemove);
						ctx.ui.notify(`Stopped watching: ${pathToRemove}`, "info");
					}
					break;
				}

				case "reload":
					loadConfig();
					refreshWatchList();
					ctx.ui.notify("Watcher config reloaded", "info");
					break;

				case "enable":
					enabled = true;
					ctx.ui.notify("File watcher enabled", "info");
					break;

				case "disable":
					enabled = false;
					ctx.ui.notify("File watcher disabled", "info");
					break;

				default:
					ctx.ui.notify("Usage: /watcher <status|add|remove|reload|enable|disable>", "warning");
			}
		},
	});

	// Inject watched file content into context
	pi.on("context", async (event, ctx) => {
		const contextContent = buildContextContent();
		if (!contextContent) return;

		const contextMessage = {
			role: "system" as const,
			content: contextContent,
		};

		// Insert after system messages
		const messages = [...event.messages];
		const insertIndex = messages.findIndex((m) => m.role === "user");
		const finalIndex = insertIndex > 0 ? insertIndex : messages.length;

		messages.splice(finalIndex, 0, contextMessage as any);

		return {
			messages,
		};
	});

	// Update status on agent start
	pi.on("agent_start", async (_event, ctx) => {
		if (ctx.hasUI() && enabled) {
			ctx.ui.setStatus("file-watcher", `Watching: ${watchedFiles.size} files`);
		}
	});

	// Clean up on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		for (const watcher of watchers.values()) {
			watcher.close();
		}
		watchers.clear();
		watchedFiles.clear();

		if (ctx.hasUI()) {
			ctx.ui.setStatus("file-watcher", undefined);
		}
	});

	// Initialize
	loadConfig();
	refreshWatchList();
}
