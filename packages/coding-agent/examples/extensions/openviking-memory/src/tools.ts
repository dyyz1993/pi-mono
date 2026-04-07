/**
 * OpenViking Memory Extension - Tool Definitions
 *
 * 4 tools: memread, membrowse, memcommit, memsearch
 * Ported from OpenCode plugin format (Zod) to pi-mono extension format (TypeBox).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { OpenVikingConfig, SearchResult } from "./types.js";
import { makeRequest, unwrapResponse, totalMemoriesFromResult } from "./config.js";
import {
	getSessionMapping,
	startBackgroundCommit,
	waitForCommitCompletion,
	flushPendingMessages,
} from "./session-manager.js";

// ============================================================================
// Helpers
// ============================================================================

function formatSearchResults(
	result: SearchResult,
	toolName: string,
	query: string,
	extra?: Record<string, unknown>,
): string {
	const { memories = [], resources = [], skills = [] } = result;
	const allResults = [...memories, ...resources, ...skills];
	if (allResults.length === 0) return "No results found matching the query.";
	return JSON.stringify({ total: result.total ?? allResults.length, memories, resources, skills, ...extra }, null, 2);
}

function validateVikingUri(uri: string, toolName: string): string | null {
	if (!uri.startsWith("viking://"))
		return `Error: Invalid URI format. Must start with "viking://". Example: viking://user/memories/`;
	return null;
}

function resolveSearchMode(
	requestedMode: "auto" | "fast" | "deep" | undefined,
	query: string,
	sessionId?: string,
): "fast" | "deep" {
	if (requestedMode === "fast" || requestedMode === "deep") return requestedMode;
	if (sessionId) return "deep";
	const normalized = query.trim();
	const wordCount = normalized ? normalized.split(/\s+/).length : 0;
	if (normalized.includes("?") || normalized.length >= 80 || wordCount >= 8) return "deep";
	return "fast";
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerTools(pi: ExtensionAPI, config: OpenVikingConfig): void {
	// --- memread ---
	pi.registerTool(
		defineTool({
			name: "memread",
			label: "Read Memory",
			description:
				"Retrieve the content of a specific memory, resource, or skill at a given viking:// URI.\n\nProgressive loading levels:\n- abstract: brief summary\n- overview: structured directory overview\n- read: full content\n- auto: choose overview for directories and read for files\n\nUse when:\n- You have a URI from memsearch or membrowse\n- You need to inspect a memory, resource, or skill in more detail\n\nRequires: Complete viking:// URI (e.g., viking://user/memories/profile.md)",
			parameters: Type.Object({
				uri: Type.String({
					description:
						"Complete viking:// URI from search results or list output (e.g., viking://user/memories/profile.md)",
				}),
				level: Type.Optional(
					Type.Union([
						Type.Literal("auto"),
						Type.Literal("abstract"),
						Type.Literal("overview"),
						Type.Literal("read"),
					]),
				).describe(
					"'auto' (directory->overview, file->read), 'abstract' (brief), 'overview' (directory), 'read' (full)",
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const validationError = validateVikingUri(params.uri, "memread");
				if (validationError) return { content: [{ type: "text", text: validationError }] };

				try {
					let level = params.level ?? "auto";
					if (level === "auto") {
						try {
							const statResponse = await makeRequest<{ isDir?: boolean }>(config, {
								method: "GET",
								endpoint: `/api/v1/fs/stat?uri=${encodeURIComponent(params.uri)}`,
								abortSignal: ctx.signal,
							});
							const statResult = unwrapResponse(statResponse);
							level = statResult?.isDir ? "overview" : "read";
						} catch {
							level = "read";
						}
					}

					const response = await makeRequest<string | Record<string, unknown>>(config, {
						method: "GET",
						endpoint: `/api/v1/content/${level}?uri=${encodeURIComponent(params.uri)}`,
						abortSignal: ctx.signal,
					});
					const content = unwrapResponse(response);
					if (!content) return { content: [{ type: "text", text: `No content found at ${params.uri}` }] };
					return {
						content: [
							{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) },
						],
					};
				} catch (error: unknown) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
								isError: true,
							},
						],
					};
				}
			},
		}),
	);

	// --- membrowse ---
	pi.registerTool(
		defineTool({
			name: "membrowse",
			label: "Browse Memory",
			description:
				"Browse the OpenViking filesystem structure for a specific URI.\n\nViews:\n- list: list immediate children, or recurse when recursive=true\n- tree: return a directory tree view\n- stat: return metadata for a single file or directory\n\nUse when:\n- You need to discover available URIs before reading\n- You want to inspect directory structure under memories/resources/skills\n\nRequires: Complete viking:// URI",
			parameters: Type.Object({
				uri: Type.String({
					description:
						"Complete viking:// URI to inspect (e.g., viking://user/memories/, viking://agent/memories/)",
				}),
				view: Type.Optional(
					Type.Union([Type.Literal("list"), Type.Literal("tree"), Type.Literal("stat")]),
				).describe("'list', 'tree', or 'stat'"),
				recursive: Type.Optional(Type.Boolean()).describe("Only for list view. Recursively list descendants."),
				simple: Type.Optional(Type.Boolean()).describe("Only for list view. Simpler URI-oriented output."),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const validationError = validateVikingUri(params.uri, "membrowse");
				if (validationError) return { content: [{ type: "text", text: validationError }] };

				try {
					const view = params.view ?? "list";
					const encodedUri = encodeURIComponent(params.uri);

					let endpoint: string;
					if (view === "stat") endpoint = `/api/v1/fs/stat?uri=${encodedUri}`;
					else if (view === "tree") endpoint = `/api/v1/fs/tree?uri=${encodedUri}`;
					else
						endpoint = `/api/v1/fs/ls?uri=${encodedUri}&recursive=${params.recursive ? "true" : "false"}&simple=${params.simple ? "true" : "false"}`;

					const response = await makeRequest<any[]>(config, {
						method: "GET",
						endpoint,
						abortSignal: ctx.signal,
					});
					const result = unwrapResponse(response);
					const items = Array.isArray(result) ? result : [];
					if (items.length === 0) return { content: [{ type: "text", text: `No items found at ${params.uri}` }] };
					return {
						content: [{ type: "text", text: JSON.stringify({ view, count: items.length, items }, null, 2) }],
					};
				} catch (error: unknown) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
								isError: true,
							},
						],
					};
				}
			},
		}),
	);

	// --- memcommit ---
	pi.registerTool(
		defineTool({
			name: "memcommit",
			label: "Commit Session",
			description:
				"Commit the current pi session to OpenViking and extract persistent memories.\n\nAutomatically extracts:\n- User profile, preferences, entities, events -> viking://user/memories/\n- Agent cases and patterns -> viking://agent/memories/\n\nReturns background commit progress including task_id, memories_extracted.",
			parameters: Type.Object({
				session_id: Type.Optional(Type.String()).describe(
					"Optional explicit OpenViking session ID. Omit to commit current session's mapped OV session.",
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				let sessionId = params.session_id;
				const piSessionId = resolvePiSessionId(ctx);

				if (!sessionId && piSessionId) {
					const mapping = getSessionMapping(piSessionId);
					if (mapping) sessionId = mapping.ovSessionId;
				}

				if (!sessionId) {
					return {
						content: [
							{
								type: "text",
								text: "Error: No OpenViking session is associated. Start a normal session first, or pass an explicit session_id.",
							},
						],
						isError: true,
					};
				}

				try {
					const mapping = piSessionId ? getSessionMapping(piSessionId) : undefined;
					const resolvedMapping = mapping?.ovSessionId === sessionId ? mapping : undefined;

					if (resolvedMapping && piSessionId) {
						await flushPendingMessages(piSessionId, resolvedMapping, config);
					}

					if (resolvedMapping?.commitInFlight && piSessionId) {
						const task = await waitForCommitCompletion(resolvedMapping, piSessionId, config, ctx.signal);
						if (task?.status === "completed") {
							const extracted = totalMemoriesFromResult(task.result);
							return {
								content: [
									{
										type: "text",
										text: JSON.stringify(
											{
												message: `Memory extraction complete: ${extracted} memories extracted`,
												session_id: task.result?.session_id ?? sessionId,
												status: task.status,
												memories_extracted: extracted,
												archived: task.result?.archived ?? false,
												task_id: task.task_id,
											},
											null,
											2,
										),
									},
								],
							};
						}
					}

					const tempMapping: import("./session-manager.js").SessionMapping = resolvedMapping ?? {
						ovSessionId: sessionId,
						createdAt: Date.now(),
						capturedMessages: new Set(),
						messageRoles: new Map(),
						pendingMessages: new Map(),
						sendingMessages: new Set(),
					};

					const sid = piSessionId ?? sessionId;
					const commitStart = await startBackgroundCommit(tempMapping, sid, config, ctx.signal);
					if (!commitStart) throw new Error("Failed to start background commit");

					if (commitStart.mode === "completed") {
						const extracted = totalMemoriesFromResult(commitStart.result);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											message: `Memory extraction complete: ${extracted} memories extracted`,
											session_id: commitStart.result.session_id ?? sessionId,
											status: commitStart.result.status ?? "completed",
											memories_extracted: extracted,
											archived: commitStart.result.archived ?? false,
										},
										null,
										2,
									),
								},
							],
						};
					}

					const task =
						resolvedMapping && piSessionId
							? await waitForCommitCompletion(resolvedMapping, piSessionId, config, ctx.signal)
							: null;

					if (!task) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											message: "Commit is processing in the background",
											session_id: sessionId,
											status: "accepted",
											task_id: commitStart.taskId,
										},
										null,
										2,
									),
								},
							],
						};
					}

					const extracted = totalMemoriesFromResult(task.result);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										message: `Memory extraction complete: ${extracted} memories extracted`,
										session_id: task.result?.session_id ?? sessionId,
										status: task.status,
										memories_extracted: extracted,
										archived: task.result?.archived ?? false,
										task_id: task.task_id,
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error: unknown) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
								isError: true,
							},
						],
					};
				}
			},
		}),
	);

	// --- memsearch ---
	pi.registerTool(
		defineTool({
			name: "memsearch",
			label: "Search Memory",
			description:
				"Search OpenViking memories, resources, and skills through a unified interface.\n\nModes:\n- auto: choose between fast similarity and deep context-aware search\n- fast: simple semantic similarity search\n- deep: intent analysis with optional session context\n\nReturns memories, resources, skills with relevance scores.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query - natural language, question, or task description" }),
				target_uri: Type.Optional(Type.String()).describe("Limit search to URI prefix (e.g., viking://resources/)"),
				mode: Type.Optional(
					Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")]),
				).describe("Search mode"),
				session_id: Type.Optional(Type.String()).describe("Optional OV session ID for context-aware search"),
				limit: Type.Optional(Type.Number({ default: 10 })).describe("Max results"),
				score_threshold: Type.Optional(Type.Number()).describe("Minimum score threshold"),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				let sessionId = params.session_id;
				const piSessionId = resolvePiSessionId(ctx);

				if (!sessionId && piSessionId) {
					const mapping = getSessionMapping(piSessionId);
					if (mapping) sessionId = mapping.ovSessionId;
				}

				const mode = resolveSearchMode(params.mode, params.query, sessionId);
				const requestBody: Record<string, any> = { query: params.query, limit: params.limit ?? 10 };
				if (params.target_uri) requestBody.target_uri = params.target_uri;
				if (params.score_threshold !== undefined) requestBody.score_threshold = params.score_threshold;
				if (mode === "deep" && sessionId) requestBody.session_id = sessionId;

				try {
					const response = await makeRequest<SearchResult>(config, {
						method: "POST",
						endpoint: mode === "deep" ? "/api/v1/search/search" : "/api/v1/search/find",
						body: requestBody,
						abortSignal: ctx.signal,
					});
					const result = unwrapResponse(response) ?? { memories: [], resources: [], skills: [], total: 0 };
					return {
						content: [
							{
								type: "text",
								text: formatSearchResults(result, "memsearch", params.query, {
									mode,
									query_plan: result.query_plan,
								}),
							},
						],
					};
				} catch (error: unknown) {
					return {
						content: [
							{
								type: "text",
								text: `Error: ${error instanceof Error ? error.message : String(error)}`,
								isError: true,
							},
						],
					};
				}
			},
		}),
	);
}

function resolvePiSessionId(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile?.();
}
