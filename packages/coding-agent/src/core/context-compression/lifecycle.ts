/**
 * L1 + L2: Tool Result Lifecycle Management
 *
 * Manages the lifecycle of tool results in the conversation context:
 * - L1: Keep recent N results, degrade older ones to stubs, clear far-old ones
 * - L2: Clear results that exceed a time threshold (stale)
 *
 * Rules are applied in order: time-based clearing → count-based degradation
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
	DEFAULT_LIFECYCLE_CONFIG,
	type LifecycleConfig,
	type LifecycleResult,
	ToolPriority,
	type ToolResultEntry,
} from "./types.js";

// ============================================================================
// Token estimation (simple char/4 heuristic)
// ============================================================================

export function estimateTokens(messages: AgentMessage[]): number {
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
		} else if (msg.role === "toolResult") {
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
// Tool priority lookup
// ============================================================================

function getToolPriority(toolName: string, config: LifecycleConfig): ToolPriority {
	const lower = toolName.toLowerCase();
	if (config.toolPriority[lower] !== undefined) return config.toolPriority[lower];
	if (lower.includes("write") || lower.includes("edit") || lower.includes("create") || lower.includes("delete"))
		return ToolPriority.CRITICAL;
	if (lower.includes("read") || lower.includes("grep") || lower.includes("glob") || lower.includes("find"))
		return ToolPriority.IMPORTANT;
	return ToolPriority.DISCARDABLE;
}

// ============================================================================
// Content-aware priority adjustment
// ============================================================================

/** Patterns that indicate CRITICAL content (must preserve at all costs) */
const CRITICAL_PATTERNS: RegExp[] = [
	// Error/exception stack traces
	/^Error:/m,
	/^TypeError:/m,
	/^ReferenceError:/m,
	/^SyntaxError:/m,
	/^RangeError:/m,
	/\b(at\s+.*?)(\(\d+:\d+\))/m,
	// Git conflicts
	/<<<<<<<\s*HEAD/m,
	/>>>>>>>/m,
	// Security issues — narrowed to actual credential exposures, not keyword mentions
	/password\s*[:=]/i,
	/secret\s*[:=]/i,
	/(?:api[_-]?|auth[_-]?)?token\s*[:=]/i,
	/bearer\s+[A-Za-z0-9._-]{20,}/i,
	/AUTHORIZATION/i,
];

/** Patterns that indicate IMPORTANT content (should preserve but not as aggressively) */
const IMPORTANT_PATTERNS: RegExp[] = [
	// Test failures
	/FAIL\s+\d+/,
	/failed.*\d+\s*(passed|tests?)/i,
	/Exit code:\s*[1-9]/,
];

/** Patterns that indicate low-value content (safe to aggressively compress) */
const LOW_VALUE_PATTERNS: RegExp[] = [
	// Build success
	/Built in \d+(\.\d+)?s$/m,
	/Done\.?\s*$/m,
	/Output size:/m,
	// File listings (many short lines with paths)
	/^[\w/.]+\n[\w/.]+\n[\w/.]+$/m,
	// Debug/log noise
	/^\[DEBUG\]/m,
	/^\[INFO\]/m,
	/^\[VERBOSE\]/m,
	/^\[WARN\].*Slow query/m,
	/^\[TRACE\]/m,
	// Pure whitespace or near-empty
	/^\s*$/,
];

/**
 * Adjust tool priority based on actual content analysis.
 * A bash result containing an error gets boosted to CRITICAL.
 * A bash result that's just a file listing stays DISCARDABLE.
 */
export function adjustPriorityByContent(toolName: string, content: string): ToolPriority {
	const basePriority = getToolPriority(toolName, DEFAULT_LIFECYCLE_CONFIG);

	// CRITICAL tools by name are always CRITICAL regardless of content
	if (basePriority === ToolPriority.CRITICAL) return ToolPriority.CRITICAL;

	const trimmed = content.trim();
	if (!trimmed || trimmed.length < 10) return basePriority;

	// Check for CRITICAL patterns → boost to CRITICAL
	for (const pattern of CRITICAL_PATTERNS) {
		if (pattern.test(trimmed)) return ToolPriority.CRITICAL;
	}

	// Check for IMPORTANT patterns → boost to IMPORTANT (but not above CRITICAL)
	for (const pattern of IMPORTANT_PATTERNS) {
		if (pattern.test(trimmed)) return ToolPriority.IMPORTANT;
	}

	// Check for low-value patterns → downgrade to DISCARDABLE
	for (const pattern of LOW_VALUE_PATTERNS) {
		if (pattern.test(trimmed)) return ToolPriority.DISCARDABLE;
	}

	// Heuristic: if content has many repeated similar lines (grep-style dump),
	// and no errors, it's likely low-value
	const lines = trimmed.split("\n");
	if (lines.length > 30) {
		const sample = Math.min(5, lines.length);
		const uniquePrefixes = new Set<string>();
		for (let i = 0; i < sample; i++) {
			const prefix = lines[i].split(":")[0]?.split("/").pop() ?? "";
			if (prefix) uniquePrefixes.add(prefix);
		}
		// If most lines share same file extension pattern → likely grep/file listing
		if (uniquePrefixes.size <= 2 && lines.length > 50) return ToolPriority.DISCARDABLE;
		// If many lines all match file:line:content pattern → likely grep dump
		const grepLikeCount = lines.filter((l) => /^\S+:\d+/.test(l)).length;
		if (grepLikeCount > 20 && lines.length > 30) return ToolPriority.DISCARDABLE;
	}

	return basePriority;
}

