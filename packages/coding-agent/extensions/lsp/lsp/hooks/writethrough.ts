import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "../../../../src/core/extensions/index.js";
import type { FileTracker } from "../client/file-tracker.js";
import type { LspRuntimeRegistry } from "../client/registry.js";
import {
	extractPullDiagnostics,
	type LspDiagnostic,
	type LspPosition,
	type LspRange,
	languageIdFromPath,
	normalizeRange,
} from "../utils/lsp-helpers.js";
import type { DiagnosticsMode } from "./diagnostics-mode.js";

interface LspTextEdit {
	range: LspRange;
	newText: string;
}

export interface WriteThroughHooks {
	register(pi: ExtensionAPI): void;
}

export interface WriteThroughOptions {
	cwd?: string;
	formatOnWrite?: boolean;
	diagnosticsOnWrite?: boolean;
	formattingOptions?: {
		tabSize?: number;
		insertSpaces?: boolean;
	};
}

export function createWriteThroughHooks(
	runtime: LspRuntimeRegistry,
	options: WriteThroughOptions = {},
	mode?: DiagnosticsMode,
	fileTracker?: FileTracker,
): WriteThroughHooks {
	const cwd = options.cwd ?? process.cwd();
	const formatOnWrite = options.formatOnWrite ?? true;
	const diagnosticsOnWrite = options.diagnosticsOnWrite ?? true;
	const formattingOptions = {
		tabSize: options.formattingOptions?.tabSize ?? 2,
		insertSpaces: options.formattingOptions?.insertSpaces ?? true,
	};

	return {
		register(pi: ExtensionAPI): void {
			pi.on("tool_result", async (event: any, ctx: any) => {
				return await maybeHandleWriteThrough(event, ctx);
			});
		},
	};

	async function maybeHandleWriteThrough(event: ToolResultEvent, ctx: ExtensionContext) {
		if (event.isError) {
			return;
		}
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return;
		}

		const currentMode = mode?.get() ?? "edit_write";

		if (currentMode === "disabled") {
			return;
		}

		const filePath = getToolInputPath(event.input);
		if (!filePath) {
			return;
		}

		const pathStatus = runtime.getStatusForPath(filePath);
		if (!pathStatus || pathStatus.state !== "ready") {
			return;
		}

		const uri = pathToFileURL(resolve(cwd, filePath)).href;
		const summaries: string[] = [];

		if (fileTracker) {
			fileTracker.open(filePath, (evictedFile) => {
				const evictedUri = pathToFileURL(resolve(cwd, evictedFile)).href;
				runtime.notify("textDocument/didClose", { textDocument: { uri: evictedUri } }, { path: evictedFile });
			});
		}

		try {
			const fileContent = await fsReadFile(resolve(cwd, filePath), "utf8");
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
		} catch {
			summaries.push("LSP didOpen failed");
		}

		if (formatOnWrite) {
			try {
				const rawEdits = await runtime.request(
					"textDocument/formatting",
					{
						textDocument: { uri },
						options: formattingOptions,
					},
					{ path: filePath },
				);
				const edits = normalizeTextEdits(rawEdits);
				const applied = await applyFormattingEdits(filePath, edits, cwd);
				summaries.push(applied > 0 ? `formatted (${applied} edits)` : "no formatting changes");
			} catch (error) {
				summaries.push(`format failed: ${toErrorMessage(error)}`);
			}
		}

		if (currentMode === "agent_end") {
			mode?.addTouchedFile(filePath);
			return;
		}

		if (diagnosticsOnWrite) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			let diagnostics = runtime.getPublishedDiagnostics(filePath);

			try {
				const results = await runtime.requestAll(
					"textDocument/diagnostic",
					{ textDocument: { uri } },
					{ path: filePath, timeoutMs: 8000 },
				);
				for (const result of results) {
					if (!result) continue;
					const pulled = extractPullDiagnostics(result);
					if (pulled.length > 0) {
						diagnostics = diagnostics.concat(pulled);
					}
				}
			} catch {}

			const diagSummary = summarizeDiagnostics(diagnostics);
			summaries.push(diagSummary);

			if (diagnostics.length > 0) {
				const diagText = formatDiagnosticsForToolResult(filePath, diagnostics);
				const fileSummaries = [
					{
						filePath,
						summary: diagSummary,
						issues: diagnostics.map((d) => ({
							severity: d.severity,
							line: d.range.start.line + 1,
							message: d.message,
							source: d.source,
							code: d.code,
						})),
					},
				];
				return {
					content: [...event.content, { type: "text" as const, text: `\n[LSP] ${diagSummary}\n${diagText}` }],
					details: { files: fileSummaries },
				};
			}
		}
	}
}

