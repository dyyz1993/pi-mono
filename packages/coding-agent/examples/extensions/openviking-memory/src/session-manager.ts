/**
 * OpenViking Memory Extension - Session Manager
 *
 * Manages mapping between pi sessions and OpenViking sessions.
 * Handles message buffering, persistence, and auto-commit scheduling.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
	BufferedMessage,
	CommitResult,
	CommitStartResult,
	OpenVikingConfig,
	SessionMapFile,
	SessionMapping,
	SessionMappingPersisted,
	TaskResult,
} from "./types.js";

export const COMMIT_TIMEOUT_MS = 180000;
export const MAX_BUFFERED_MESSAGES_PER_SESSION = 100;
export const BUFFERED_MESSAGE_TTL_MS = 15 * 60 * 1000;
export const BUFFER_CLEANUP_INTERVAL_MS = 30 * 1000;

export { sessionMessageBuffer };

import { makeRequest, totalMemoriesFromResult, unwrapResponse } from "./config.js";

// ============================================================================
// State
// ============================================================================

const sessionMap = new Map<string, SessionMapping>();
const sessionMessageBuffer = new Map<string, BufferedMessage[]>();
let lastBufferCleanupAt = 0;

let sessionMapPath: string | null = null;
let logFilePath: string | null = null;
let pluginDataDir: string | null = null;

let backgroundCommitSupported: boolean | null = null;
let autoCommitTimer: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Logging
// ============================================================================

function ensurePluginDataDir(dir: string): string | null {
	try {
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	} catch (error) {
		console.error("Failed to ensure plugin directory:", error);
		return null;
	}
}

function initLogger(dir: string) {
	pluginDataDir = dir;
	logFilePath = path.join(dir, "openviking-memory.log");
}

function safeStringify(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map((item) => safeStringify(item));
	const result: any = {};
	for (const key in obj) {
		if (Object.hasOwn(obj, key)) {
			const value = obj[key];
			if (typeof value === "function") result[key] = "[Function]";
			else if (typeof value === "object" && value !== null) {
				try {
					result[key] = safeStringify(value);
				} catch {
					result[key] = "[Circular or Non-serializable]";
				}
			} else result[key] = value;
		}
	}
	return result;
}

function log(level: "INFO" | "ERROR" | "DEBUG", toolName: string, message: string, data?: any) {
	if (!logFilePath) return;
	const timestamp = new Date().toISOString();
	const logEntry = { timestamp, level, tool: toolName, message, ...(data && { data: safeStringify(data) }) };
	try {
		fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + "\n", "utf-8");
	} catch (error) {
		console.error("Failed to write to log file:", error);
	}
}

// ============================================================================
// Session Map Persistence
// ============================================================================

function initSessionMapPath(dir: string) {
	sessionMapPath = path.join(dir, "openviking-session-map.json");
}

function serializeSessionMapping(mapping: SessionMapping): SessionMappingPersisted {
	return {
		ovSessionId: mapping.ovSessionId,
		createdAt: mapping.createdAt,
		capturedMessages: Array.from(mapping.capturedMessages),
		messageRoles: Array.from(mapping.messageRoles.entries()),
		pendingMessages: Array.from(mapping.pendingMessages.entries()),
		lastCommitTime: mapping.lastCommitTime,
		commitInFlight: mapping.commitInFlight,
		commitTaskId: mapping.commitTaskId,
		commitStartedAt: mapping.commitStartedAt,
		pendingCleanup: mapping.pendingCleanup,
	};
}

function deserializeSessionMapping(persisted: SessionMappingPersisted): SessionMapping {
	return {
		ovSessionId: persisted.ovSessionId,
		createdAt: persisted.createdAt,
		capturedMessages: new Set(persisted.capturedMessages),
		messageRoles: new Map(persisted.messageRoles),
		pendingMessages: new Map(persisted.pendingMessages),
		sendingMessages: new Set(),
		lastCommitTime: persisted.lastCommitTime,
		commitInFlight: persisted.commitInFlight,
		commitTaskId: persisted.commitTaskId,
		commitStartedAt: persisted.commitStartedAt,
		pendingCleanup: persisted.pendingCleanup,
	};
}

export async function loadSessionMap(): Promise<void> {
	if (!sessionMapPath) return;
	try {
		if (!fs.existsSync(sessionMapPath)) {
			log("INFO", "persistence", "No session map file found, starting fresh");
			return;
		}
		const content = await fs.promises.readFile(sessionMapPath, "utf-8");
		const data: SessionMapFile = JSON.parse(content);
		if (data.version !== 1) {
			log("ERROR", "persistence", "Unsupported session map version", { version: data.version });
			return;
		}
		for (const [opencodeSessionId, persisted] of Object.entries(data.sessions)) {
			sessionMap.set(opencodeSessionId, deserializeSessionMapping(persisted));
		}
		log("INFO", "persistence", "Session map loaded", { count: sessionMap.size });
	} catch (error: unknown) {
		log("ERROR", "persistence", "Failed to load session map", {
			error: error instanceof Error ? error.message : String(error),
		});
		if (sessionMapPath && fs.existsSync(sessionMapPath)) {
			await fs.promises.rename(sessionMapPath, `${sessionMapPath}.corrupted.${Date.now()}`);
		}
	}
}

async function saveSessionMap(): Promise<void> {
	if (!sessionMapPath) return;
	try {
		const sessions: Record<string, SessionMappingPersisted> = {};
		for (const [opencodeSessionId, mapping] of sessionMap.entries()) {
			sessions[opencodeSessionId] = serializeSessionMapping(mapping);
		}
		const data: SessionMapFile = { version: 1, sessions, lastSaved: Date.now() };
		const tempPath = sessionMapPath + ".tmp";
		await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
		await fs.promises.rename(tempPath, sessionMapPath);
		log("DEBUG", "persistence", "Session map saved", { count: sessionMap.size });
	} catch (error: unknown) {
		log("ERROR", "persistence", "Failed to save session map", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function debouncedSaveSessionMap(): void {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveSessionMap().catch((error) => {
			log("ERROR", "persistence", "Debounced save failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}, 300);
}

export async function flushAndSave(): Promise<void> {
	if (saveTimer) {
		clearTimeout(saveTimer);
		await saveSessionMap();
	}
}

// ============================================================================
// Message Buffer
// ============================================================================

function mergeMessageContent(existing: string | undefined, incoming: string): string {
	const next = incoming.trim();
	if (!next) return existing ?? "";
	if (!existing) return next;
	if (next === existing) return existing;
	if (next.startsWith(existing)) return next;
	if (existing.startsWith(next)) return existing;
	if (next.includes(existing)) return next;
	if (existing.includes(next)) return existing;
	return `${existing}\n${next}`.trim();
}

export function upsertBufferedMessage(
	sessionId: string,
	messageId: string,
	updates: Partial<Pick<BufferedMessage, "role" | "content">>,
): void {
	const now = Date.now();

	if (now - lastBufferCleanupAt >= BUFFER_CLEANUP_INTERVAL_MS) {
		for (const [bufferedSessionId, bufferedMessages] of sessionMessageBuffer.entries()) {
			const freshMessages = bufferedMessages.filter((message) => now - message.timestamp <= BUFFERED_MESSAGE_TTL_MS);
			if (freshMessages.length === 0) {
				sessionMessageBuffer.delete(bufferedSessionId);
				continue;
			}
			if (freshMessages.length !== bufferedMessages.length)
				sessionMessageBuffer.set(bufferedSessionId, freshMessages);
		}
		lastBufferCleanupAt = now;
	}

	const existingBuffer = sessionMessageBuffer.get(sessionId) ?? [];
	const freshBuffer = existingBuffer.filter((message) => now - message.timestamp <= BUFFERED_MESSAGE_TTL_MS);

	let buffered = freshBuffer.find((message) => message.messageId === messageId);
	if (!buffered) {
		while (freshBuffer.length >= MAX_BUFFERED_MESSAGES_PER_SESSION) freshBuffer.shift();
		buffered = { messageId, timestamp: now };
		freshBuffer.push(buffered);
	} else buffered.timestamp = now;

	if (updates.role) buffered.role = updates.role;
	if (updates.content) buffered.content = mergeMessageContent(buffered.content, updates.content);

	sessionMessageBuffer.set(sessionId, freshBuffer);
}

export function cleanupOrphanedMessageBuffers(now: number): void {
	for (const [sessionId, buffer] of sessionMessageBuffer.entries()) {
		if (sessionMap.has(sessionId)) continue;
		const oldestMessage = buffer[0];
		if (!oldestMessage) {
			sessionMessageBuffer.delete(sessionId);
			continue;
		}
		if (now - oldestMessage.timestamp <= BUFFERED_MESSAGE_TTL_MS * 2) continue;
		log("INFO", "buffer", "Cleaning up orphaned message buffer", { session_id: sessionId });
		sessionMessageBuffer.delete(sessionId);
	}
}

// ============================================================================
// Session Lifecycle
// ============================================================================

/**
 * Create or connect to OpenViking session for a pi session.
 * Returns the OpenViking session ID or null on failure.
 */