const CLEARED_MARKER = "[cleared]";
const STUB_PREFIX = "[degraded]";
const PERSISTED_MARKER = "output saved to disk";

function createDegradedStub(entry: ToolResultEntry): string {
	return `${STUB_PREFIX} [${entry.toolName}] (${formatSize(entry.contentSize)})`;
}

// ============================================================================
// Core: applyLifecycle
// ============================================================================

/**
 * Apply lifecycle rules to a list of messages.
 * Returns modified messages with degraded/cleared tool results.
 */
export async function applyLifecycle(
	messages: AgentMessage[],
	config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): Promise<LifecycleResult> {
	if (!config.enabled) {
		return {
			messages,
			degradedCount: 0,
			clearedCount: 0,
			tokensBefore: estimateTokens(messages),
			tokensAfter: estimateTokens(messages),
		};
	}

	const tokensBefore = estimateTokens(messages);

	// Step 1: Extract tool result entries with metadata
	const entries = extractToolResults(messages, config);

	// Step 2: Apply L2 - clear stale results
	const afterTimeRule = applyTimeRule(entries, config);

	// Step 3: Apply L1 - degrade excess results by count and priority
	const afterCountRule = applyCountRule(afterTimeRule, config);

	// Step 4: Rebuild messages with modifications
	const modifiedMessages = rebuildMessages(messages, afterCountRule);

	const tokensAfter = estimateTokens(modifiedMessages);

	return {
		messages: modifiedMessages,
		degradedCount: afterCountRule.filter((e) => e.level === "stub").length,
		clearedCount: afterCountRule.filter((e) => e.level === "cleared").length,
		tokensBefore,
		tokensAfter,
	};
}

// ============================================================================
// Extraction: identify tool results in message stream
// ============================================================================

interface IndexedEntry extends ToolResultEntry {
	messageIndex: number;
}

function extractToolResults(messages: AgentMessage[], _config: LifecycleConfig): IndexedEntry[] {
	const entries: IndexedEntry[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;

		const content = extractTextContent(msg);
		if (content === null) continue;

		const toolName = (msg as unknown as { toolName?: string }).toolName ?? "unknown";
		const timestamp = (msg as unknown as { timestamp?: number })?.timestamp ?? Date.now();
		const size = Buffer.byteLength(content, "utf-8");
		// Resolve priority here so clearThreshold path can use it
		const resolvedPriority = adjustPriorityByContent(toolName, content);

		entries.push({
			id: `${i}-${toolName}`,
			toolName: toolName.toLowerCase(),
			content,
			contentSize: size,
			timestamp,
			priority: resolvedPriority,
			level: "full",
			messageIndex: i,
		});
	}

	return entries;
}

function extractTextContent(msg: AgentMessage): string | null {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
	if (typeof content === "string") {
		if (content.startsWith(CLEARED_MARKER) || content.startsWith(STUB_PREFIX) || content.includes(PERSISTED_MARKER))
			return null;
		return content;
	}
	if (Array.isArray(content)) {
		const textParts = content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
		if (textParts.length > 0) {
			const joined = textParts.join("\n");
			if (joined.startsWith(CLEARED_MARKER) || joined.startsWith(STUB_PREFIX) || joined.includes(PERSISTED_MARKER))
				return null;
			return joined;
		}
	}
	return null;
}

/** Extract image content blocks from a message — preserved across compression */
function extractImageParts(msg: AgentMessage): Array<{ type: "image"; [key: string]: unknown }> {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; [key: string]: unknown }> }).content;
	if (!Array.isArray(content)) return [];
	return content.filter((p) => p.type === "image") as Array<{ type: "image"; [key: string]: unknown }>;
}

