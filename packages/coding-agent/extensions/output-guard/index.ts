/**
 * Output Guard Extension - Global fallback truncation + tool limit optimization.
 *
 * Provides three capabilities:
 *
 * 1. **Global truncation fallback**: Hooks into `tool_result` events. When a tool
 *    (especially extension/plugin/MCP tools) returns output exceeding limits
 *    without self-managing truncation, this extension truncates the output and
 *    saves the full content to a temp file.
 *
 * 2. **Tool limit optimization**: Hooks into `tool_call` events to enforce lower
 *    result limits on find (1000 -> 100) and ls (500 -> 100), matching OpenCode's
 *    defaults. Reduces unnecessary context consumption.
 *
 * 3. **PDF text extraction**: Registers a `pdf_read` tool that extracts text content
 *    from PDF files using pdf-parse, since the built-in read tool does not support PDFs.
 *
 * Configuration (via .pi/settings.json or global settings):
 *   outputGuard.maxLines: number (default: 2000)
 *   outputGuard.maxBytes: number (default: 51200 = 50KB)
 *   outputGuard.findLimit: number (default: 100)
 *   outputGuard.lsLimit: number (default: 100)
 *   outputGuard.saveToFile: boolean (default: true - save truncated output to disk)
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type {
	ExtensionAPI,
	ToolResultEvent,
	ToolResultEventResult,
	ToolCallEvent,
	ToolCallEventResult,
	ExtensionContext,
} from "@dyyz1993/pi-coding-agent";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
const DEFAULT_FIND_LIMIT = 100;
const DEFAULT_LS_LIMIT = 100;

interface OutputGuardConfig {
	maxLines: number;
	maxBytes: number;
	findLimit: number;
	lsLimit: number;
	saveToFile: boolean;
}

function loadConfig(ctx: ExtensionContext): OutputGuardConfig {
	const settings = (ctx as unknown as { settings?: Record<string, unknown> }).settings;
	const guard = settings?.outputGuard as Partial<OutputGuardConfig> | undefined;
	return {
		maxLines: guard?.maxLines ?? DEFAULT_MAX_LINES,
		maxBytes: guard?.maxBytes ?? DEFAULT_MAX_BYTES,
		findLimit: guard?.findLimit ?? DEFAULT_FIND_LIMIT,
		lsLimit: guard?.lsLimit ?? DEFAULT_LS_LIMIT,
		saveToFile: guard?.saveToFile ?? true,
	};
}

// ============================================================================
// Truncation Logic
// ============================================================================

interface TruncationInfo {
	truncated: boolean;
	content: string;
	totalLines: number;
	totalBytes: number;
	truncatedBy: "lines" | "bytes" | null;
	fullOutputPath?: string;
}

/**
 * Truncate text content from the tail (keep the end - more useful for tool output).
 * Saves full content to a temp file when truncation occurs.
 */
function truncateOutput(
	content: string,
	config: OutputGuardConfig,
	ctx: ExtensionContext,
): TruncationInfo {
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	// No truncation needed
	if (totalLines <= config.maxLines && totalBytes <= config.maxBytes) {
		return {
			truncated: false,
			content,
			totalLines,
			totalBytes,
			truncatedBy: null,
		};
	}

	// Collect lines from the end
	const outputLines: string[] = [];
	let outputBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let i = lines.length - 1; i >= 0 && outputLines.length < config.maxLines; i--) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);

		if (outputBytes + lineBytes > config.maxBytes) {
			truncatedBy = "bytes";
			break;
		}

		outputLines.unshift(line);
		outputBytes += lineBytes;
	}

	if (outputLines.length >= config.maxLines && outputBytes <= config.maxBytes) {
		truncatedBy = "lines";
	}

	const truncatedContent = outputLines.join("\n");
	let fullOutputPath: string | undefined;

	// Save full output to disk
	if (config.saveToFile) {
		fullOutputPath = saveFullOutput(content, ctx);
	}

	return {
		truncated: true,
		content: truncatedContent,
		totalLines,
		totalBytes,
		truncatedBy,
		fullOutputPath,
	};
}

/**
 * Save full output content to a temp file.
 */
function saveFullOutput(content: string, ctx: ExtensionContext): string | undefined {
	try {
		const id = randomBytes(8).toString("hex");
		const dir = join(tmpdir(), "pi-output-guard");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const filePath = join(dir, `output-${id}.log`);
		writeFileSync(filePath, content);
		return filePath;
	} catch {
		return undefined;
	}
}

/**
 * Synchronous write for saveFullOutput.
 */
function writeFileSync(filePath: string, content: string): void {
	const stream = createWriteStream(filePath);
	stream.write(content);
	stream.end();
}

// ============================================================================
// Extension Entry Point
// ============================================================================

