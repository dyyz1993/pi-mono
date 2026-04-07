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
	DEFAULT_KEEP_RECENT,
	DEFAULT_LIFECYCLE_CONFIG,
	DEFAULT_STALE_MINUTES,
	ToolPriority,
	type LifecycleConfig,
	type LifecycleResult,
	type ToolResultEntry,
} from "./types.js";

// ============================================================================
// Token estimation (simple char/4 heuristic)
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
						chars += (block as { thinking?: string }).thinking.length;
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
// Stub/cleared content templates
// ============================================================================

const CLEARED_MARKER = "[cleared]";
const STUB_PREFIX = "[degraded]";

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
	const entries = extractToolResults(messages);

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

function extractToolResults(messages: AgentMessage[]): IndexedEntry[] {
	const entries: IndexedEntry[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;

		const content = extractTextContent(msg);
		if (content === null) continue;

		const toolName = (msg as unknown as { toolName?: string }).toolName ?? "unknown";
		const timestamp = (msg as unknown as { timestamp?: number })?.timestamp ?? Date.now();
		const size = Buffer.byteLength(content, "utf-8");

		entries.push({
			id: `${i}-${toolName}`,
			toolName: toolName.toLowerCase(),
			content,
			contentSize: size,
			timestamp,
			priority: ToolPriority.DISCARDABLE, // Set default; resolved in applyCountRule
			level: "full",
			messageIndex: i,
		});
	}

	return entries;
}

function extractTextContent(msg: AgentMessage): string | null {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textParts = content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
		if (textParts.length > 0) return textParts.join("\n");
	}
	return null;
}

// ============================================================================
// L2: Time-based clearing
// ============================================================================

function applyTimeRule(entries: IndexedEntry[], config: LifecycleConfig): IndexedEntry[] {
	const staleMs = config.staleMinutes * 60 * 1000;
	const now = Date.now();

	for (const entry of entries) {
		if (entry.level !== "full") continue; // Already processed

		const age = now - entry.timestamp;
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
	// This prevents unbounded growth
	const clearThreshold = keepRecent * 2;
	if (fullEntries.length > clearThreshold) {
		// Sort by timestamp ascending (oldest first)
		fullEntries.sort((a, b) => a.timestamp - b.timestamp);
		const numToClear = fullEntries.length - keepRecent;
		for (let i = 0; i < numToClear; i++) {
			fullEntries[i].level = "cleared";
		}
		return entries;
	}

	// Normal priority-based selection
	let remainingSlots = keepRecent;
	const keptCritical = critical.slice(-remainingSlots);
	remainingSlots -= keptCritical.length;
	const keptImportant = important.slice(0, remainingSlots > 0 ? Math.min(important.length, remainingSlots) : 0);
	remainingSlots -= keptImportant.length;
	const keptDiscardable = discardable.slice(0, remainingSlots > 0 ? Math.min(discardable.length, remainingSlots) : 0);

	// Mark non-kept entries for degradation
	const keptSet = new Set([...keptCritical, ...keptImportant, ...keptDiscardable]);

	for (const entry of entries) {
		if (entry.level !== "full") continue; // Skip already-processed
		if (!keptSet.has(entry)) {
			entry.level = "stub";
		}
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
		let entry = entryMap.get(`${idx}-${(msg as unknown as { toolName?: string }).toolName ?? ""}`);
		if (!entry) {
			// Fallback: find by scanning
			entry = entries.find((e) => e.messageIndex === idx);
		}

		if (!entry || entry.level === "full") return msg;

		// Modify the message content based on degradation level
		if (entry.level === "cleared") {
			return {
				...msg,
				content: [{ type: "text", text: `${CLEARED_MARKER} [${entry.toolName}]` }],
			} as AgentMessage;
		}

		// level === "stub"
		return {
			...msg,
			content: [{ type: "text", text: createDegradedStub(entry) }],
		} as AgentMessage;
	});
}

// ============================================================================
// Helpers
// ============================================================================

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB}`;
}
