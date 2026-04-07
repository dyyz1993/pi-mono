/**
 * OpenViking Memory Extension - Tool Definitions
 *
 * 4 tools: memread, membrowse, memcommit, memsearch
 * Ported from OpenCode plugin format (Zod) to pi-mono extension format (TypeBox).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { OpenVikingConfig, SearchResult, SessionMapping } from "./types.js";
import { makeRequest, unwrapResponse, totalMemoriesFromResult } from "./config.js";
import {
	getSessionMapping,
	startBackgroundCommit,
	waitForCommitCompletion,
	flushPendingMessages,
} from "./session-manager.js";

function formatSearchResults(
	result: SearchResult,
	_toolName: string,
	_query: string,
	extra?: Record<string, unknown>,
): string {
	const { memories = [], resources = [], skills = [] } = result;
	const allResults = [...memories, ...resources, ...skills];
	if (allResults.length === 0) return "No results found matching the query.";
	return JSON.stringify({ total: result.total ?? allResults.length, memories, resources, skills, ...extra }, null, 2);
}

function validateVikingUri(uri: string): string | null {
	if (!uri.startsWith("viking://"))
		return 'Error: Invalid URI format. Must start with "viking://". Example: viking://user/memories/';
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

function resolvePiSessionId(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile?.();
}

function commitResultJson(n: number, sessionId: string, status: string, task_id: string, archived?: boolean): string {
	return JSON.stringify(
		{
			message: `Memory extraction complete: ${n} memories extracted`,
			session_id: sessionId,
			status,
			memories_extracted: n,
			archived: archived ?? false,
			task_id,
		},
		null,
		2,
	);
}

export function registerTools(pi: ExtensionAPI, config: OpenVikingConfig): void {
	console.log("[OV-TOOLS] registerTools called, pi.registerTool type:", typeof pi.registerTool);
	pi.registerTool(
		defineTool({
			name: "memread",
			label: "Read Memory",
			description:
				"Retrieve the content of a specific memory, resource, or skill at a given viking:// URI.\n\nProgressive loading levels:\n- abstract: brief summary\n- overview: structured directory overview\n- read: full content\n- auto: choose overview for directories and read for files\n\nRequires: Complete viking:// URI (e.g., viking://user/memories/profile.md)",
			parameters: Type.Object({
				uri: Type.String({ description: "Complete viking:// URI (e.g., viking://user/memories/profile.md)" }),
				level: Type.Optional(
					Type.Union(
						[Type.Literal("auto"), Type.Literal("abstract"), Type.Literal("overview"), Type.Literal("read")],
						{
							description:
								"'auto' (directory->overview, file->read), 'abstract' (brief), 'overview' (directory), 'read' (full)",
						},
					),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const err = validateVikingUri(params.uri);
				if (err) return { content: [{ type: "text", text: err }], details: {} };

				try {
					let level = params.level ?? "auto";
					if (level === "auto") {
						try {
							const statRes = await makeRequest<{ status: string; result?: { isDir?: boolean } }>(config, {
								method: "GET",
								endpoint: `/api/v1/fs/stat?uri=${encodeURIComponent(params.uri)}`,
								abortSignal: ctx.signal,
							});
							const stat = unwrapResponse(statRes);
							level = stat?.isDir ? "overview" : "read";
						} catch {
							level = "read";
						}
					}

					const response = await makeRequest<{ status: string; result?: string | Record<string, unknown> }>(
						config,
						{
							method: "GET",
							endpoint: `/api/v1/content/${level}?uri=${encodeURIComponent(params.uri)}`,
							abortSignal: ctx.signal,
						},
					);
					const content = unwrapResponse(response);
					if (!content)
						return { content: [{ type: "text", text: `No content found at ${params.uri}` }], details: {} };
					return {
						content: [
							{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) },
						],
						details: {},
					};
				} catch (error: unknown) {
					return {
						content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
						details: {},
						isError: true,
					};
				}
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "membrowse",
			label: "Browse Memory",
			description:
				"Browse the OpenViking filesystem structure for a specific URI.\n\nViews: list, tree, stat.\nRequires: Complete viking:// URI",
			parameters: Type.Object({
				uri: Type.String({ description: "Complete viking:// URI to inspect (e.g., viking://user/memories/)" }),
				view: Type.Optional(
					Type.Union([Type.Literal("list"), Type.Literal("tree"), Type.Literal("stat")], {
						description: "'list', 'tree', or 'stat'",
					}),
				),
				recursive: Type.Optional(Type.Boolean({ description: "Recursively list descendants (list view only)" })),
				simple: Type.Optional(Type.Boolean({ description: "Simpler URI-oriented output (list view only)" })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const err = validateVikingUri(params.uri);
				if (err) return { content: [{ type: "text", text: err }], details: {} };

				try {
					const view = params.view ?? "list";
					const eu = encodeURIComponent(params.uri);
					let endpoint: string;
					if (view === "stat") endpoint = `/api/v1/fs/stat?uri=${eu}`;
					else if (view === "tree") endpoint = `/api/v1/fs/tree?uri=${eu}`;
					else
						endpoint = `/api/v1/fs/ls?uri=${eu}&recursive=${params.recursive ? "true" : "false"}&simple=${params.simple ? "true" : "false"}`;

					const response = await makeRequest<{ status: string; result?: unknown[] }>(config, {
						method: "GET",
						endpoint,
						abortSignal: ctx.signal,
					});
					const result = unwrapResponse(response);
					const items = Array.isArray(result) ? result : [];
					if (items.length === 0)
						return { content: [{ type: "text", text: `No items found at ${params.uri}` }], details: {} };
					return {
						content: [{ type: "text", text: JSON.stringify({ view, count: items.length, items }, null, 2) }],
						details: {},
					};
				} catch (error: unknown) {
					return {
						content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
						details: {},
						isError: true,
					};
				}
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "memcommit",
			label: "Commit Session",
			description:
				"Commit the current pi session to OpenViking and extract persistent memories.\n\nReturns background commit progress including task_id, memories_extracted.",
			parameters: Type.Object({
				session_id: Type.Optional(
					Type.String({
						description:
							"Optional explicit OpenViking session ID. Omit to commit current session's mapped OV session.",
					}),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				let sessionId = params.session_id;
				const piSessionId = resolvePiSessionId(ctx);

				if (!sessionId && piSessionId) {
					const m = getSessionMapping(piSessionId);
					if (m) sessionId = m.ovSessionId;
				}

				if (!sessionId) {
					return {
						content: [
							{
								type: "text",
								text: "Error: No OpenViking session associated. Start a normal session first or pass session_id.",
							},
						],
						details: {},
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
						const existingTask = await waitForCommitCompletion(resolvedMapping, piSessionId, config, ctx.signal);
						if (existingTask?.status === "completed") {
							const n = totalMemoriesFromResult(existingTask.result);
							return {
								content: [
									{
										type: "text",
										text: commitResultJson(
											n,
											existingTask.result?.session_id ?? sessionId,
											existingTask.status,
											existingTask.task_id,
											existingTask.result?.archived,
										),
									},
								],
								details: {},
							};
						}
					}

					const tempMapping: SessionMapping = resolvedMapping ?? {
						ovSessionId: sessionId,
						createdAt: Date.now(),
						capturedMessages: new Set<string>(),
						messageRoles: new Map<string, "user" | "assistant">(),
						pendingMessages: new Map<string, string>(),
						sendingMessages: new Set<string>(),
					};
					const sid = piSessionId ?? sessionId;
					const commitStart = await startBackgroundCommit(tempMapping, sid, config, ctx.signal);
					if (!commitStart) throw new Error("Failed to start background commit");

					if (commitStart.mode === "completed") {
						const n = totalMemoriesFromResult(commitStart.result);
						return {
							content: [
								{
									type: "text",
									text: commitResultJson(
										n,
										commitStart.result.session_id ?? sessionId,
										"completed",
										commitStart.result.task_id ?? "",
										commitStart.result.archived,
									),
								},
							],
							details: {},
						};
					}

					const waitTask =
						resolvedMapping && piSessionId
							? await waitForCommitCompletion(resolvedMapping, piSessionId, config, ctx.signal)
							: null;

					if (!waitTask) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											message: "Commit processing in background",
											session_id: sessionId,
											status: "accepted",
											task_id: commitStart.taskId,
										},
										null,
										2,
									),
								},
							],
							details: {},
						};
					}

					const n = totalMemoriesFromResult(waitTask.result);
					return {
						content: [
							{
								type: "text",
								text: commitResultJson(
									n,
									waitTask.result?.session_id ?? sessionId,
									waitTask.status,
									waitTask.task_id,
									waitTask.result?.archived,
								),
							},
						],
						details: {},
					};
				} catch (error: unknown) {
					return {
						content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
						details: {},
						isError: true,
					};
				}
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "memsearch",
			label: "Search Memory",
			description: "Search OpenViking memories, resources, and skills. Modes: auto/fast/deep.",
			parameters: Type.Object({
				query: Type.String({ description: "Search query - natural language, question, or task description" }),
				target_uri: Type.Optional(
					Type.String({ description: "Limit search to URI prefix (e.g., viking://resources/)" }),
				),
				mode: Type.Optional(
					Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")], {
						description: "Search mode: auto/fast/deep",
					}),
				),
				session_id: Type.Optional(Type.String({ description: "Optional OV session ID for context-aware search" })),
				limit: Type.Optional(Type.Number({ description: "Max results" })),
				score_threshold: Type.Optional(Type.Number({ description: "Minimum score threshold" })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				let sessionId = params.session_id;
				const piSessionId = resolvePiSessionId(ctx);
				if (!sessionId && piSessionId) {
					const m = getSessionMapping(piSessionId);
					if (m) sessionId = m.ovSessionId;
				}

				const mode = resolveSearchMode(params.mode, params.query, sessionId);
				const requestBody: Record<string, unknown> = { query: params.query, limit: params.limit ?? 10 };
				if (params.target_uri) requestBody.target_uri = params.target_uri;
				if (params.score_threshold !== undefined) requestBody.score_threshold = params.score_threshold;
				if (mode === "deep" && sessionId) requestBody.session_id = sessionId;

				try {
					const ep = mode === "deep" ? "/api/v1/search/search" : "/api/v1/search/find";
					const response = await makeRequest<{ status: string; result?: SearchResult }>(config, {
						method: "POST",
						endpoint: ep,
						body: requestBody,
						abortSignal: ctx.signal,
					});
					const result = unwrapResponse(response) ?? { memories: [], resources: [], skills: [], total: 0 };
					const qp = (result as unknown as Record<string, unknown>).query_plan;
					return {
						content: [
							{
								type: "text",
								text: formatSearchResults(result, "memsearch", params.query, { mode, query_plan: qp }),
							},
						],
						details: {},
					};
				} catch (error: unknown) {
					return {
						content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
						details: {},
						isError: true,
					};
				}
			},
		}),
	);
}
