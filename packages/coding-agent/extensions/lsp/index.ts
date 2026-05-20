import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type ServerChannel, createTypedChannel } from "@dyyz1993/pi-coding-agent";
import type { LspChannelContract } from "./contract.js";
import { createFileTracker } from "./client/file-tracker.js";
import { createLspRuntimeRegistry } from "./client/registry.js";
import { createLspConfigResolver } from "./config/resolver.js";
import { createAgentEndHook, type FileDiagnostics, summarizeDiagnostics } from "./hooks/agent-end.js";
import { createDiagnosticsMode, type DiagnosticsModeName } from "./hooks/diagnostics-mode.js";
import { createDependencyResolver } from "./utils/dependency-resolver.js";
import { createWriteThroughHooks } from "./hooks/writethrough.js";
import { createLspToolRouter } from "./tools/lsp-tool.js";
import { createServerMetricsCollector } from "./monitoring/server-metrics.js";
import { scanProjectFileTypes } from "./utils/project-scanner.js";
import { createLazyActivator } from "./utils/lazy-activator.js";
import { createIdleCleaner } from "./utils/idle-cleaner.js";

export interface LspChannelEvent {
	event:
		| "status_changed"
		| "diagnostics_update"
		| "mode_changed"
		| "error"
		| "startup_begin"
		| "startup_complete"
		| "server_starting"
		| "server_ready"
		| "server_error"
		| "server_unloaded"
		| "language_activated";
	timestamp: number;
	servers?: unknown[];
	diagnostics?: unknown;
	filePath?: string;
	mode?: string;
	error?: string;
	serverName?: string;
	totalServers?: number;
	languages?: string[];
}

