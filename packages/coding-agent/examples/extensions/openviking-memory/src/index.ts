/**
 * OpenViking Memory Extension for Pi Coding Agent
 *
 * Exposes OpenViking's semantic memory capabilities as tools for AI agents.
 * Supports user profiles, preferences, entities, events, cases, and patterns.
 *
 * Ported from @opencode-ai/plugin format to @mariozechner/pi-coding-agent extension format.
 *
 * Contributed by: littlelory@convolens.net
 * GitHub: https://github.com/convolens
 * Copyright 2026 Convolens.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { checkServiceHealth, loadConfig } from "./config.js";
import {
	createSessionMapping,
	ensureOpenVikingSession,
	flushPendingMessages,
	getSessionMapping,
	initFileSystem,
	loadSessionMap,
	removeSessionMapping,
	resolveSessionId,
	sessionMessageBuffer,
	startBackgroundCommit,
	storeMessageRole,
	storePendingContent,
	upsertBufferedMessage,
} from "./session-manager.js";
import { registerTools } from "./tools.js";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));

export default function openVikingMemoryExtension(pi: ExtensionAPI) {
	// Extension loaded successfully (debug: remove this in production)
	pi.registerProvider("glm", {
		baseUrl: "https://modelservice.jdcloud.com/coding/anthropic",
		apiKey: "pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a",
		api: "anthropic-messages",
		authHeader: false,
		headers: {
			"x-api-key": "pk-2edc47d6-4e16-48c2-935c-2dc3dfad2d1a",
			"anthropic-version": "2023-06-01",
		},
		models: [
			{
				id: "DeepSeek-V3.2",
				name: "DeepSeek V3.2",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		],
	});

	const config = loadConfig();

	initFileSystem(pluginDir);

	if (!config.enabled) {
		console.log("OpenViking Memory Extension is disabled in configuration");
		return;
	}

	loadSessionMap().catch(() => {});

	checkServiceHealth(config)
		.then((healthy) => {
			console.log(`OpenViking health check: ${healthy ? "passed" : "failed"}`);
		})
		.catch(() => {});

	registerTools(pi, config);

	// ====================================================================
	// Event Handlers
	// Mapping from OpenCode events -> pi-mono events:
	//   session.created     -> session_start
	//   session.deleted     -> session_shutdown
	//   message.updated     -> message_update
	//   message.part.updated-> message_update (extract text from assistantMessageEvent)
	//   stop               -> session_shutdown
	// ====================================================================

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = resolveSessionId(ctx);
		if (!sessionId) return;

		const ovSessionId = await ensureOpenVikingSession(sessionId, config);
		if (!ovSessionId) return;

		const mapping = createSessionMapping(sessionId, ovSessionId);

		const buffered = sessionMessageBuffer.get(sessionId);
		if (buffered && buffered.length > 0) {
			for (const msg of buffered) {
				if (msg.role) storeMessageRole(mapping, msg.messageId, msg.role);
				if (msg.content) storePendingContent(mapping, msg.messageId, msg.content);
			}
			await flushPendingMessages(sessionId, mapping, config);
			sessionMessageBuffer.delete(sessionId);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = resolveSessionId(ctx);
		if (!sessionId) return;

		const mapping = getSessionMapping(sessionId);
		if (!mapping) return;

		await flushPendingMessages(sessionId, mapping, config);

		if (mapping.capturedMessages.size > 0 || mapping.commitInFlight) {
			mapping.pendingCleanup = true;
			if (!mapping.commitInFlight) await startBackgroundCommit(mapping, sessionId, config);
		} else {
			removeSessionMapping(sessionId);
		}
	});

	pi.on("message_update", async (event, _ctx) => {
		const message = event.message;
		if (!message?.role) return;

		const sessionId = resolveSessionId(_ctx);
		if (!sessionId) return;

		const mapping = getSessionMapping(sessionId);
		if (!mapping) {
			const msgId = generateMessageId(message);
			const evt = event.assistantMessageEvent;
			let content: string | undefined;
			const messageContent = extractTextContent(event.message);
			if (messageContent) content = messageContent;
			if (!content && evt && isTextDeltaEvent(evt)) {
				content = extractTextFromEvent(evt) || undefined;
			}
			upsertBufferedMessage(sessionId, msgId, {
				role: message.role as "user" | "assistant",
				...(content ? { content } : {}),
			});
			return;
		}

		if (message.role === "user") storeMessageRole(mapping, generateMessageId(message), "user");
		else if (message.role === "assistant") storeMessageRole(mapping, generateMessageId(message), "assistant");

		const evt = event.assistantMessageEvent;
		if (evt && isTextDeltaEvent(evt)) {
			const textContent = extractTextFromEvent(evt);
			if (textContent && textContent.trim().length > 0) {
				storePendingContent(mapping, generateMessageId(message), textContent);
			}
		}

		await flushPendingMessages(sessionId, mapping, config);
	});

	pi.on("message_end", async (event, _ctx) => {
		const message = event.message;
		if (!message?.role) return;
		if (message.role !== "user" && message.role !== "assistant") return;

		const sessionId = resolveSessionId(_ctx);
		if (!sessionId) return;

		const mapping = getSessionMapping(sessionId);
		const msgId = generateMessageId(message);
		const content = extractTextContent(message);

		if (mapping) {
			storeMessageRole(mapping, msgId, message.role as "user" | "assistant");
			if (content && content.trim().length > 0) storePendingContent(mapping, msgId, content);
			await flushPendingMessages(sessionId, mapping, config);
		} else {
			upsertBufferedMessage(sessionId, msgId, {
				role: message.role as "user" | "assistant",
				...(content ? { content } : {}),
			});
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		const sessionId = resolveSessionId(ctx);
		if (!sessionId) return;
		const mapping = getSessionMapping(sessionId);
		if (mapping) await flushPendingMessages(sessionId, mapping, config);
	});

	import("./session-manager.js").then((mod) => mod.startAutoCommit(config));
}

// ============================================================================
// Message ID Generation & Content Extraction Helpers
//
// pi-mono's AgentMessage (UserMessage | AssistantMessage | ToolResultMessage)
// does not have an 'id' field unlike OpenCode's event format.
// We derive stable IDs from role + timestamp.
// ============================================================================

function generateMessageId(message: { role: string; timestamp: number }): string {
	return `${message.role}-${message.timestamp}`;
}

function extractTextContent(message: { role: string; content?: any }): string | undefined {
	if (!message.content) return undefined;
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return (
			message.content
				.filter((part): part is { type: string; text?: string } => part?.type === "text")
				.map((part) => part.text ?? "")
				.join("") || undefined
		);
	}
	return undefined;
}

function isTextDeltaEvent(evt: AssistantMessageEvent): boolean {
	const type = evt.type;
	return type === "text_delta" || type === "text_start" || type === "text_end";
}

function extractTextFromEvent(evt: AssistantMessageEvent): string {
	switch (evt.type) {
		case "text_delta":
			return (evt as any).delta ?? "";
		case "text_end":
			return (evt as any).content ?? "";
		case "text_start":
			return "";
		default:
			return "";
	}
}