export default function outputGuard(pi: ExtensionAPI) {
	// ------------------------------------------------------------------
	// 1. Global truncation fallback via tool_result hook
	// ------------------------------------------------------------------
	pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultEventResult | void> => {
		const config = loadConfig(ctx);

		// Only process text content
		const textParts = event.content.filter((p): p is { type: "text"; text: string } => p.type === "text");
		if (textParts.length === 0) return;

		// Check if the tool already self-managed truncation via details
		if (hasSelfManagedTruncation(event)) return;

		// Check if image content is present - images have their own size management
		const hasImages = event.content.some((p) => p.type === "image");
		if (hasImages) return;

		// Concatenate all text parts
		const fullText = textParts.map((p) => p.text).join("\n");
		const totalBytes = Buffer.byteLength(fullText, "utf-8");
		const totalLines = fullText.split("\n").length;

		// Skip if within limits
		if (totalLines <= config.maxLines && totalBytes <= config.maxBytes) return;

		// Truncate
		const result = truncateOutput(fullText, config, ctx);

		let finalContent = result.content;
		if (result.truncated) {
			const notice = buildTruncationNotice(result, config);
			finalContent = finalContent + "\n\n" + notice;
		}

		return {
			content: [{ type: "text" as const, text: finalContent }],
		};
	});

	// ------------------------------------------------------------------
	// 2. Tool limit optimization via tool_call hook
	// ------------------------------------------------------------------
	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | void> => {
		const config = loadConfig(ctx);

		// Enforce lower limits on find tool
		if (event.toolName === "find") {
			const input = event.input as { limit?: number };
			if (input.limit === undefined || input.limit > config.findLimit) {
				input.limit = config.findLimit;
			}
		}

		// Enforce lower limits on ls tool
		if (event.toolName === "ls") {
			const input = event.input as { limit?: number };
			if (input.limit === undefined || input.limit > config.lsLimit) {
				input.limit = config.lsLimit;
			}
		}
	});

	// ------------------------------------------------------------------
	// 3. PDF text extraction tool
	// ------------------------------------------------------------------
	pi.registerTool({
		name: "pdf_read",
		description:
			"Read and extract text content from a PDF file. " +
			"Returns the text content of the PDF, paginated with page markers. " +
			"Use this instead of the read tool for PDF files.",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the PDF file" }),
			maxPages: Type.Optional(
				Type.Number({ description: "Maximum number of pages to extract (default: all pages)" }),
			),
		}),
		execute: async (
			args: { path: string; maxPages?: number },
			ctx: ExtensionContext,
		) => {
			const fs = await import("node:fs/promises");
			const nodePath = await import("node:path");
			const absolutePath = nodePath.resolve(ctx.cwd, args.path);

			// Check file exists
			try {
				const stat = await fs.stat(absolutePath);
				if (!stat.isFile()) {
					return { content: [{ type: "text" as const, text: `Error: ${args.path} is not a file` }], isError: true };
				}
			} catch {
				return { content: [{ type: "text" as const, text: `Error: File not found: ${args.path}` }], isError: true };
			}

			// Read PDF
			try {
				const buffer = await fs.readFile(absolutePath);

				// Dynamic import of pdf-parse (optional dependency)
				let pdfParse: typeof import("pdf-parse") | undefined;
				try {
					pdfParse = (await import("pdf-parse")).default;
				} catch {
					return {
						content: [
							{
								type: "text" as const,
								text: "Error: pdf-parse is not installed. Install it with: npm install pdf-parse",
							},
						],
						isError: true,
					};
				}

				const data = await pdfParse(buffer);
				let text = data.text;

				// Add metadata header
				const header = [
					`PDF: ${args.path}`,
					`Pages: ${data.numpages}`,
					data.info?.Title ? `Title: ${data.info.Title}` : "",
					data.info?.Author ? `Author: ${data.info.Author}` : "",
					"---",
				]
					.filter(Boolean)
					.join("\n");

				// Truncate if needed
				const config = loadConfig(ctx);
				const totalBytes = Buffer.byteLength(text, "utf-8");
				const totalLines = text.split("\n").length;

				if (totalLines > config.maxLines || totalBytes > config.maxBytes) {
					const truncResult = truncateOutput(text, config, ctx);
					text = truncResult.content;
					if (truncResult.truncated) {
						text += "\n\n" + buildTruncationNotice(truncResult, config);
					}
				}

				return {
					content: [{ type: "text" as const, text: header + "\n" + text }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Error reading PDF: ${message}` }],
					isError: true,
				};
			}
		},
	});
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a tool already self-manages truncation via its details field.
 * Built-in tools (read, bash, grep, find, ls) set details.truncation,
 * so we skip them and only catch unprotected tools.
 */
function hasSelfManagedTruncation(event: ToolResultEvent): boolean {
	// Built-in tools that self-manage truncation
	const selfManagedTools = new Set(["read", "bash", "grep", "find", "ls"]);
	if (selfManagedTools.has(event.toolName)) return true;

	// Check if details has a truncation field (any tool can opt in)
	const details = event.details as Record<string, unknown> | undefined;
	if (details && typeof details === "object" && "truncation" in details) return true;

	return false;
}

/**
 * Build a human-readable truncation notice with actionable instructions.
 */
function buildTruncationNotice(info: TruncationInfo, config: OutputGuardConfig): string {
	const parts: string[] = [];

	if (info.truncatedBy === "lines") {
		parts.push(
			`Output truncated: ${info.totalLines} lines exceeded limit of ${config.maxLines}.`,
		);
	} else if (info.truncatedBy === "bytes") {
		parts.push(
			`Output truncated: ${formatBytes(info.totalBytes)} exceeded limit of ${formatBytes(config.maxBytes)}.`,
		);
	}

	if (info.fullOutputPath) {
		parts.push(`Full output saved to: ${info.fullOutputPath}`);
		parts.push(`Use the read tool to view the full output.`);
	}

	return parts.join(" ");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
