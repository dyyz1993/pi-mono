/**
 * Dynamic Context Extension
 *
 * Demonstrates how to modify agent context in real-time and periodically.
 *
 * Features:
 * - Periodic data fetching (every 30 seconds)
 * - Real-time context injection before each LLM call
 * - Custom command to view/update context
 * - Status widget showing last update time
 *
 * Usage:
 * 1. Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 * 2. Run pi and use /dynamic-context to manage
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface ContextData {
	timestamp: number;
	gitBranch: string;
	openFiles: string[];
	customNotes: string[];
}

export default function dynamicContextExtension(pi: ExtensionAPI) {
	const contextData: ContextData = {
		timestamp: Date.now(),
		gitBranch: "unknown",
		openFiles: [],
		customNotes: [],
	};

	let updateInterval: NodeJS.Timeout | undefined;
	let lastUpdateTime: string = "never";

	// Start periodic updates
	const startUpdates = () => {
		if (updateInterval) return;

		updateInterval = setInterval(async () => {
			try {
				// Fetch git branch
				const branchResult = await pi.exec("git", ["branch", "--show-current"], {
					cwd: pi.cwd,
					timeout: 5000,
				});
				contextData.gitBranch = branchResult.stdout.trim() || "unknown";

				contextData.timestamp = Date.now();
				lastUpdateTime = new Date().toLocaleTimeString();

				if (pi.hasUI) {
					pi.ui.setStatus("dynamic-context", `Context: ${lastUpdateTime}`);
				}
			} catch (_error) {
				// Silently ignore errors in background updates
			}
		}, 30000); // Update every 30 seconds
	};

	// Stop periodic updates
	const stopUpdates = () => {
		if (updateInterval) {
			clearInterval(updateInterval);
			updateInterval = undefined;
		}
	};

	// Register /dynamic-context command
	pi.registerCommand("dynamic-context", {
		description: "Manage dynamic context (show/add/clear notes)",
		getArgumentCompletions: (prefix) => {
			const commands = ["show", "add", "clear", "start", "stop"];
			return commands
				.filter((c) => c.startsWith(prefix.toLowerCase()))
				.map((c) => ({ value: c, label: c, description: `/${c}` }));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0]?.toLowerCase();

			switch (subcommand) {
				case "show": {
					const notes = contextData.customNotes.join("\n") || "(no notes)";
					ctx.ui.notify(`Git: ${contextData.gitBranch}\nNotes:\n${notes}`, "info");
					break;
				}

				case "add": {
					const note = parts.slice(1).join(" ");
					if (!note) {
						ctx.ui.notify("Usage: /dynamic-context add <note>", "warning");
						return;
					}
					contextData.customNotes.push(note);
					ctx.ui.notify(`Note added: ${note}`, "info");
					break;
				}

				case "clear":
					contextData.customNotes = [];
					ctx.ui.notify("Notes cleared", "info");
					break;

				case "start":
					startUpdates();
					ctx.ui.notify("Context updates started", "info");
					break;

				case "stop":
					stopUpdates();
					ctx.ui.notify("Context updates stopped", "info");
					break;

				default:
					ctx.ui.notify("Usage: /dynamic-context <show|add|clear|start|stop>", "warning");
			}
		},
	});

	// Inject dynamic context before each LLM call
	pi.on("context", async (event, _ctx) => {
		// Add context message with current data
		const contextMessage = {
			role: "system" as const,
			content: `[DYNAMIC CONTEXT]
- Git Branch: ${contextData.gitBranch}
- Last Update: ${lastUpdateTime}
- Custom Notes: ${contextData.customNotes.length > 0 ? contextData.customNotes.join("; ") : "none"}

This context is updated every 30 seconds and injected before each LLM call.`,
		};

		// Insert after the system message, before user messages
		const messages = [...event.messages];
		const insertIndex = messages.findIndex((m) => m.role === "user");
		const finalIndex = insertIndex > 0 ? insertIndex : messages.length;

		messages.splice(finalIndex, 0, contextMessage as any);

		return {
			messages,
		};
	});

	// Show status on agent start
	pi.on("agent_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("dynamic-context", `Context: ${lastUpdateTime}`);
		}
	});

	// Clean up on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		stopUpdates();
		if (ctx.hasUI) {
			ctx.ui.setStatus("dynamic-context", undefined);
		}
	});

	// Start updates automatically
	startUpdates();
}
