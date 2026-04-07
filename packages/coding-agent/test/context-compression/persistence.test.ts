import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_LARGE_THRESHOLD,
	DEFAULT_PERSISTENCE_CONFIG,
	DEFAULT_STUB_PREVIEW_SIZE,
	type PersistedResult,
	type PersistenceConfig,
	type ToolResultInfo,
} from "../../src/core/context-compression/types.js";

// Import the module under test (will fail until implemented)
// We use require() here to allow vitest to resolve the .ts via jiti
let persistIfNeeded: (info: ToolResultInfo, config?: PersistenceConfig) => Promise<PersistedResult>;
let readPersistedFile: (filePath: string) => Promise<string | null>;
let cleanupOldFiles: (config: PersistenceConfig, maxAgeMs?: number) => Promise<number>;
let getPersistenceStats: () => { totalPersisted: number; totalBytesSaved: number; fileCount: number };
let resetStats: () => void;

try {
	const mod = await import("../../src/core/context-compression/persistence.js");
	persistIfNeeded = mod.persistIfNeeded;
	readPersistedFile = mod.readPersistedFile;
	cleanupOldFiles = mod.cleanupOldFiles;
	getPersistenceStats = mod.getPersistenceStats;
	resetStats = mod.resetStats;
} catch {
	// Module not yet implemented - tests will fail with clear error
	persistIfNeeded = async () => {
		throw new Error("persistence.ts not implemented yet");
	};
	readPersistedFile = async () => {
		throw new Error("persistence.ts not implemented yet");
	};
	cleanupOldFiles = async () => 0;
	getPersistenceStats = () => ({ totalPersisted: 0, totalBytesSaved: 0, fileCount: 0 });
	resetStats = () => {};
}

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
	return mkdtempSync("pi-persist-test-");
}

function createLargeContent(sizeBytes: number): string {
	// Create content of exact byte size (ASCII for predictability)
	const line = "A".repeat(99) + "\n"; // 100 bytes per line
	const linesNeeded = Math.ceil(sizeBytes / 100);
	return line.repeat(linesNeeded).slice(0, sizeBytes);
}

