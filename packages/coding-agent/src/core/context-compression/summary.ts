/**
 * L3: Zero-cost Structured Summary
 *
 * Extracts structured, compact notes from tool results without LLM calls.
 * Uses pattern-based extraction tailored to each tool type.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { DEFAULT_SUMMARY_CONFIG, type StructuredNote, type SummaryConfig, type SummaryResult } from "./types.js";

// ============================================================================
// Markers
// ============================================================================

const SUMMARY_MARKER = "[summarized]";

// ============================================================================
// Token estimation
// ============================================================================

function estimateTokens(messages: AgentMessage[]): number {
	let chars = 0;
	for (const msg of messages) {
		if (msg.role === "user") {
			const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
			if (typeof content === "string") chars += content.length;
			else if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "text" && block.text) chars += block.text.length;
				}
			}
		} else if (msg.role === "assistant") {
			const blocks = (
				msg as unknown as { content?: Array<{ type?: string; text?: string; arguments?: string; name?: string }> }
			).content;
			if (Array.isArray(blocks)) {
				for (const block of blocks) {
					if (block.type === "text" && block.text) chars += block.text.length;
					else if (block.type === "toolCall" && block.arguments) chars += block.arguments.length;
					else if (block.type === "thinking" && (block as { thinking?: string }).thinking)
						chars += ((block as { thinking?: string }).thinking ?? "").length;
				}
			}
		} else if (msg.role === "toolResult" || (msg.role as string) === "tool") {
			const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
			if (typeof content === "string") chars += content.length;
			else if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "text" && block.text) chars += block.text.length;
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

// ============================================================================
// Content extraction helpers
// ============================================================================

function extractTextContent(msg: AgentMessage): string | null {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
	if (typeof content === "string") {
		if (content.startsWith(SUMMARY_MARKER)) return null;
		return content;
	}
	if (Array.isArray(content)) {
		const textParts = content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
		if (textParts.length > 0) {
			const joined = textParts.join("\n");
			if (joined.startsWith(SUMMARY_MARKER)) return null;
			return joined;
		}
	}
	return null;
}

function truncateLine(line: string, maxLen: number): string {
	if (line.length <= maxLen) return line;
	return line.slice(0, maxLen - 3) + "...";
}

// ============================================================================
// Tool-specific extractors
// ============================================================================

type ExtractorFn = (toolName: string, content: string, config: SummaryConfig) => StructuredNote;

function extractReadContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n");
	const lineCount = lines.length;

	const metadata: Record<string, string> = {
		lines: String(lineCount),
		size: formatSize(Buffer.byteLength(content, "utf-8")),
	};

	// Detect language from imports/shebangs
	const firstLine = lines[0] || "";
	if (firstLine.startsWith("#!/")) metadata.shebang = truncateLine(firstLine, config.truncateLine);
	if (firstLine.includes("import ") || firstLine.includes("require(")) metadata.language = detectLanguage(firstLine);

	// Sample: first N/2 and last N/2 lines
	const sampleCount = Math.min(config.maxLines, lineCount);
	const headCount = Math.ceil(sampleCount / 2);
	const tailCount = Math.min(sampleCount - headCount, lineCount - headCount);
	const samples: string[] = [];

	for (let i = 0; i < headCount && i < lineCount; i++) {
		samples.push(truncateLine(lines[i], config.truncateLine));
	}
	if (headCount < lineCount - tailCount && samples.length + tailCount + 1 <= config.maxLines) {
		samples.push(`... (${lineCount - headCount - tailCount} more lines) ...`);
	}
	for (let i = Math.max(headCount, lineCount - tailCount); i < lineCount; i++) {
		if (samples.length >= config.maxLines) break;
		samples.push(truncateLine(lines[i], config.truncateLine));
	}

	const headline = `read: ${lineCount} lines, ${metadata.size}`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

function extractGrepContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n").filter((l) => l.trim());
	const matchCount = lines.length;

	// Extract unique file paths
	const files = new Set<string>();
	for (const line of lines) {
		const match = line.match(/^([^:]+):/);
		if (match) files.add(match[1]);
	}

	const metadata: Record<string, string> = {
		matches: String(matchCount),
		files: String(files.size),
	};

	// Show unique file list + sample matches
	const samples: string[] = [];
	if (files.size > 0) {
		samples.push(
			`Files: ${Array.from(files).slice(0, 10).join(", ")}${files.size > 10 ? ` (+${files.size - 10} more)` : ""}`,
		);
	}
	const remainingSlots = config.maxLines - samples.length;
	const sampleLines = lines.slice(0, Math.min(remainingSlots > 0 ? remainingSlots : 0, lines.length));
	for (const line of sampleLines) {
		samples.push(truncateLine(line, config.truncateLine));
	}
	if (lines.length > sampleLines.length && samples.length < config.maxLines) {
		samples.push(`... (+${lines.length - sampleLines.length} more matches)`);
	}

	const headline = `grep: ${matchCount} matches across ${files.size} file(s)`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

function extractBashContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n").filter((l) => l.trim());
	const lineCount = lines.length;

	const metadata: Record<string, string> = {
		lines: String(lineCount),
		size: formatSize(Buffer.byteLength(content, "utf-8")),
	};

	// Detect error indicators
	const hasError = lines.some(
		(l) =>
			l.toLowerCase().includes("error") ||
			l.toLowerCase().includes("failed") ||
			l.includes("ERR ") ||
			l.includes("exit code"),
	);
	if (hasError) metadata.status = "has errors";

	// Detect success indicators
	const hasSuccess = lines.some((l) => l.toLowerCase().includes("success") || l.toLowerCase().includes("done"));
	if (hasSuccess && !hasError) metadata.status = "success";

	// Samples: first few and last few
	const samples: string[] = [];
	const headCount = Math.min(Math.ceil(config.maxLines / 2), lineCount);
	const tailCount = Math.min(Math.floor(config.maxLines / 2), lineCount - headCount);

	for (let i = 0; i < headCount; i++) {
		samples.push(truncateLine(lines[i], config.truncateLine));
	}
	if (tailCount > 0 && headCount < lineCount - tailCount && samples.length + tailCount + 1 <= config.maxLines) {
		samples.push(`... (${lineCount - headCount - tailCount} more lines) ...`);
	}
	for (let i = lineCount - tailCount; i < lineCount; i++) {
		if (samples.length >= config.maxLines) break;
		samples.push(truncateLine(lines[i], config.truncateLine));
	}

	const headline = `bash: ${lineCount} lines, ${metadata.size}${hasError ? " [ERRORS]" : ""}`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

function extractGlobContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n").filter((l) => l.trim());
	const count = lines.length;

	// Categorize by extension
	const extMap = new Map<string, number>();
	for (const line of lines) {
		const ext = line.includes(".") ? "." + line.split(".").pop() : "(no ext)";
		extMap.set(ext, (extMap.get(ext) || 0) + 1);
	}

	const metadata: Record<string, string> = {
		count: String(count),
	};

	// Top extensions
	const sortedExts = Array.from(extMap.entries()).sort((a, b) => b[1] - a[1]);
	if (sortedExts.length > 0) {
		metadata.types = sortedExts
			.slice(0, 5)
			.map(([ext, c]) => `${ext}: ${c}`)
			.join(", ");
	}

	// Sample files
	const samples: string[] = [];
	const sampleCount = Math.min(config.maxLines, count);
	for (let i = 0; i < sampleCount; i++) {
		samples.push(lines[i]);
	}
	if (count > sampleCount) {
		samples.push(`... (+${count - sampleCount} more files)`);
	}

	const headline = `glob/find: ${count} files`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

function extractGitLogContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n").filter((l) => l.trim());
	const commitCount = lines.length;

	// Extract commit hashes and subjects
	const commits: string[] = [];
	for (const line of lines) {
		const match = line.match(/^([a-f0-9]{6,})\s+(.+)/);
		if (match) commits.push(`${match[1]} ${match[2].slice(0, 80)}`);
		else if (line.trim()) commits.push(truncateLine(line, config.truncateLine));
	}

	const metadata: Record<string, string> = {
		commits: String(commitCount),
	};

	const samples = commits.slice(0, config.maxLines);
	if (commits.length > config.maxLines) {
		samples.push(`... (+${commits.length - config.maxLines} more commits)`);
	}

	const headline = `git_log: ${commitCount} commits`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

function extractGitDiffContent(_toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n");

	// Count stats
	let additions = 0;
	let deletions = 0;
	const filesChanged = new Set<string>();

	for (const line of lines) {
		if (line.startsWith("+") && !line.startsWith("++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("--")) deletions++;
		const fileMatch = line.match(/^diff --git .+ b\/(.+)$/);
		if (fileMatch) filesChanged.add(fileMatch[1]);
	}

	const metadata: Record<string, string> = {
		files: String(filesChanged.size),
		additions: String(additions),
		deletions: String(deletions),
	};

	// Show file list + sample diff context
	const samples: string[] = [];
	if (filesChanged.size > 0) {
		samples.push(`Files: ${Array.from(filesChanged).join(", ")}`);
	}
	samples.push(`+${additions} / -${deletions} lines`);

	// Add a few sample changed lines
	const ctxLines = lines.filter(
		(l) =>
			l.startsWith("@@") || (l.startsWith("+") && !l.startsWith("++")) || (l.startsWith("-") && !l.startsWith("--")),
	);
	const remaining = config.maxLines - samples.length;
	for (let i = 0; i < Math.min(remaining, ctxLines.length); i++) {
		samples.push(truncateLine(ctxLines[i], config.truncateLine));
	}
	if (ctxLines.length > remaining && remaining > 0) {
		samples.push(`... (+${ctxLines.length - remaining} more changed lines)`);
	}

	const headline = `git_diff: ${filesChanged.size} file(s), +${additions}/-${deletions}`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

/** Generic fallback extractor for unknown tool types */
function extractGenericContent(toolName: string, content: string, config: SummaryConfig): StructuredNote {
	const lines = content.split("\n");
	const lineCount = lines.length;

	const metadata: Record<string, string> = {
		lines: String(lineCount),
		size: formatSize(Buffer.byteLength(content, "utf-8")),
	};

	const sampleCount = Math.min(config.maxLines, lineCount);
	const headCount = Math.ceil(sampleCount / 2);
	const tailCount = Math.min(sampleCount - headCount, lineCount - headCount);
	const samples: string[] = [];

	for (let i = 0; i < headCount; i++) {
		samples.push(truncateLine(lines[i], config.truncateLine));
	}
	if (headCount < lineCount - tailCount && samples.length + tailCount + 1 <= config.maxLines) {
		samples.push(`... (${lineCount - headCount - tailCount} more lines) ...`);
	}
	for (let i = Math.max(headCount, lineCount - tailCount); i < lineCount; i++) {
		if (samples.length >= config.maxLines) break;
		samples.push(truncateLine(lines[i], config.truncateLine));
	}

	const headline = `${toolName}: ${lineCount} lines, ${metadata.size}`;
	const formatted = formatNote(headline, metadata, samples);

	return { headline, metadata, samples, originalSize: Buffer.byteLength(content, "utf-8"), formatted };
}

