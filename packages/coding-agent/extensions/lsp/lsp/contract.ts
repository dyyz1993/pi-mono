import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { DiagnosticsModeName } from "./hooks/diagnostics-mode.js";
import type { LspDiagnostic } from "./utils/lsp-helpers.js";

export const LSP_CHANNEL_NAME = "lsp";

export interface LspServerSummary {
	name: string;
	fileTypes?: string[];
	state: string;
	reason: string;
	transport?: string;
	activeCommand?: string[];
	configuredCommand?: string[];
}

export interface LspStatusResult {
	state: string;
	servers: LspServerSummary[];
	mode: DiagnosticsModeName;
}

export interface LspSetModeResult {
	ok: boolean;
	mode?: DiagnosticsModeName;
}

export interface LspStartupServerEntry {
	name: string;
	state: string;
	fileTypes?: string[];
}

export interface LspServerStatusEntry {
	name: string;
	fileTypes?: string[];
	status: {
		state: string;
		reason: string;
		transport?: string;
		activeCommand?: string[];
		configuredCommand?: string[];
	};
}

export interface LspChannelContract extends ChannelContract {
	methods: {
		"lsp.setMode": {
			params: { mode: string };
			return: LspSetModeResult;
		};
		getActiveLanguages: {
			params: Record<string, never>;
			return: { languages: string[] };
		};
		getStatus: {
			params: Record<string, never>;
			return: LspStatusResult;
		};
	};
	events: {
		diagnostics_update: {
			event: "diagnostics_update";
			timestamp: number;
			filePath: string;
			diagnostics: LspDiagnostic[];
		};
		mode_changed: {
			event: "mode_changed";
			timestamp: number;
			mode: DiagnosticsModeName;
		};
		startup_begin: {
			event: "startup_begin";
			timestamp: number;
			servers: LspStartupServerEntry[];
			totalServers: number;
		};
		server_ready: {
			event: "server_ready" | "server_error";
			timestamp: number;
			serverName: string;
			servers: LspServerStatusEntry[];
		};
		language_activated: {
			event: "language_activated";
			timestamp: number;
			serverName: string;
			languages: string[];
		};
		status_changed: {
			event: "status_changed";
			timestamp: number;
			servers: LspServerStatusEntry[];
			state: string;
		};
		startup_complete: {
			event: "startup_complete";
			timestamp: number;
			servers: LspServerStatusEntry[];
		};
	};
}