function createConfig(overrides?: Partial<PersistenceConfig> & { cacheDir?: string }): PersistenceConfig {
	return {
		...DEFAULT_PERSISTENCE_CONFIG,
		...overrides,
		cacheDir: overrides?.cacheDir ?? DEFAULT_PERSISTENCE_CONFIG.cacheDir,
		exemptTools: new Set([...DEFAULT_PERSISTENCE_CONFIG.exemptTools, ...(overrides?.exemptTools ?? [])]),
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("L0: Tool Result Persistence", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
		resetStats?.();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// 1. Small result does NOT trigger persistence
	// -----------------------------------------------------------------------
	it("should NOT persist small results (under threshold)", async () => {
		const content = createLargeContent(5 * 1024); // 5KB
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		expect(result.persisted).toBe(false);
		expect(result.stub).toBe(content);
		expect(result.filePath).toBe("");
		expect(result.originalSize).toBe(5 * 1024);
	});

	// -----------------------------------------------------------------------
	// 2. Large result triggers persistence
	// -----------------------------------------------------------------------
	it("should persist large results and return stub", async () => {
		const content = createLargeContent(60 * 1024); // 60KB
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		expect(result.persisted).toBe(true);
		expect(result.originalSize).toBe(60 * 1024);
		// Stub should be smaller than original
		expect(Buffer.byteLength(result.stub, "utf-8")).toBeLessThan(result.originalSize);
		// Stub should contain file path reference
		expect(result.stub).toContain(result.filePath);
		// File should exist on disk
		const diskContent = await readPersistedFile(result.filePath);
		expect(diskContent).toBe(content);
	});

	// -----------------------------------------------------------------------
	// 3. Read tool is exempt from persistence
	// -----------------------------------------------------------------------
	it("should NOT persist results from exempt tools (read/cat/view)", async () => {
		const content = createLargeContent(100 * 1024); // 100KB
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "read", content }, config);

		expect(result.persisted).toBe(false);
		expect(result.stub).toBe(content);
	});

	it("should NOT persist 'cat' tool results", async () => {
		const content = createLargeContent(100 * 1024);
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "cat", content }, config);

		expect(result.persisted).toBe(false);
	});

	// -----------------------------------------------------------------------
	// 4. Extra-large result gets precise truncation in stub
	// -----------------------------------------------------------------------
	it("should include preview + path in stub for extra-large results", async () => {
		const content = createLargeContent(500 * 1024); // 500KB
		const config = createConfig({
			cacheDir: tempDir,
			stubPreviewSize: 2 * 1024, // 2KB preview
		});

		const result = await persistIfNeeded({ toolName: "grep", content }, config);

		expect(result.persisted).toBe(true);
		// Stub size should be roughly the preview size + metadata
		const stubSize = Buffer.byteLength(result.stub, "utf-8");
		expect(stubSize).toBeLessThan(4 * 1024); // preview + some metadata
		// Must contain tool name
		expect(result.stub).toContain("grep");
		// Must contain file path
		expect(result.stub).toContain(result.filePath);
		// Must contain original size info
		expect(result.stub).toContain("500"); // KB indicator
	});

	// -----------------------------------------------------------------------
	// 5. Persisted file can be read back with identical content
	// -----------------------------------------------------------------------
	it("should allow reading persisted file back with exact original content", async () => {
		const original = "Line 1\nLine 2\nLine 3\n" + "x".repeat(60 * 1024);
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content: original }, config);

		expect(result.persisted).toBe(true);
		const restored = await readPersistedFile(result.filePath);
		expect(restored).toBe(original);
	});

	// -----------------------------------------------------------------------
	// 6. Concurrent persistence produces independent files
	// -----------------------------------------------------------------------
	it("should handle concurrent persistence without conflicts", async () => {
		const config = createConfig({ cacheDir: tempDir });

		const results = await Promise.all([
			persistIfNeeded({ toolName: "bash", content: createLargeContent(60 * 1024) }, config),
			persistIfNeeded({ toolName: "grep", content: createLargeContent(70 * 1024) }, config),
			persistIfNeeded({ toolName: "find", content: createLargeContent(80 * 1024) }, config),
		]);

		// All should have persisted
		for (const r of results) {
			expect(r.persisted).toBe(true);
		}

		// Each should have a unique file path
		const paths = results.map((r) => r.filePath);
		expect(new Set(paths).size).toBe(3);

		// Each file should contain its own correct content
		for (const r of results) {
			const content = await readPersistedFile(r.filePath);
			expect(content!.length).toBe(r.originalSize);
		}
	});

	// -----------------------------------------------------------------------
	// 7. Invalid/unwritable directory falls back gracefully
	// -----------------------------------------------------------------------
	it("should fall back to truncation when cache dir is unwritable", async () => {
		const content = createLargeContent(60 * 1024);
		// Use a non-existent path that can't be created
		const config = createConfig({ cacheDir: "/proc/nonexistent/invalid/path" });

		// Should not throw - should return a fallback result
		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		// At minimum it shouldn't crash; behavior depends on implementation
		// It may return persisted=false with truncated content, or persisted=true if it creates dir
		expect(result.originalSize).toBe(60 * 1024);
		expect(result.stub.length).toBeGreaterThan(0);
	});

	// -----------------------------------------------------------------------
	// 8. Unicode / Chinese content persists correctly
	// -----------------------------------------------------------------------
	it("should handle Chinese/Unicode content without corruption", async () => {
		// Generate 60KB of Chinese text
		const chineseLine = "这是中文测试内容，包含各种字符：abc123！@#￥%\n";
		const repeatCount = Math.ceil((60 * 1024) / Buffer.byteLength(chineseLine, "utf-8"));
		const content = chineseLine.repeat(repeatCount).slice(0, 60 * 1024);

		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		expect(result.persisted).toBe(true);
		const restored = await readPersistedFile(result.filePath);
		expect(restored).toBe(content);
		expect(restored).toContain("中文测试");
	});

	// -----------------------------------------------------------------------
	// 9. Empty content handling
	// -----------------------------------------------------------------------
	it("should not trigger persistence for empty content", async () => {
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content: "" }, config);

		expect(result.persisted).toBe(false);
		expect(result.stub).toBe("");
	});

	// -----------------------------------------------------------------------
	// 10. Exactly at threshold boundary - NO persistence
	// -----------------------------------------------------------------------
	it("should NOT persist content exactly at threshold (=50KB)", async () => {
		const content = createLargeContent(DEFAULT_LARGE_THRESHOLD); // exactly 50KB
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		expect(result.persisted).toBe(false);
		expect(result.stub).toBe(content);
	});

	// -----------------------------------------------------------------------
	// 11. One byte over threshold triggers persistence
	// -----------------------------------------------------------------------
	it("should persist content one byte over threshold (50KB+1)", async () => {
		const content = createLargeContent(DEFAULT_LARGE_THRESHOLD + 1);
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "bash", content }, config);

		expect(result.persisted).toBe(true);
		expect(result.originalSize).toBe(DEFAULT_LARGE_THRESHOLD + 1);
	});

	// -----------------------------------------------------------------------
	// 12. Custom threshold overrides default
	// -----------------------------------------------------------------------
	it("should respect custom threshold configuration", async () => {
		const smallContent = createLargeContent(10 * 1024); // 10KB
		const config = createConfig({
			cacheDir: tempDir,
			largeThreshold: 5 * 1024, // custom: 5KB
		});

		const result = await persistIfNeeded({ toolName: "bash", content: smallContent }, config);

		// 10KB > 5KB custom threshold → should persist
		expect(result.persisted).toBe(true);
	});

	// -----------------------------------------------------------------------
	// 13. Cleanup removes expired files
	// -----------------------------------------------------------------------
	it("should clean up expired persisted files", async () => {
		const config = createConfig({ cacheDir: tempDir });

		// Persist a file
		const result = await persistIfNeeded({ toolName: "bash", content: createLargeContent(60 * 1024) }, config);
		expect(result.persisted).toBe(true);

		// Clean up with 0 maxAge (everything expired)
		const removed = await cleanupOldFiles(config, 0);
		expect(removed).toBeGreaterThanOrEqual(1);

		// File should be gone
		const gone = await readPersistedFile(result.filePath);
		expect(gone).toBeNull();
	});

	// -----------------------------------------------------------------------
	// 14. Stub format validation
	// -----------------------------------------------------------------------
	it("should produce stubs with consistent format containing tool name, size, and path", async () => {
		const content = createLargeContent(60 * 1024);
		const config = createConfig({ cacheDir: tempDir });

		const result = await persistIfNeeded({ toolName: "my-custom-tool", content }, config);

		expect(result.persisted).toBe(true);
		// Format: [toolName output saved to path] or similar
		expect(result.stub).toMatch(/my-custom-tool/i);
		expect(result.stub).toContain(result.filePath);
		// Should indicate original size
		expect(result.stub).toMatch(/\d+\s*(KB|MB|B)/i);
	});

	// -----------------------------------------------------------------------
	// 15. Stats tracking accuracy
	// -----------------------------------------------------------------------
	it("should track persistence statistics accurately", async () => {
		const config = createConfig({ cacheDir: tempDir });

		// Initial stats
		let stats = getPersistenceStats();
		expect(stats.totalPersisted).toBe(0);
		expect(stats.fileCount).toBe(0);
		expect(stats.totalBytesSaved).toBe(0);

		// Persist 3 files
		const r1 = await persistIfNeeded({ toolName: "bash", content: createLargeContent(60 * 1024) }, config);
		const r2 = await persistIfNeeded({ toolName: "grep", content: createLargeContent(80 * 1024) }, config);
		const r3 = await persistIfNeeded({ toolName: "find", content: createLargeContent(55 * 1024) }, config);

		stats = getPersistenceStats();
		expect(stats.totalPersisted).toBe(3);
		expect(stats.fileCount).toBe(3);
		// totalBytesSaved should be positive (sum of originalSize - stubSize)
		expect(stats.totalBytesSaved).toBeGreaterThan(0);
	});
});