// ============================================================================
// L2: Time-based clearing
// ============================================================================

function applyTimeRule(entries: IndexedEntry[], config: LifecycleConfig): IndexedEntry[] {
	const staleMs = config.staleMinutes * 60 * 1000;
	const now = Date.now();

	for (const entry of entries) {
		if (entry.level !== "full") continue; // Already processed

		const ts = entry.timestamp;
		// M5: Guard against invalid timestamps — 0/NaN/negative/far-future all treated as "fresh"
		if (!Number.isFinite(ts) || ts <= 0 || ts > now + 3_600_000) continue;

		const age = now - ts;
		if (age >= staleMs) {
			entry.level = "cleared";
		}
	}

	return entries;
}

// ============================================================================
// L1: Count-based degradation with priority awareness
// ============================================================================

function applyCountRule(entries: IndexedEntry[], config: LifecycleConfig): IndexedEntry[] {
	// Separate full (not yet processed) entries by priority
	const critical: IndexedEntry[] = [];
	const important: IndexedEntry[] = [];
	const discardable: IndexedEntry[] = [];

	for (const entry of entries) {
		if (entry.level !== "full") continue; // Skip already-cleared/stub entries
		switch (entry.priority) {
			case ToolPriority.CRITICAL:
				critical.push(entry);
				break;
			case ToolPriority.IMPORTANT:
				important.push(entry);
				break;
			default:
				discardable.push(entry);
				break;
		}
	}

	// Calculate how many slots we have for keeping results
	const keepRecent = config.keepRecent;
	const fullEntries = entries.filter((e) => e.level === "full");

	// If we have WAY more than keepRecent * 2, clear the oldest entirely (not just stub)
	// This prevents unbounded growth. CRITICAL priority tools are always protected.
	const clearThreshold = keepRecent * 2;
	if (fullEntries.length > clearThreshold) {
		// Sort by timestamp ascending (oldest first)
		fullEntries.sort((a, b) => a.timestamp - b.timestamp);
		let numToClear = fullEntries.length - keepRecent;
		for (let i = 0; i < fullEntries.length && numToClear > 0; i++) {
			if (fullEntries[i].priority === ToolPriority.CRITICAL) continue;
			fullEntries[i].level = "cleared";
			numToClear--;
		}
		return entries;
	}

	// Normal priority-based selection — always keep most recent entries
	let remainingSlots = keepRecent;
	const keptCritical = critical.slice(-remainingSlots);
	remainingSlots -= keptCritical.length;
	const keptImportant = remainingSlots > 0 ? important.slice(-Math.min(important.length, remainingSlots)) : [];
	remainingSlots -= keptImportant.length;
	const keptDiscardable = remainingSlots > 0 ? discardable.slice(-Math.min(discardable.length, remainingSlots)) : [];

	// Mark non-kept entries for degradation
	const keptSet = new Set([...keptCritical, ...keptImportant, ...keptDiscardable]);

	for (const entry of entries) {
		if (entry.level !== "full") continue; // Skip already-processed
		if (!keptSet.has(entry)) {
			entry.level = "stub";
		}
	}

	return entries;
}

// ============================================================================
// Rebuild message array with modifications
// ============================================================================

function rebuildMessages(originalMessages: AgentMessage[], entries: IndexedEntry[]): AgentMessage[] {
	const entryMap = new Map(entries.map((e) => [e.id, e]));

	return originalMessages.map((msg, idx) => {
		if (msg.role !== "toolResult") return msg;

		// Find matching entry
		const content = extractTextContent(msg);
		if (content === null) return msg;

		// Try to find by index-based ID or by position
		let entry = entryMap.get(`${idx}-${((msg as unknown as { toolName?: string }).toolName ?? "").toLowerCase()}`);
		if (!entry) {
			// Fallback: find by scanning
			entry = entries.find((e) => e.messageIndex === idx);
		}

		if (!entry || entry.level === "full") return msg;

		// Preserve image blocks across compression — images are never degraded
		const imageParts = extractImageParts(msg);

		// Modify the message content based on degradation level
		if (entry.level === "cleared") {
			return {
				...msg,
				content: [{ type: "text", text: `${CLEARED_MARKER} [${entry.toolName}]` }, ...imageParts],
			} as unknown as AgentMessage;
		}

		// level === "stub"
		return {
			...msg,
			content: [{ type: "text", text: createDegradedStub(entry) }, ...imageParts],
		} as unknown as AgentMessage;
	});
}

// ============================================================================
// Helpers
// ============================================================================

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