export default function lspExtension(pi: ExtensionAPI): void {
	const metrics = createServerMetricsCollector();
	const runtime = createLspRuntimeRegistry({ metrics });
	const configResolver = createLspConfigResolver();
	const toolRouter = createLspToolRouter(runtime, {
		getResolvedConfig: () => configResolver.resolve(),
	});
	const mode = createDiagnosticsMode();
	const fileTracker = createFileTracker({ maxOpenFiles: configResolver.resolve().maxOpenFiles });
	const dependencyResolver = createDependencyResolver();
	const writeThroughHooks = createWriteThroughHooks(runtime, {}, mode, fileTracker);
	const agentEndHook = createAgentEndHook(runtime, mode, fileTracker, dependencyResolver, (results: FileDiagnostics[]) => {
		for (const { filePath, diagnostics } of results) {
			lspChannel?.emit("diagnostics_update", {
				event: "diagnostics_update",
				timestamp: Date.now(),
				filePath,
				diagnostics,
			});
		}

		const allDiagnostics = results.flatMap((r) => r.diagnostics);
		const summary = summarizeDiagnostics(allDiagnostics);
		const fileSummaries = results.map((r) => ({
			filePath: r.filePath,
			summary: summarizeDiagnostics(r.diagnostics),
			issues: r.diagnostics.map((d) => ({
				severity: d.severity,
				line: d.range.start.line + 1,
				message: d.message,
				source: d.source,
				code: d.code,
			})),
		}));

		try {
			pi.sendMessage(
				{
					customType: "lsp_diagnostics",
					content: `[LSP] Post-edit diagnostics found issues in ${results.length} file(s): ${summary}.\nPlease review and fix the issues listed below.`,
					display: true,
					details: { files: fileSummaries },
				},
				{ triggerTurn: true },
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("stale")) return;
			throw err;
		}
	});

	let idleCleanupTimer: ReturnType<typeof setTimeout> | undefined;
	let lspChannel: ServerChannel<LspChannelContract> | null = null;

	const lazyActivator = createLazyActivator(runtime);
	const idleCleaner = createIdleCleaner(runtime, {
		onUnload: (name: string) => {
			lspChannel?.emit("server_unloaded", {
				event: "server_unloaded",
				timestamp: Date.now(),
				serverName: name,
			});
		},
	});

	toolRouter.register(pi);
	writeThroughHooks.register(pi);
	agentEndHook.register(pi);

		function getActiveLanguages(): string[] {
			const status = runtime.getStatus();
			return status.servers
				.filter((s) => s.status.state === "ready")
				.flatMap((s) => s.fileTypes ?? []);
		}

		pi.on("session_start", async (_event: any, ctx: any) => {
		try {
			const raw = pi.registerChannel("lsp");
			if (raw) {
				lspChannel = createTypedChannel<LspChannelContract>(raw).server;

				lspChannel.handle("lsp.setMode", (params) => {
					const { mode: newMode } = params;
					const validModes: DiagnosticsModeName[] = ["agent_end", "edit_write", "disabled"];
					if (!validModes.includes(newMode as DiagnosticsModeName)) return { ok: false };
					mode.set(newMode as DiagnosticsModeName);
					const modeData = {
						event: "mode_changed" as const,
						timestamp: Date.now(),
						mode: mode.get(),
					};
					lspChannel?.emit("mode_changed", modeData);
					pi.appendEntry("lsp", modeData);
					return { ok: true, mode: mode.get() };
				});

				lspChannel.handle("getActiveLanguages", () => {
					return { languages: getActiveLanguages() };
				});

				lspChannel.handle("getStatus", () => {
					const s = runtime.getStatus();
					return {
						state: s.state,
						servers: s.servers.map((srv) => ({
							name: srv.name,
							fileTypes: srv.fileTypes,
							state: srv.status.state,
							reason: srv.status.reason,
							transport: srv.status.transport,
							activeCommand: srv.status.activeCommand,
							configuredCommand: srv.status.configuredCommand,
						})),
						mode: mode.get(),
					};
				});
			}
		} catch {
			// registerChannel is only available in RPC mode; gracefully degrade in TUI/print mode
		}

		const config = configResolver.resolve();

		// Build lazy activation index
		lazyActivator.buildIndex(config.servers);

		// Scan project for file counts to determine primary languages
		const cwd = process.cwd();
		const scanResult = scanProjectFileTypes(cwd);
		lazyActivator.markPrimary(scanResult.extensionCounts);

		const primaryNames = lazyActivator.getPrimaryServerNames();

		if (primaryNames.length > 0) {
			console.log(`[lsp] Primary servers: ${primaryNames.join(", ")} (starting eagerly)`);
		} else {
			console.log(`[lsp] No primary servers detected, all servers will be lazy-activated`);
		}

		if (scanResult.extensionCounts.size > 0) {
			const topExts = [...scanResult.extensionCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([ext, count]) => `${ext}(${count})`);
			console.log(`[lsp] Project file types: ${topExts.join(", ")}`);
		}

		// Emit startup_begin event
		lspChannel?.emit("startup_begin", {
			event: "startup_begin",
			timestamp: Date.now(),
			servers: primaryNames.map(name => {
				const config_entry = config.servers.find(s => s.name === name);
				return { name, state: "starting", fileTypes: config_entry?.fileTypes };
			}),
			totalServers: primaryNames.length,
		});

		// Start primary servers
		const startedNames = await lazyActivator.startPrimaryServers();

		// Start idle cleaner
		idleCleaner.start();

		// Get final status for notifications
		const status = runtime.getStatus();

		// Emit per-server events for primary servers
		for (const name of startedNames) {
			const srv = status.servers.find(s => s.name === name);
			if (srv) {
				lspChannel?.emit("server_ready", {
					event: srv.status.state === "ready" ? "server_ready" : "server_error",
					timestamp: Date.now(),
					serverName: srv.name,
					servers: [srv],
				});
				if (srv.status.state === "ready" && srv.fileTypes && srv.fileTypes.length > 0) {
					lspChannel?.emit("language_activated", {
						event: "language_activated",
						timestamp: Date.now(),
						serverName: srv.name,
						languages: srv.fileTypes,
					});
				}
			}
		}

		lspChannel?.emit("status_changed", {
			event: "status_changed",
			timestamp: Date.now(),
			servers: status.servers,
			state: status.state,
		});
		pi.appendEntry("lsp", {
			event: "status_changed",
			timestamp: Date.now(),
			servers: status.servers,
			state: status.state,
		});
		lspChannel?.emit("startup_complete", {
			event: "startup_complete",
			timestamp: Date.now(),
			servers: status.servers,
		});

		const readyCount = status.servers.filter((s) => s.status.state === "ready").length;
		const errorCount = status.servers.filter((s) => s.status.state === "error").length;
		const readyNames = status.servers.filter((s) => s.status.state === "ready").map((s) => s.name);

		if (readyCount > 0) {
			ctx.ui.notify(`LSP ready: ${readyCount} primary [${readyNames.join(", ")}] (secondary: lazy)`, "info");
		}
	});

	pi.on("session_shutdown", async () => {
		// Session metrics report
		console.log(metrics.summary());

		idleCleaner.stop();

		if (idleCleanupTimer !== undefined) {
			clearTimeout(idleCleanupTimer);
			idleCleanupTimer = undefined;
		}
		fileTracker.closeAll((evictedFile) => {
			const evictedUri = pathToFileURL(resolve(process.cwd(), evictedFile)).href;
			runtime.notify("textDocument/didClose", { textDocument: { uri: evictedUri } }, { path: evictedFile });
		});
		await runtime.stop();
		lspChannel = null;
	});

	pi.on("agent_end", async () => {
		if (idleCleanupTimer !== undefined) {
			clearTimeout(idleCleanupTimer);
		}
		idleCleanupTimer = setTimeout(() => {
			const idleFiles = fileTracker.getIdleFiles(60000);
			for (const file of idleFiles) {
				const uri = pathToFileURL(resolve(process.cwd(), file)).href;
				runtime.notify("textDocument/didClose", { textDocument: { uri } }, { path: file });
			}
			fileTracker.closeAll(() => {});
		}, 30000);
	});

	pi.registerCommand("lsp-status", {
		description: "Show health information for the LSP extension scaffold",
		handler: async (_args, ctx) => {
			const status = runtime.getStatus();
			const lines = [
				`LSP registry: ${status.state}`,
				`Reason: ${status.reason}`,
				`Configured servers: ${status.configuredServers}`,
				`Active servers: ${status.activeServers}`,
				`Diagnostics mode: ${mode.get()}`,
				`Open files: ${fileTracker.getOpenFiles().length}`,
			];

			if (status.servers.length > 0) {
				lines.push("Servers:");
				for (const server of status.servers) {
					const command =
						server.status.activeCommand?.join(" ") ??
						server.status.configuredCommand?.join(" ") ??
						"not configured";
					const fileTypes = server.fileTypes && server.fileTypes.length > 0 ? server.fileTypes.join(",") : "*";
					lines.push(
						`- ${server.name} [${fileTypes}] -> ${server.status.state}; transport=${server.status.transport ?? "n/a"}; command=${command}; reason=${server.status.reason}`,
					);
				}
			}

			ctx.ui.notify(lines.join("\n"), status.state === "error" ? "warning" : "info");
		},
	});

	pi.registerCommand("lsp", {
		description: "Switch LSP diagnostics mode (agent_end | edit_write | disabled)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify(`LSP diagnostics mode: ${mode.get()}`, "info");
				return;
			}

			const validModes: DiagnosticsModeName[] = ["agent_end", "edit_write", "disabled"];
			if (!validModes.includes(trimmed as DiagnosticsModeName)) {
				ctx.ui.notify(`Invalid mode "${trimmed}". Valid modes: ${validModes.join(", ")}`, "warning");
				return;
			}

			mode.set(trimmed as DiagnosticsModeName);
			const modeData = {
				event: "mode_changed" as const,
				timestamp: Date.now(),
				mode: mode.get(),
			};
			lspChannel?.emit("mode_changed", modeData);
			pi.appendEntry("lsp", modeData);
			ctx.ui.notify(`LSP diagnostics mode set to: ${mode.get()}`, "info");
		},
	});
}
