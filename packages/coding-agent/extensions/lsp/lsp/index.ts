import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ExtensionAPI, type ExtensionCommandContext, type ServerChannel, createTypedChannel } from "@dyyz1993/pi-coding-agent";
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
import { scanProjectFileTypes, filterServersByProject } from "./utils/project-scanner.js";

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

		pi.sendMessage(
			{
				customType: "lsp_diagnostics",
				content: `[LSP] Post-edit diagnostics found issues in ${results.length} file(s): ${summary}.\nPlease review and fix the issues listed below.`,
				display: true,
				details: { files: fileSummaries },
			},
			{ triggerTurn: true },
		);
	});

	let idleCleanupTimer: ReturnType<typeof setTimeout> | undefined;
	let lspChannel: ServerChannel<LspChannelContract> | null = null;

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

		// Scan project for file types and filter servers
		const cwd = process.cwd();
		const scanResult = scanProjectFileTypes(cwd);
		const filteredServers = filterServersByProject(config.servers, scanResult);
		const skippedNames = config.servers
			.filter((s) => !filteredServers.some((f) => f.name === s.name))
			.map((s) => s.name);
		const discoveredExts = [...scanResult.discoveredExtensions].sort();

		if (skippedNames.length > 0) {
			console.log(
				`[lsp] Project scan found [${discoveredExts.join(", ")}], starting ${filteredServers.length}/${config.servers.length} servers (skipped: ${skippedNames.join(", ")})`,
			);
		}

		const filteredConfig = { ...config, servers: filteredServers };

		lspChannel?.emit("startup_begin", {
			event: "startup_begin",
			timestamp: Date.now(),
			servers: filteredConfig.servers.map((s) => ({ name: s.name, state: "starting", fileTypes: s.fileTypes })),
			totalServers: filteredConfig.servers.length,
		});

		await runtime.start(filteredConfig);
		const status = runtime.getStatus();

		for (const srv of status.servers) {
			lspChannel?.emit("server_ready", {
				event:
					srv.status.state === "ready"
						? "server_ready"
						: srv.status.state === "error"
							? "server_error"
							: "server_error",
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
		const errorEntries = status.servers.filter((s) => s.status.state === "error");
		const errorNames = errorEntries.map((s) => `${s.name}(${s.status.reason.slice(0, 80)})`);

		if (status.state === "error" || errorCount > 0) {
			ctx.ui.notify(
				`LSP: ${readyCount}/${config.servers.length} ready [${readyNames.join(", ")}]` +
					(errorCount > 0 ? ` | ${errorCount} FAILED: ${errorNames.join(", ")}` : ""),
				"warning",
			);
		} else if (readyCount > 0) {
			ctx.ui.notify(`LSP ready: ${readyCount}/${config.servers.length} [${readyNames.join(", ")}]`, "info");
		}

		// Startup metrics log
		const startupSnapshots = metrics.snapshot();
		for (const snap of startupSnapshots) {
			const startupMs = snap.startupDurationMs !== undefined ? `${snap.startupDurationMs}ms` : "n/a";
			const types = snap.fileTypes.length > 0 ? snap.fileTypes.join(",") : "*";
			console.log(`[lsp-metrics] ${snap.name} [${types}] state=${snap.state} startup=${startupMs} pid=${snap.pid ?? "n/a"}`);
		}
	});

	pi.on("session_shutdown", async () => {
		// Session metrics report
		console.log(metrics.summary());

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
