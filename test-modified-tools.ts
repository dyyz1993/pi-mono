/**
 * OpenViking Memory Extension - Tool Definitions
 *
 * 4 tools: memread, membrowse, memcommit, memsearch
 * Ported from OpenCode plugin format (Zod) to pi-mono extension format (TypeBox).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { defineTool } from "@mariozechner/pi-coding-agent"
import type { OpenVikingConfig, SearchResult } from "./types.js"
import { makeRequest, unwrapResponse, totalMemoriesFromResult } from "./config.js"
import {
	getSessionMapping,
	startBackgroundCommit,
	waitForCommitCompletion,
	flushPendingMessages,
} from "./session-manager.js"

function formatSearchResults(
	result: SearchResult,
	toolName: string,
	query: string,
	extra?: Record<string, unknown>,
): string {
	const { memories = [], resources = [], skills = [] } = result
	const allResults = [...memories, ...resources, ...skills]
	if (allResults.length === 0) return "No results found matching the query."
	return JSON.stringify({ total: result.total ?? allResults.length, memories, resources, skills, ...extra }, null, 2)
}

function validateVikingUri(uri: string, toolName: string): string | null {
	if (!uri.startsWith("viking://"))
		return `Error: Invalid URI format. Must start with "viking://". Example: viking://user/memories/`
	return null
}

function resolveSearchMode(
	requestedMode: "auto" | "fast" | "deep" | undefined,
	query: string,
	sessionId?: string,
): "fast" | "deep" {
	if (requestedMode === "fast" || requestedMode === "deep") return requestedMode
	if (sessionId) return "deep"
	const normalized = query.trim()
	const wordCount = normalized ? normalized.split(/\s+/).length : 0
	if (normalized.includes("?") || normalized.length >= 80 || wordCount >= 8) return "deep"
	return "fast"
}

export function registerTools(pi: ExtensionAPI, config: OpenVikingConfig): void {

	// --- memread ---
	pi.registerTool(
		defineTool({
			name: "memread",
			label: "Read Memory",
			description:
				"Retrieve the content of a specific memory, resource, or skill at a given viking:// URI.\n\nProgressive loading levels:\n- abstract: brief summary\n- overview: structured directory overview\n- read: full content\n- auto: choose overview for directories and read for files\n\nRequires: Complete viking:// URI (e.g., viking://user/memories/profile.md)",
			parameters: Type.Object({
				uri: Type.String({
					description: "Complete viking:// URI (e.g., viking://user/memories/profile.md)",
				}),
				level: Type.Union([
					Type.Literal("auto"),
					Type.Literal("abstract"),
					Type.Literal("overview"),
					Type.Literal("read"),
				], { description: "'auto' (directory->overview, file->read), 'abstract' (brief), 'overview' (directory), 'read' (full)" }),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const validationError = validateVikingUri(params.uri, "memread")
				if (validationError) return { content: [{ type: "text", text: validationError }], details: {} }

				try {
					let level = params.level ?? "auto"
					if (level === "auto") {
						try {
							const statResponse = await makeRequest<{ status: string; result?: { isDir?: boolean } }>(config, {
								method: "GET", endpoint: `/api/v1/fs/stat?uri=${encodeURIComponent(params.uri)}`, abortSignal: ctx.signal,
							})
							const statResult = unwrapResponse(statResponse)
							level = statResult?.isDir ? "overview" : "read"
						} catch { level = "read" }
					}

					const response = await makeRequest<{ status: string; result?: string | Record<string, unknown> }>(config, {
						method: "GET", endpoint: `/api/v1/content/${level}?uri=${encodeURIComponent(params.uri)}`, abortSignal: ctx.signal,
					})
					const content = unwrapResponse(response)
					if (!content) return { content: [{ type: "text", text: `No content found at ${params.uri}` }], details: {} }
					return { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: {} }
				} catch (error: unknown) {
					return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true }], details: {} }
				}
			},
		}),
	)

	// --- membrowse ---
	pi.registerTool(
		defineTool({
			name: "membrowse",
			label: "Browse Memory",
			description:
				"Browse the OpenViking filesystem structure for a specific URI.\n\nViews: list, tree, stat.\nRequires: Complete viking:// URI",
			parameters: Type.Object({
				uri: Type.String({ description: "Complete viking:// URI to inspect (e.g., viking://user/memories/)" }),
				view: Type.Union([Type.Literal("list"), Type.Literal("tree"), Type.Literal("stat")], { description: "'list', 'tree', or 'stat'" }),
				recursive: Type.Boolean({ description: "Recursively list descendants (list view only)" }),
				simple: Type.Boolean({ description: "Simpler URI-oriented output (list view only)" }),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const validationError = validateVikingUri(params.uri, "membrowse")
				if (validationError) return { content: [{ type: "text", text: validationError }], details: {} }

				try {
					const view = params.view ?? "list"
					const encodedUri = encodeURIComponent(params.uri)
					let endpoint: string
					if (view === "stat") endpoint = `/api/v1/fs/stat?uri=${encodedUri}`
					else if (view === "tree") endpoint = `/api/v1/fs/tree?uri=${encodedUri}`
					else endpoint = `/api/v1/fs/ls?uri=${encodedUri}&recursive=${params.recursive ? "true" : "false"}&simple=${params.simple ? "true" : "false"}`

					const response = await makeRequest<{ status: string; result?: any[] }>(config, {
						method: "GET", endpoint, abortSignal: ctx.signal,
					})
					const result = unwrapResponse(response)
					const items = Array.isArray(result) ? result : []
					if (items.length === 0) return { content: [{ type: "text", text: `No items found at ${params.uri}` }], details: {} }
					return { content: [{ type: "text", text: JSON.stringify({ view, count: items.length, items }, null, 2) }], details: {} }
				} catch (error: unknown) {
					return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true }], details: {} }
				}
			},
		}),
	)

	// --- memcommit ---
	pi.registerTool(
		defineTool({
			name: "memcommit",
			label: "Commit Session",
			description: "Commit session",
			parameters: Type.Object({
				session_id: Type.String({ description: "Session ID" }),
			}),
			async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		}),
	);

	// --- memsearch ---
	pi.registerTool(
		defineTool({
			name: "memsearch",
			label: "Search Memory",
			description: "Search OpenViking memories, resources, and skills. Modes: auto/fast/deep.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query - natural language, question, or task description" }),
				target_uri: Type.String({ description: "Limit search to URI prefix (e.g., viking://resources/)" }),
				mode: Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")], { description: "Search mode: auto/fast/deep" }),
				session_id: Type.String({ description: "Optional OV session ID for context-aware search" }),
				limit: Type.Number({ description: "Max results", default: 10 }),
				score_threshold: Type.Number({ description: "Minimum score threshold" }),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				let sessionId = params.session_id
				const piSessionId = resolvePiSessionId(ctx)
				if (!sessionId && piSessionId) { const mapping = getSessionMapping(piSessionId); if (mapping) sessionId = mapping.ovSessionId }

				const mode = resolveSearchMode(params.mode, params.query, sessionId)
				const requestBody: Record<string, any> = { query: params.query, limit: params.limit ?? 10 }
				if (params.target_uri) requestBody.target_uri = params.target_uri
				if (params.score_threshold !== undefined) requestBody.score_threshold = params.score_threshold
				if (mode === "deep" && sessionId) requestBody.session_id = sessionId

				try {
					const response = await makeRequest<{ status: string; result?: SearchResult }>(config, {
						method: "POST", endpoint: mode === "deep" ? "/api/v1/search/search" : "/api/v1/search/find", body: requestBody, abortSignal: ctx.signal,
					})
					const result = unwrapResponse(response) ?? { memories: [], resources: [], skills: [], total: 0 }
					return { content: [{ type: "text", text: formatSearchResults(result, "memsearch", params.query, { mode, query_plan: (result as any).query_plan }) }], details: {} }
				} catch (error: unknown) {
					return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true }], details: {} }
				}
			},
		}),
	)
}

function resolvePiSessionId(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile?.()
}
