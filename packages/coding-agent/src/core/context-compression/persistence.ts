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
	DEFAULT_PERSISTENCE_CONFIG,
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

const persistedFiles = new Map<string, { toolName: string; size: number; timestamp: number; maxAgeMs: number }>();

export function resetStats(): void {
	stats = { totalPersisted: 0, totalBytesSaved: 0, fileCount: 0 };
	persistedFiles.clear();
}

export function getPersistenceStats(): { totalPersisted: number; totalBytesSaved: number; fileCount: number } {
	return { ...stats };
}

export function snapshotStats(): { totalPersisted: number; totalBytesSaved: number; fileCount: number } {
	return { ...stats };
}

export function rollbackStats(snapshot: { totalPersisted: number; totalBytesSaved: number; fileCount: number }): void {
	stats = { ...snapshot };
}

// ============================================================================
// Core: persistIfNeeded
// ============================================================================

export async function persistIfNeeded(
	info: ToolResultInfo,
	config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG,
): Promise<PersistedResult> {
	const { toolName, content, maxAgeMs } = info;
	const originalSize = Buffer.byteLength(content, "utf-8");

	if (originalSize === 0) {
		return { stub: content, filePath: "", originalSize: 0, persisted: false };
	}

	if (config.exemptTools.has(toolName.toLowerCase())) {
		return { stub: content, filePath: "", originalSize, persisted: false };
	}

	if (originalSize <= config.largeThreshold) {
		return { stub: content, filePath: "", originalSize, persisted: false };
	}

	return await doPersist(toolName, content, originalSize, config, maxAgeMs);
}

async function doPersist(
	toolName: string,
	content: string,
	originalSize: number,
	config: PersistenceConfig,
	maxAgeMsOverride?: number,
): Promise<PersistedResult> {
	const cacheDir = config.cacheDir;
	try {
		mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
	} catch {
		const fallbackStub = createFallbackStub(toolName, content, originalSize, config);
		return { ...fallbackStub, persisted: false };
	}

	const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const fileName = `${toolName}-${fileId.slice(0, 8)}.txt`;
	const filePath = nodePath.join(cacheDir, fileName);
	const maxAge = (maxAgeMsOverride ?? config.cacheDir) ? 7 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

	try {
		await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });

		persistedFiles.set(filePath, {
			toolName,
			size: originalSize,
			timestamp: Date.now(),
			maxAgeMs: maxAge,
		});

		const stub = createStub(toolName, filePath, content, originalSize, config);

		const stubSize = Buffer.byteLength(stub, "utf-8");
		stats.totalPersisted++;
		stats.fileCount++;
		stats.totalBytesSaved += originalSize - stubSize;

		return { stub, filePath, originalSize, persisted: true };
	} catch {
		const fallbackStub = createFallbackStub(toolName, content, originalSize, config);
		return { ...fallbackStub, persisted: false };
	}
}

function createStub(
	toolName: string,
	filePath: string,
	content: string,
	originalSize: number,
	config: PersistenceConfig,
): string {
	const previewBytes = config.stubPreviewSize;
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

export async function readPersistedFile(filePath: string): Promise<string | null> {
	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		return content;
	} catch {
		return null;
	}
}

export async function cleanupOldFiles(
	_config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG,
	globalMaxAgeMs?: number,
): Promise<number> {
	const now = Date.now();
	const toRemove: string[] = [];

	persistedFiles.forEach((meta, filePath) => {
		const maxAge = meta.maxAgeMs ?? globalMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
		if (now - meta.timestamp >= maxAge) {
			toRemove.push(filePath);
		}
	});

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

export async function cleanupOrphanedFiles(
	config: PersistenceConfig = DEFAULT_PERSISTENCE_CONFIG,
	maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
	const now = Date.now();
	let removed = 0;

	try {
		const entries = await fs.promises.readdir(config.cacheDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;

			const filePath = nodePath.join(config.cacheDir, entry.name);

			if (persistedFiles.has(filePath)) continue;

			try {
				const stat = await fs.promises.stat(filePath);
				if (now - stat.mtimeMs >= maxAgeMs) {
					await fs.promises.unlink(filePath);
					removed++;
				}
			} catch {
				// Can't stat or unlink - skip
			}
		}
	} catch {
		// Directory doesn't exist or can't read - nothing to clean
	}

	return removed;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
