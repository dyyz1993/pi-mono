import { readFile as fsReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type { FileTracker } from "../client/file-tracker.js";
import type { LspRuntimeRegistry } from "../client/registry.js";
import { extractPullDiagnostics, type LspDiagnostic, languageIdFromPath } from "../utils/lsp-helpers.js";
import type { DiagnosticsMode } from "./diagnostics-mode.js";

export interface FileDiagnostics {
	filePath: string;
	diagnostics: LspDiagnostic[];
}

export interface AgentEndHook {
	register(pi: ExtensionAPI): void;
}

export function createAgentEndHook(
	runtime: LspRuntimeRegistry,
	mode: DiagnosticsMode,
	fileTracker?: FileTracker,
	onDiagnostics?: (results: FileDiagnostics[]) => void,
): AgentEndHook {
	return {
		register(pi: ExtensionAPI): void {
			pi.on("agent_end", async () => {
				await handleAgentEnd();
			});
		},
	};

	async function handleAgentEnd(): Promise<void> {
		if (mode.get() !== "agent_end") {
			return;
		}

		const touchedFiles = mode.getTouchedFiles();
		if (touchedFiles.length === 0) {
			return;
		}

		const results: FileDiagnostics[] = [];

		for (const filePath of touchedFiles) {
			try {
				const diagnostics = await runDiagnosticsForFile(filePath);
				if (diagnostics.length > 0) {
					results.push({ filePath, diagnostics });
				}
			} catch {
				// skip files that fail
			}
		}

		mode.clearTouchedFiles();

		if (results.length > 0) {
			onDiagnostics?.(results);
		}
	}

	async function runDiagnosticsForFile(filePath: string): Promise<LspDiagnostic[]> {
		const cwd = process.cwd();
		const uri = pathToFileURL(resolve(cwd, filePath)).href;

		if (fileTracker) {
			fileTracker.open(filePath, (evictedFile) => {
				const evictedUri = pathToFileURL(resolve(cwd, evictedFile)).href;
				runtime.notify("textDocument/didClose", { textDocument: { uri: evictedUri } }, { path: evictedFile });
			});
		}

		let fileContent = "";
		try {
			fileContent = await fsReadFile(resolve(cwd, filePath), "utf8");
		} catch {}

		runtime.notify(
			"textDocument/didOpen",
			{
				textDocument: {
					uri,
					languageId: languageIdFromPath(filePath),
					version: Date.now(),
					text: fileContent,
				},
			},
			{ path: filePath },
		);

		await new Promise((r) => setTimeout(r, 2000));

		let diagnostics = runtime.getPublishedDiagnostics(filePath);

		try {
			const allResults = await runtime.requestAll(
				"textDocument/diagnostic",
				{ textDocument: { uri } },
				{ path: filePath, timeoutMs: 8000 },
			);
			for (const result of allResults) {
				if (!result) continue;
				const pulled = extractPullDiagnostics(result);
				if (pulled.length > 0) {
					diagnostics = diagnostics.concat(pulled);
				}
			}
		} catch {}

		return diagnostics;
	}
}

export function summarizeDiagnostics(diagnostics: Array<{ severity?: number }>): string {
	if (diagnostics.length === 0) {
		return "no diagnostics";
	}

	let errors = 0;
	let warnings = 0;
	let infos = 0;
	for (const diagnostic of diagnostics) {
		switch (diagnostic.severity) {
			case 1:
				errors += 1;
				break;
			case 2:
				warnings += 1;
				break;
			default:
				infos += 1;
				break;
		}
	}

	const parts = [`${diagnostics.length} diagnostics`];
	if (errors > 0) parts.push(`${errors} errors`);
	if (warnings > 0) parts.push(`${warnings} warnings`);
	if (infos > 0) parts.push(`${infos} info`);
	return parts.join(", ");
}
