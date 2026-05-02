import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ExtensionAPI, type ExtensionCommandContext, ServerChannel } from "@dyyz1993/pi-coding-agent";
import { createFileTracker } from "./client/file-tracker.js";
import { createLspRuntimeRegistry } from "./client/registry.js";
import { createLspConfigResolver } from "./config/resolver.js";
import { createAgentEndHook, type FileDiagnostics, summarizeDiagnostics } from "./hooks/agent-end.js";
import { createDiagnosticsMode, type DiagnosticsModeName } from "./hooks/diagnostics-mode.js";
import { createWriteThroughHooks } from "./hooks/writethrough.js";
import { createLspToolRouter } from "./tools/lsp-tool.js";

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
		| "server_error";
	timestamp: number;
	servers?: unknown[];
	diagnostics?: unknown;
	filePath?: string;
	mode?: string;
	error?: string;
	serverName?: string;
	totalServers?: number;
}

export default function lspExtension(pi: ExtensionAPI): void {
	const runtime = createLspRuntimeRegistry();
	const configResolver = createLspConfigResolver();
	const toolRouter = createLspToolRouter(runtime, {
		getResolvedConfig: () => configResolver.resolve(),
	});
	const mode = createDiagnosticsMode();
	const fileTracker = createFileTracker({ maxOpenFiles: 30 });
	const writeThroughHooks = createWriteThroughHooks(runtime, {}, mode, fileTracker);
	const agentEndHook = createAgentEndHook(runtime, mode, fileTracker, (results: FileDiagnostics[]) => {
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
	let lspChannel: ServerChannel | null = null;

	toolRouter.register(pi);
	writeThroughHooks.register(pi);
	agentEndHook.register(pi);

	pi.on("session_start", async (_event: any, ctx: any) => {
		const raw = pi.registerChannel("lsp");

		if (raw) {
			lspChannel = new ServerChannel(raw);

			lspChannel.handle("lsp.setMode", (params) => {
				const { mode: newMode } = params as { mode: string };
				const validModes: DiagnosticsModeName[] = ["agent_end", "edit_write", "disabled"];
				if (!validModes.includes(newMode as DiagnosticsModeName)) return { ok: false };
				mode.set(newMode as DiagnosticsModeName);
				lspChannel?.emit("mode_changed", {
					event: "mode_changed",
					timestamp: Date.now(),
					mode: mode.get(),
				});
				return { ok: true, mode: mode.get() };
			});
		}

		const config = configResolver.resolve();

		lspChannel?.emit("startup_begin", {
			event: "startup_begin",
			timestamp: Date.now(),
			servers: config.servers.map((s) => ({ name: s.name, state: "starting", fileTypes: s.fileTypes })),
			totalServers: config.servers.length,
		});

		await runtime.start(config);
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
		}

		lspChannel?.emit("status_changed", {
			event: "status_changed",
			timestamp: Date.now(),
			servers: status.servers,
		});
		lspChannel?.emit("startup_complete", {
			event: "startup_complete",
			timestamp: Date.now(),
			servers: status.servers,
		});

		const readyCount = status.servers.filter((s) => s.status.state === "ready").length;
		const errorCount = status.servers.filter((s) => s.status.state === "error").length;
		if (status.state === "error") {
			ctx.ui.notify(`LSP startup failed: ${status.reason}`, "warning");
		} else if (readyCount > 0) {
			ctx.ui.notify(
				`LSP ready: ${readyCount}/${config.servers.length} servers connected${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
				"info",
			);
		}
	});

	pi.on("session_shutdown", async () => {
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
			lspChannel?.emit("mode_changed", {
				event: "mode_changed",
				timestamp: Date.now(),
				mode: mode.get(),
			});
			ctx.ui.notify(`LSP diagnostics mode set to: ${mode.get()}`, "info");
		},
	});
}