// ============================================================================
// Tool → Extractor routing
// ============================================================================

const EXTRACTORS: Record<string, ExtractorFn> = {
	read: extractReadContent,
	cat: extractReadContent,
	view: extractReadContent,
	grep: extractGrepContent,
	bash: extractBashContent,
	sh: extractBashContent,
	glob: extractGlobContent,
	find: extractGlobContent,
	git_log: extractGitLogContent,
	git_diff: extractGitDiffContent,
};

function getExtractor(toolName: string): ExtractorFn {
	const lower = toolName.toLowerCase();
	// Check exact match first
	if (EXTRACTORS[lower]) return EXTRACTORS[lower];
	// Check prefix match (e.g., "git_status" -> "git_log" pattern)
	for (const [key, fn] of Object.entries(EXTRACTORS)) {
		if (lower.startsWith(key) || lower.includes(key)) return fn;
	}
	return extractGenericContent;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Summarize a single tool result into a structured note.
 */
export function summarizeToolResult(
	toolName: string,
	content: string,
	config: SummaryConfig = DEFAULT_SUMMARY_CONFIG,
): StructuredNote {
	if (!content || !content.trim()) {
		return {
			headline: `${toolName}: empty result`,
			metadata: { size: "0B" },
			samples: [],
			originalSize: 0,
			formatted: `${SUMMARY_MARKER} [${toolName}] (empty)`,
		};
	}

	const extractor = getExtractor(toolName);
	const note = extractor(toolName, content, config);

	// If content is already small enough, produce minimal note (headline + metadata only)
	if (note.formatted.length >= content.length) {
		return {
			...note,
			formatted: `${SUMMARY_MARKER} [${toolName}] ${note.headline.replace(`${toolName}: `, "")}`,
			samples: [],
		};
	}

	return note;
}

/**
 * Apply zero-cost summarization to all tool results in a message list.
 */
export async function applySummary(
	messages: AgentMessage[],
	config: SummaryConfig = DEFAULT_SUMMARY_CONFIG,
): Promise<SummaryResult> {
	if (!config.enabled) {
		return {
			messages,
			summarizedCount: 0,
			tokensBefore: estimateTokens(messages),
			tokensAfter: estimateTokens(messages),
		};
	}

	const tokensBefore = estimateTokens(messages);
	let summarizedCount = 0;

	const modifiedMessages = messages.map((msg) => {
		if (msg.role !== "toolResult" && (msg.role as string) !== "tool") return msg;

		const content = extractTextContent(msg);
		if (content === null) return msg; // Already summarized or non-text

		const toolName = (msg as unknown as { toolName?: string }).toolName ?? "unknown";
		const note = summarizeToolResult(toolName, content, config);

		// Only replace if the summary is actually smaller
		if (note.formatted.length >= content.length) return msg;

		summarizedCount++;

		// Preserve image blocks — images are never summarized
		const msgContent = (msg as unknown as { content?: Array<{ type?: string; [key: string]: unknown }> }).content;
		const imageParts = Array.isArray(msgContent) ? msgContent.filter((p) => p.type === "image") : [];

		return {
			...msg,
			content: [{ type: "text", text: note.formatted }, ...imageParts],
		} as unknown as AgentMessage;
	});

	const tokensAfter = estimateTokens(modifiedMessages);

	return {
		messages: modifiedMessages,
		summarizedCount,
		tokensBefore,
		tokensAfter,
	};
}

// ============================================================================
// Helpers
// ============================================================================

function formatNote(headline: string, metadata: Record<string, string>, samples: string[]): string {
	const parts = [`${SUMMARY_MARKER} ${headline}`];

	const metaEntries = Object.entries(metadata);
	if (metaEntries.length > 0) {
		parts.push(`  { ${metaEntries.map(([k, v]) => `${k}: ${v}`).join(", ")} }`);
	}

	if (samples.length > 0) {
		parts.push(...samples.map((s) => `  ${s}`));
	}

	return parts.join("\n");
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function detectLanguage(firstLine: string): string {
	if (firstLine.includes("from '") || firstLine.includes('from "')) return "python";
	if (firstLine.includes("import ") && firstLine.includes("from")) return "typescript";
	if (firstLine.includes("require(")) return "node/commonjs";
	if (firstLine.includes("<!DOCTYPE") || firstLine.includes("<html")) return "html";
	if (firstLine.includes("{") || firstLine.includes("package")) return "json";
	return "unknown";
}