function getToolInputPath(input: Record<string, unknown>): string | undefined {
	const value = input.path;
	return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeTextEdits(raw: unknown): LspTextEdit[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const edits: LspTextEdit[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const edit = entry as Record<string, unknown>;
		if (typeof edit.newText !== "string") {
			continue;
		}
		const range = normalizeRange(edit.range);
		if (!range) {
			continue;
		}
		edits.push({ range, newText: edit.newText });
	}
	return edits;
}

async function applyFormattingEdits(filePath: string, edits: LspTextEdit[], cwd: string): Promise<number> {
	if (edits.length === 0) {
		return 0;
	}

	const fullPath = resolve(cwd, filePath);
	const originalText = await fsReadFile(fullPath, "utf8");
	const nextText = applyTextEdits(originalText, edits);
	if (nextText === originalText) {
		return 0;
	}

	await fsWriteFile(fullPath, nextText, "utf8");
	return edits.length;
}

function applyTextEdits(text: string, edits: LspTextEdit[]): string {
	const lineStarts = computeLineStarts(text);
	const normalized = edits
		.map((edit) => {
			const start = positionToOffset(lineStarts, text.length, edit.range.start);
			const end = positionToOffset(lineStarts, text.length, edit.range.end);
			return {
				start,
				end,
				newText: edit.newText,
			};
		})
		.filter((edit) => edit.start <= edit.end)
		.sort((left, right) => {
			if (left.start !== right.start) {
				return right.start - left.start;
			}
			return right.end - left.end;
		});

	if (normalized.length === 0) {
		return text;
	}

	const parts: string[] = [];
	let cursor = text.length;
	for (const edit of normalized) {
		if (edit.end > cursor) {
			// Defensive fallback for malformed/overlapping edit ranges.
			let output = text;
			for (const fallbackEdit of normalized) {
				output = `${output.slice(0, fallbackEdit.start)}${fallbackEdit.newText}${output.slice(fallbackEdit.end)}`;
			}
			return output;
		}

		parts.push(text.slice(edit.end, cursor));
		parts.push(edit.newText);
		cursor = edit.start;
	}
	parts.push(text.slice(0, cursor));
	return parts.reverse().join("");
}

function computeLineStarts(text: string): number[] {
	const lineStarts = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === "\n") {
			lineStarts.push(index + 1);
		}
	}
	return lineStarts;
}

function positionToOffset(lineStarts: number[], textLength: number, position: LspPosition): number {
	const safeLine = Math.max(0, position.line);
	const safeChar = Math.max(0, position.character);
	const lineStart = safeLine < lineStarts.length ? lineStarts[safeLine] : textLength;
	return Math.min(textLength, lineStart + safeChar);
}

function summarizeDiagnostics(diagnostics: LspDiagnostic[]): string {
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

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

const SEVERITY_LABELS: Record<number, string> = {
	1: "Error",
	2: "Warning",
	3: "Information",
	4: "Hint",
};

function formatDiagnosticsForToolResult(filePath: string, diagnostics: LspDiagnostic[]): string {
	const lines = [`File: ${filePath}`, `Found ${diagnostics.length} issue(s):`];
	for (const diag of diagnostics) {
		const severity = SEVERITY_LABELS[diag.severity ?? 1] ?? "Issue";
		const loc = `L${diag.range.start.line + 1}:C${diag.range.start.character}`;
		const source = diag.source ? ` [${diag.source}]` : "";
		const code = diag.code !== undefined ? ` (${diag.code})` : "";
		lines.push(`  ${severity}${source}${code}: ${loc} - ${diag.message}`);
	}
	lines.push("Consider fixing these issues before proceeding.");
	return lines.join("\n");
}