export async function ensureOpenVikingSession(
	opencodeSessionId: string,
	config: OpenVikingConfig,
): Promise<string | null> {
	const existingMapping = sessionMap.get(opencodeSessionId);
	const knownSessionId = existingMapping?.ovSessionId;

	if (knownSessionId) {
		try {
			const response = await makeRequest<{ session_id: string }>(config, {
				method: "GET",
				endpoint: `/api/v1/sessions/${knownSessionId}`,
				timeoutMs: 5000,
			});
			const result = unwrapResponse(response);
			if (result) {
				log("INFO", "session", "Reconnected to persisted OpenViking session", {
					opencode_session: opencodeSessionId,
					openviking_session: knownSessionId,
				});
				return knownSessionId;
			}
		} catch (error: unknown) {
			log("INFO", "session", "Persisted OpenViking session unavailable, creating a new one", {
				opencode_session: opencodeSessionId,
				openviking_session: knownSessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	try {
		const createResponse = await makeRequest<{ session_id: string }>(config, {
			method: "POST",
			endpoint: "/api/v1/sessions",
			body: {},
			timeoutMs: 5000,
		});
		const sessionId = unwrapResponse(createResponse)?.session_id;
		if (!sessionId) throw new Error("OpenViking did not return a session_id");

		log("INFO", "session", "Created new OpenViking session", {
			opencode_session: opencodeSessionId,
			openviking_session: sessionId,
		});
		return sessionId;
	} catch (error: unknown) {
		log("ERROR", "session", "Failed to create OpenViking session", {
			opencode_session: opencodeSessionId,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export function createSessionMapping(opencodeSessionId: string, ovSessionId: string): SessionMapping {
	const mapping: SessionMapping = {
		ovSessionId,
		createdAt: Date.now(),
		capturedMessages: new Set(),
		messageRoles: new Map(),
		pendingMessages: new Map(),
		sendingMessages: new Set(),
	};
	sessionMap.set(opencodeSessionId, mapping);
	return mapping;
}

export function getSessionMapping(sessionId: string): SessionMapping | undefined {
	return sessionMap.get(sessionId);
}

export function removeSessionMapping(sessionId: string): void {
	sessionMap.delete(sessionId);
	sessionMessageBuffer.delete(sessionId);
}

// ============================================================================
// Message Handling
// ============================================================================

async function addMessageToSession(
	ovSessionId: string,
	role: "user" | "assistant",
	content: string,
	config: OpenVikingConfig,
): Promise<boolean> {
	try {
		const response = await makeRequest(config, {
			method: "POST",
			endpoint: `/api/v1/sessions/${ovSessionId}/messages`,
			body: { role, content },
			timeoutMs: 5000,
		});
		unwrapResponse(response);
		return true;
	} catch (error: unknown) {
		log("ERROR", "message", "Failed to add message to OpenViking session", {
			openviking_session: ovSessionId,
			role,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

export async function flushPendingMessages(
	opencodeSessionId: string,
	mapping: SessionMapping,
	config: OpenVikingConfig,
): Promise<void> {
	if (mapping.commitInFlight) return;

	for (const messageId of Array.from(mapping.pendingMessages.keys())) {
		if (mapping.capturedMessages.has(messageId) || mapping.sendingMessages.has(messageId)) continue;
		const role = mapping.messageRoles.get(messageId);
		const content = mapping.pendingMessages.get(messageId);
		if (!role || !content || !content.trim()) continue;

		mapping.sendingMessages.add(messageId);
		try {
			const success = await addMessageToSession(mapping.ovSessionId, role, content, config);
			if (success) {
				const latestContent = mapping.pendingMessages.get(messageId);
				if (latestContent && latestContent !== content) {
					log("DEBUG", "message", "Message changed during send; keeping latest content pending", {
						session_id: opencodeSessionId,
						message_id: messageId,
					});
				} else {
					mapping.capturedMessages.add(messageId);
					mapping.pendingMessages.delete(messageId);
					debouncedSaveSessionMap();
				}
			}
		} finally {
			mapping.sendingMessages.delete(messageId);
		}
	}
}

export function storeMessageRole(mapping: SessionMapping, messageId: string, role: "user" | "assistant"): void {
	if (!mapping.messageRoles.has(messageId)) {
		mapping.messageRoles.set(messageId, role);
	}
}

export function storePendingContent(mapping: SessionMapping, messageId: string, content: string): void {
	if (mapping.capturedMessages.has(messageId)) return;
	if (content && content.trim().length > 0) {
		mapping.pendingMessages.set(messageId, mergeMessageContent(mapping.pendingMessages.get(messageId), content));
	}
}

// ============================================================================
// Commit Operations
// ============================================================================

function clearCommitState(mapping: SessionMapping): void {
	mapping.commitInFlight = false;
	mapping.commitTaskId = undefined;
	mapping.commitStartedAt = undefined;
}

function isMissingCommitTaskError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return message.includes("resource not found") || message.includes("not found");
}

async function detectBackgroundCommitSupport(config: OpenVikingConfig): Promise<boolean> {
	if (backgroundCommitSupported !== null) return backgroundCommitSupported;
	const headers: Record<string, string> = {};
	if (config.apiKey) headers["X-API-Key"] = config.apiKey;
	try {
		const response = await fetch(`${config.endpoint}/api/v1/tasks?limit=1`, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(3000),
		});
		backgroundCommitSupported = response.ok;
	} catch {
		backgroundCommitSupported = false;
	}
	log(
		"INFO",
		"session",
		backgroundCommitSupported ? "Detected background commit API support" : "Detected legacy synchronous commit API",
	);
	return backgroundCommitSupported;
}

async function findRunningCommitTaskId(ovSessionId: string, config: OpenVikingConfig): Promise<string | undefined> {
	try {
		const response = await makeRequest<TaskResult[]>(config, {
			method: "GET",
			endpoint: `/api/v1/tasks?task_type=session_commit&resource_id=${encodeURIComponent(ovSessionId)}&limit=10`,
			timeoutMs: 5000,
		});
		const tasks = unwrapResponse(response) ?? [];
		const runningTask = tasks.find((task) => task.status === "pending" || task.status === "running");
		return runningTask?.task_id;
	} catch (error: unknown) {
		log("ERROR", "session", "Failed to query running commit tasks", {
			openviking_session: ovSessionId,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function finalizeCommitSuccess(
	mapping: SessionMapping,
	opencodeSessionId: string,
	config: OpenVikingConfig,
): Promise<void> {
	mapping.lastCommitTime = Date.now();
	mapping.capturedMessages.clear();
	clearCommitState(mapping);
	debouncedSaveSessionMap();

	await flushPendingMessages(opencodeSessionId, mapping, config);

	if (mapping.pendingCleanup) {
		removeSessionMapping(opencodeSessionId);
		await saveSessionMap();
		log("INFO", "session", "Cleaned up session mapping after commit completion", {
			openviking_session: mapping.ovSessionId,
			opencode_session: opencodeSessionId,
		});
	}
}

async function runSynchronousCommit(
	mapping: SessionMapping,
	opencodeSessionId: string,
	config: OpenVikingConfig,
	abortSignal?: AbortSignal,
): Promise<CommitResult> {
	mapping.commitInFlight = true;
	mapping.commitTaskId = undefined;
	mapping.commitStartedAt = Date.now();
	debouncedSaveSessionMap();

	try {
		const response = await makeRequest<CommitResult>(config, {
			method: "POST",
			endpoint: `/api/v1/sessions/${mapping.ovSessionId}/commit`,
			timeoutMs: Math.max(config.timeoutMs, COMMIT_TIMEOUT_MS),
			abortSignal,
		});
		const result = unwrapResponse(response);

		log("INFO", "session", "OpenViking synchronous commit completed", {
			openviking_session: mapping.ovSessionId,
			opencode_session: opencodeSessionId,
			memories_extracted: totalMemoriesFromResult(result),
		});

		await finalizeCommitSuccess(mapping, opencodeSessionId, config);
		return result;
	} catch (error: unknown) {
		clearCommitState(mapping);
		debouncedSaveSessionMap();
		throw error;
	}
}

export async function startBackgroundCommit(
	mapping: SessionMapping,
	opencodeSessionId: string,
	config: OpenVikingConfig,
	abortSignal?: AbortSignal,
): Promise<CommitStartResult | null> {
	if (mapping.commitInFlight && mapping.commitTaskId) {
		return { mode: "background", taskId: mapping.commitTaskId };
	}

	const supportsBackgroundCommit = await detectBackgroundCommitSupport(config);
	if (!supportsBackgroundCommit) {
		try {
			const result = await runSynchronousCommit(mapping, opencodeSessionId, config, abortSignal);
			return { mode: "completed", result };
		} catch (error: unknown) {
			log("ERROR", "session", "Failed to run synchronous commit", {
				openviking_session: mapping.ovSessionId,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	try {
		const response = await makeRequest<CommitResult>(config, {
			method: "POST",
			endpoint: `/api/v1/sessions/${mapping.ovSessionId}/commit?wait=false`,
			timeoutMs: 5000,
			abortSignal,
		});
		const data = unwrapResponse(response);
		const taskId = data?.task_id;
		if (!taskId) throw new Error("OpenViking did not return a background task id");

		mapping.commitInFlight = true;
		mapping.commitTaskId = taskId;
		mapping.commitStartedAt = Date.now();
		debouncedSaveSessionMap();

		log("INFO", "session", "OpenViking background commit accepted", {
			openviking_session: mapping.ovSessionId,
			task_id: taskId,
		});
		return { mode: "background", taskId };
	} catch (error: unknown) {
		const err = error as Error;
		if (err.message?.includes("already has a commit in progress")) {
			const taskId = await findRunningCommitTaskId(mapping.ovSessionId, config);
			if (taskId) {
				mapping.commitInFlight = true;
				mapping.commitTaskId = taskId;
				mapping.commitStartedAt = mapping.commitStartedAt ?? Date.now();
				debouncedSaveSessionMap();
				return { mode: "background", taskId };
			}
		}

		if (err.message?.includes("Request timeout") || err.message?.includes("background task id")) {
			backgroundCommitSupported = false;
			try {
				const result = await runSynchronousCommit(mapping, opencodeSessionId, config, abortSignal);
				return { mode: "completed", result };
			} catch (fallbackError: unknown) {
				log("ERROR", "session", "Failed to fall back to synchronous commit", {
					error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
				});
			}
		}

		log("ERROR", "session", "Failed to start OpenViking background commit", {
			error: err.message,
		});
		return null;
	}
}

export async function pollCommitTaskOnce(
	mapping: SessionMapping,
	opencodeSessionId: string,
	config: OpenVikingConfig,
): Promise<TaskResult["status"] | "unknown"> {
	if (!mapping.commitInFlight) return "unknown";

	if (!mapping.commitTaskId) {
		const recoveredTaskId = await findRunningCommitTaskId(mapping.ovSessionId, config);
		if (!recoveredTaskId) {
			clearCommitState(mapping);
			debouncedSaveSessionMap();
			return "unknown";
		}
		mapping.commitTaskId = recoveredTaskId;
		debouncedSaveSessionMap();
	}

	try {
		const response = await makeRequest<TaskResult>(config, {
			method: "GET",
			endpoint: `/api/v1/tasks/${mapping.commitTaskId}`,
			timeoutMs: 5000,
		});
		const task = unwrapResponse(response);

		if (task.status === "pending" || task.status === "running") return task.status;

		if (task.status === "completed") {
			log("INFO", "session", "OpenViking background commit completed", {
				task_id: task.task_id,
				memories_extracted: totalMemoriesFromResult(task.result),
			});
			await finalizeCommitSuccess(mapping, opencodeSessionId, config);
			return task.status;
		}

		log("ERROR", "session", "OpenViking background commit failed", {
			task_id: mapping.commitTaskId,
			error: task.error,
		});

		clearCommitState(mapping);
		debouncedSaveSessionMap();

		if (mapping.pendingCleanup) {
			removeSessionMapping(opencodeSessionId);
			await saveSessionMap();
		}

		return task.status;
	} catch (error: unknown) {
		if (isMissingCommitTaskError(error)) {
			clearCommitState(mapping);
			debouncedSaveSessionMap();
			return "unknown";
		}
		log("ERROR", "session", "Failed to poll OpenViking background commit", {
			task_id: mapping.commitTaskId,
			error: error instanceof Error ? error.message : String(error),
		});
		return "unknown";
	}
}

export async function waitForCommitCompletion(
	mapping: SessionMapping,
	opencodeSessionId: string,
	config: OpenVikingConfig,
	abortSignal?: AbortSignal,
	timeoutMs = COMMIT_TIMEOUT_MS,
): Promise<TaskResult | null> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (abortSignal?.aborted) throw new Error("Operation aborted");
		if (!mapping.commitInFlight) return null;
		if (!mapping.commitTaskId) {
			const recoveredTaskId = await findRunningCommitTaskId(mapping.ovSessionId, config);
			if (!recoveredTaskId) {
				clearCommitState(mapping);
				debouncedSaveSessionMap();
				return null;
			}
			mapping.commitTaskId = recoveredTaskId;
			debouncedSaveSessionMap();
		}

		try {
			const response = await makeRequest<TaskResult>(config, {
				method: "GET",
				endpoint: `/api/v1/tasks/${mapping.commitTaskId}`,
				timeoutMs: 5000,
				abortSignal,
			});
			const task = unwrapResponse(response);

			if (task.status === "completed") {
				await finalizeCommitSuccess(mapping, opencodeSessionId, config);
				return task;
			}
			if (task.status === "failed") {
				clearCommitState(mapping);
				debouncedSaveSessionMap();
				throw new Error(task.error || "Background commit failed");
			}

			await sleep(2000, abortSignal);
		} catch (error: unknown) {
			if (isMissingCommitTaskError(error)) {
				clearCommitState(mapping);
				debouncedSaveSessionMap();
				return null;
			}
			throw error;
		}
	}

	return null;
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			abortSignal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(new Error("Operation aborted"));
		}
		abortSignal?.addEventListener("abort", onAbort, { once: true });
	});
}

// ============================================================================
// Auto-Commit Scheduler
// ============================================================================

import { getAutoCommitIntervalMinutes } from "./config.js";

export function startAutoCommit(config: OpenVikingConfig) {
	if (autoCommitTimer) return;
	if (!config.autoCommit?.enabled) return;

	autoCommitTimer = setInterval(async () => {
		await checkAndCommitSessions(config);
	}, 60 * 1000);

	log("INFO", "auto-commit", "Auto-commit scheduler started", {
		commit_interval_minutes: getAutoCommitIntervalMinutes(config),
	});
}

export function stopAutoCommit() {
	if (autoCommitTimer) {
		clearInterval(autoCommitTimer);
		autoCommitTimer = null;
		log("INFO", "auto-commit", "Auto-commit scheduler stopped");
	}
}

async function checkAndCommitSessions(config: OpenVikingConfig): Promise<void> {
	const intervalMs = getAutoCommitIntervalMinutes(config) * 60 * 1000;
	const now = Date.now();

	cleanupOrphanedMessageBuffers(now);

	for (const [opencodeSessionId, mapping] of sessionMap.entries()) {
		if (mapping.commitInFlight) {
			await pollCommitTaskOnce(mapping, opencodeSessionId, config);
			continue;
		}

		if (mapping.pendingMessages.size > 0) {
			await flushPendingMessages(opencodeSessionId, mapping, config);
		}

		const timeSinceLastCommit = now - (mapping.lastCommitTime ?? mapping.createdAt);
		const hasNewMessages = mapping.capturedMessages.size > 0;

		if (timeSinceLastCommit >= intervalMs && hasNewMessages) {
			log("INFO", "auto-commit", "Triggering auto-commit", {
				opencode_session: opencodeSessionId,
				time_since_last_commit_minutes: Math.floor(timeSinceLastCommit / 60000),
			});
			await startBackgroundCommit(mapping, opencodeSessionId, config);
		}
	}
}

// ============================================================================
// Initialization
// ============================================================================

export function initFileSystem(pluginDir: string): void {
	const dir = ensurePluginDataDir(pluginDir);
	if (!dir) return;
	initLogger(dir);
	initSessionMapPath(dir);
}

export function resolveSessionId(ctx: {
	sessionManager: { getSessionFile?: () => string | undefined };
}): string | undefined {
	return ctx.sessionManager?.getSessionFile?.() ?? undefined;
}
