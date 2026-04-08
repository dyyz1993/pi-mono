/**
 * L0: Tool Result Persistence
 *
 * Large tool results are written to disk and replaced with lightweight stubs.
 * This reduces context token usage without data loss - the full result can be
 * read back from disk if needed.
 */

import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import * as nodePath from "node:path";
import {
	DEFAULT_CACHE_DIR,
	DEFAULT_LARGE_THRESHOLD,
	DEFAULT_PERSISTENCE_CONFIG,
	DEFAULT_STUB_PREVIEW_SIZE,
	type PersistedResult,
	type PersistenceConfig,
	type ToolResultInfo,
} from "./types.js";

// ============================================================================
// Internal state for stats tracking
// ============================================================================

let stats: { totalPersisted: number; totalBytesSaved: number; fileCount: number } = {
	totalPersisted: 0,
	totalBytesSaved: 0,
	fileCount: 0,
};

const persistedFiles = new Map<string, { toolName: string; size: number; timestamp: number }>();

export function resetStats(): void {
	stats = { totalPersisted: 0, totalBytesSaved: 0, fileCount: 0 };
	persistedFiles.clear();
}

export function getPersistenceStats(): { totalPersisted: number; totalBytesSaved: number; fileCount: number } {
	return { ...stats };
}

// ============================================================================
// Core: persistIfNeeded
// ============================================================================

/**
 * Check if a tool result should be persisted, and if so, write to disk
 * and return a stub. Otherwise return the original content unchanged.
 */
export async function persistIfNeeded(
	info: ToolResultInfo,
	config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG,
): Promise<PersistedResult> {
	const { toolName, content } = info;
	const originalSize = Buffer.byteLength(content, "utf-8");

	// Empty content: never persist
	if (originalSize === 0) {
		return { stub: content, filePath: "", originalSize: 0, persisted: false };
	}

	// Exempt tools: never persist (avoids read→save→read loop)
	if (config.exemptTools.has(toolName.toLowerCase())) {
		return { stub: content, filePath: "", originalSize, persisted: false };
	}

	// Below or at threshold: don't persist (strict >, not >=)
	if (originalSize <= config.largeThreshold) {
		return { stub: content, filePath: "", originalSize, persisted: false };
	}

	// Above threshold: persist to disk
	return await doPersist(toolName, content, originalSize, config);
}

async function doPersist(
	toolName: string,
	content: string,
	originalSize: number,
	config: PersistenceConfig,
): Promise<PersistedResult> {
	// Ensure cache directory exists
	const cacheDir = config.cacheDir;
	try {
		mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
	} catch {
		// Cannot create directory - fall back to truncated content
		const fallbackStub = createFallbackStub(toolName, content, originalSize, config);
		return { ...fallbackStub, persisted: false };
	}

	// Generate unique filename
	const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const fileName = `${toolName}-${fileId.slice(0, 8)}.txt`;
	const filePath = nodePath.join(cacheDir, fileName);

	try {
		await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });

		// Track the file for cleanup/stats
		persistedFiles.set(filePath, { toolName, size: originalSize, timestamp: Date.now() });

		// Create stub with preview + metadata
		const stub = createStub(toolName, filePath, content, originalSize, config);

		// Update stats
		const stubSize = Buffer.byteLength(stub, "utf-8");
		stats.totalPersisted++;
		stats.fileCount++;
		stats.totalBytesSaved += originalSize - stubSize;

		return { stub, filePath, originalSize, persisted: true };
	} catch {
		// Write failed - fall back to truncated content
		const fallbackStub = createFallbackStub(toolName, content, originalSize, config);
		return { ...fallbackStub, persisted: false };
	}
}

// ============================================================================
// Stub creation
// ============================================================================

function createStub(
	toolName: string,
	filePath: string,
	content: string,
	originalSize: number,
	config: PersistenceConfig,
): string {
	const previewBytes = config.stubPreviewSize;
	// Take preview from beginning of content
	const preview = content.slice(0, previewBytes);
	const sizeStr = formatSize(originalSize);

	return [
		`[${toolName.toUpperCase()} output saved to disk]`,
		`Path: ${filePath}`,
		`Original size: ${sizeStr}`,
		`--- Preview (first ${formatSize(previewBytes)}) ---`,
		preview,
		preview.length < content.length ? "\n... [truncated - use readPersistedFile() for full content]" : "",
	].join("\n");
}

function createFallbackStub(
	toolName: string,
	content: string,
	originalSize: number,
	config: PersistenceConfig,
): { stub: string; filePath: string; originalSize: number } {
	// When we can't persist, truncate to a reasonable size instead
	const maxSize = config.stubPreviewSize;
	const truncated = content.slice(0, maxSize);
	const sizeStr = formatSize(originalSize);

	const stub = [
		`[${toolName.toUpperCase()} output - could not persist to disk]`,
		`Original size: ${sizeStr}`,
		`--- Truncated output ---`,
		truncated,
		truncated.length < content.length ? "\n... [truncated]" : "",
	].join("\n");

	return { stub, filePath: "", originalSize };
}

// ============================================================================
// File reading
// ============================================================================

/**
 * Read a persisted file back from disk.
 * Returns null if the file doesn't exist or cannot be read.
 */
export async function readPersistedFile(filePath: string): Promise<string | null> {
	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		return content;
	} catch {
		return null;
	}
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Remove persisted files older than maxAgeMs.
 * Returns the number of files removed.
 */
export async function cleanupOldFiles(
	config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG,
	maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
	const now = Date.now();
	const toRemove: string[] = [];

	for (const [filePath, meta] of persistedFiles) {
		if (now - meta.timestamp >= maxAgeMs) {
			toRemove.push(filePath);
		}
	}

	let removed = 0;
	for (const filePath of toRemove) {
		try {
			await fs.promises.unlink(filePath);
			persistedFiles.delete(filePath);
			removed++;
			stats.fileCount--;
		} catch {
			// File already gone or permission error - skip
		}
	}

	return removed;
}

// ============================================================================
// Helpers
// ============================================================================

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
