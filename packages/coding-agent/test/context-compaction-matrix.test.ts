import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS, estimateContextTokens, prepareCompaction } from "../src/core/compaction/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";

type Feature = "compaction" | "plugin" | "segment" | "delete" | "rollback" | "thinking";

const FEATURE_ORDER: Feature[] = ["compaction", "plugin", "segment", "delete", "rollback", "thinking"];

function repeatMarker(marker: string, count = 24): string {
	return Array.from({ length: count }, (_, index) => `${marker}_${index}`).join(" ");
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMessage(text: string, extraContent: AssistantMessage["content"] = []): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }, ...extraContent],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function assistantToolCall(toolCallId: string, text: string): AssistantMessage {
	return {
		...assistantMessage(text),
		content: [
			{ type: "text", text },
			{ type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "printf hidden" } },
		],
		stopReason: "toolUse",
	};
}

function toolResult(toolCallId: string, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function extractText(messages: AgentMessage[]): string {
	return messages
		.map((message) => {
			switch (message.role) {
				case "user":
				case "custom":
				case "toolResult":
					return typeof message.content === "string"
						? message.content
						: message.content
								.filter((block): block is { type: "text"; text: string } => block.type === "text")
								.map((block) => block.text)
								.join(" ");
				case "assistant":
					return message.content
						.map((block) => {
							if (block.type === "text") return block.text;
							if (block.type === "thinking") return block.thinking;
							if (block.type === "toolCall") return `${block.name} ${JSON.stringify(block.arguments)}`;
							return "";
						})
						.join(" ");
				case "branchSummary":
				case "compactionSummary":
					return message.summary;
				case "bashExecution":
					return `${message.command}\n${message.output}`;
				default:
					return "";
			}
		})
		.join("\n");
}

function rawMessagesFromEntries(manager: SessionManager): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of manager.getEntries()) {
		if (entry.type === "message") messages.push(entry.message);
		if (entry.type === "custom_message") {
			messages.push({
				role: "custom",
				content: entry.content,
				customType: entry.customType,
				display: entry.display,
				details: entry.details,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		}
		if (entry.type === "branch_summary") {
			messages.push({
				role: "branchSummary",
				summary: entry.summary,
				fromId: entry.fromId,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		}
		if (entry.type === "compaction") {
			messages.push({
				role: "compactionSummary",
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		}
	}
	return messages;
}

function addCompactionFeature(manager: SessionManager): void {
	const keptUserId = manager.appendMessage(userMessage(repeatMarker("COMPACTION_KEPT_USER")));
	manager.appendMessage(assistantMessage(repeatMarker("COMPACTION_KEPT_ASSISTANT")));
	manager.appendCompaction("COMPACTION_SUMMARY_VISIBLE", keptUserId, 9000);
}

function addPluginFeature(manager: SessionManager): void {
	manager.appendCustomMessageEntry("matrix-plugin", repeatMarker("PLUGIN_VISIBLE"), false, {
		source: "context-compaction-matrix",
	});
}

function addSegmentFeature(manager: SessionManager): void {
	const userId = manager.appendMessage(userMessage(repeatMarker("SEGMENT_OLD_USER_HIDDEN")));
	const assistantId = manager.appendMessage(assistantMessage(repeatMarker("SEGMENT_OLD_ASSISTANT_HIDDEN")));
	manager.appendSegmentSummary([userId, assistantId], "SEGMENT_SUMMARY_VISIBLE");
}

function addDeleteFeature(manager: SessionManager): void {
	const toolCallId = "delete-tool-call";
	const assistantId = manager.appendMessage(assistantToolCall(toolCallId, repeatMarker("DELETE_ASSISTANT_HIDDEN")));
	manager.appendMessage(toolResult(toolCallId, repeatMarker("DELETE_TOOL_RESULT_HIDDEN")));
	manager.appendDeletion([assistantId]);
}

function addRollbackFeature(manager: SessionManager): void {
	const branchPointId = manager.appendMessage(userMessage(repeatMarker("ROLLBACK_COMMON_VISIBLE")));
	manager.appendMessage(userMessage(repeatMarker("ROLLBACK_ABANDONED_HIDDEN")));
	manager.appendMessage(assistantMessage(repeatMarker("ROLLBACK_ABANDONED_ASSISTANT_HIDDEN")));
	manager.branch(branchPointId);
	manager.appendMessage(userMessage(repeatMarker("ROLLBACK_ACTIVE_VISIBLE")));
}

function addThinkingFeature(manager: SessionManager): void {
	manager.appendMessage(
		assistantMessage("THINKING_VISIBLE_TEXT", [
			{ type: "thinking", thinking: repeatMarker("THINKING_PRIVATE_HIDDEN_FROM_COMPACTION") },
		]),
	);
}

function addFeature(manager: SessionManager, feature: Feature): void {
	switch (feature) {
		case "compaction":
			addCompactionFeature(manager);
			break;
		case "plugin":
			addPluginFeature(manager);
			break;
		case "segment":
			addSegmentFeature(manager);
			break;
		case "delete":
			addDeleteFeature(manager);
			break;
		case "rollback":
			addRollbackFeature(manager);
			break;
		case "thinking":
			addThinkingFeature(manager);
			break;
	}
}

function createFixture(features: Feature[]): SessionManager {
	const manager = SessionManager.inMemory("/tmp/pi-context-compaction-matrix");
	for (const feature of FEATURE_ORDER) {
		if (features.includes(feature)) addFeature(manager, feature);
	}
	manager.appendMessage(userMessage(repeatMarker("TAIL_RECENT_USER")));
	manager.appendMessage(assistantMessage(repeatMarker("TAIL_RECENT_ASSISTANT", 36)));
	return manager;
}

function assertIncludes(text: string, markers: string[]): void {
	for (const marker of markers) {
		expect(text, `expected ${marker}`).toContain(marker);
	}
}

function assertExcludes(text: string, markers: string[]): void {
	for (const marker of markers) {
		expect(text, `unexpected ${marker}`).not.toContain(marker);
	}
}

function evaluate(features: Feature[]) {
	const manager = createFixture(features);
	const branch = manager.getBranch();
	const chatContext = manager.buildSessionContext();
	const chatText = extractText(chatContext.messages);
	const preparation = prepareCompaction(branch, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 40 });
	expect(preparation).toBeDefined();
	const compactText = extractText([...preparation!.messagesToSummarize, ...preparation!.turnPrefixMessages]);
	const rawTokens = estimateContextTokens(rawMessagesFromEntries(manager)).tokens;
	const chatTokens = estimateContextTokens(chatContext.messages).tokens;
	const compactTokens = preparation!.tokensBefore;
	return { manager, preparation: preparation!, chatText, compactText, rawTokens, chatTokens, compactTokens };
}

function assertFeatureSemantics(features: Feature[]): void {
	const result = evaluate(features);
	const chatPresent: string[] = ["TAIL_RECENT_USER", "TAIL_RECENT_ASSISTANT"];
	const compactPresent: string[] = ["TAIL_RECENT_USER"];
	const commonAbsent: string[] = [];

	if (features.includes("plugin")) {
		chatPresent.push("PLUGIN_VISIBLE");
		compactPresent.push("PLUGIN_VISIBLE");
	}
	if (features.includes("segment")) {
		chatPresent.push("SEGMENT_SUMMARY_VISIBLE");
		compactPresent.push("SEGMENT_SUMMARY_VISIBLE");
		commonAbsent.push("SEGMENT_OLD_USER_HIDDEN", "SEGMENT_OLD_ASSISTANT_HIDDEN");
	}
	if (features.includes("delete")) {
		commonAbsent.push("DELETE_ASSISTANT_HIDDEN", "DELETE_TOOL_RESULT_HIDDEN");
	}
	if (features.includes("rollback")) {
		chatPresent.push("ROLLBACK_COMMON_VISIBLE", "ROLLBACK_ACTIVE_VISIBLE");
		compactPresent.push("ROLLBACK_COMMON_VISIBLE", "ROLLBACK_ACTIVE_VISIBLE");
		commonAbsent.push("ROLLBACK_ABANDONED_HIDDEN", "ROLLBACK_ABANDONED_ASSISTANT_HIDDEN");
	}
	if (features.includes("compaction")) {
		chatPresent.push("COMPACTION_SUMMARY_VISIBLE", "COMPACTION_KEPT_USER", "COMPACTION_KEPT_ASSISTANT");
		compactPresent.push("COMPACTION_KEPT_USER", "COMPACTION_KEPT_ASSISTANT");
		expect(result.preparation.previousSummary).toBe("COMPACTION_SUMMARY_VISIBLE");
	}

	assertIncludes(result.chatText, chatPresent);
	assertExcludes(result.chatText, commonAbsent);
	assertIncludes(result.compactText, compactPresent);
	assertExcludes(result.compactText, commonAbsent);

	if (features.includes("thinking")) {
		expect(result.chatText).toContain("THINKING_PRIVATE_HIDDEN_FROM_COMPACTION");
		expect(result.compactText).not.toContain("THINKING_PRIVATE_HIDDEN_FROM_COMPACTION");
		expect(result.compactTokens).toBeLessThan(result.chatTokens);
	} else {
		expect(result.compactTokens).toBe(result.chatTokens);
	}

	if (features.some((feature) => feature === "delete" || feature === "segment" || feature === "rollback")) {
		expect(result.rawTokens).toBeGreaterThan(result.chatTokens);
		expect(result.rawTokens).toBeGreaterThanOrEqual(result.compactTokens);
	}
}

describe("session context and compaction matrix", () => {
	const singleCases: Feature[][] = FEATURE_ORDER.map((feature) => [feature]);
	const pairwiseCases: Feature[][] = [];
	for (let i = 0; i < FEATURE_ORDER.length; i++) {
		for (let j = i + 1; j < FEATURE_ORDER.length; j++) {
			pairwiseCases.push([FEATURE_ORDER[i], FEATURE_ORDER[j]]);
		}
	}

	it.each(singleCases.map((features) => [features]))(
		"keeps chat and compaction context aligned for %s",
		(features) => {
			assertFeatureSemantics(features);
		},
	);

	it.each(pairwiseCases.map((features) => [features]))(
		"keeps chat and compaction context aligned for %s",
		(features) => {
			assertFeatureSemantics(features);
		},
	);
});
