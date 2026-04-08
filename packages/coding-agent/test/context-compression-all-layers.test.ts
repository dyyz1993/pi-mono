/**
 * Integration tests for Context Compression - All Layers
 *
 * Tests L0/L1/L2/L3 and Scoring with real compressContext() implementation.
 * Uses mocked persistence to avoid filesystem dependencies.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressContext } from "../src/core/context-compression/index.js";
import {
	type CompressionPipelineConfig,
	DEFAULT_LIFECYCLE_CONFIG,
	DEFAULT_PERSISTENCE_CONFIG,
	DEFAULT_SUMMARY_CONFIG,
} from "../src/core/context-compression/types.js";

// ============================================================================
// Mock persistence to isolate compression logic from filesystem
// ============================================================================

vi.mock("../src/core/context-compression/persistence.js", () => {
	return {
		resetStats: vi.fn(),
		getPersistenceStats: vi.fn().mockReturnValue({ totalPersisted: 0, totalBytesSaved: 0, fileCount: 0 }),
		snapshotStats: vi.fn().mockReturnValue({ totalPersisted: 0, totalBytesSaved: 0, fileCount: 0 }),
		rollbackStats: vi.fn(),
		persistIfNeeded: vi.fn().mockImplementation(async (info: { content: string; toolName: string }) => {
			return {
				stub: `[${info.toolName.toUpperCase()} output saved to disk]`,
				filePath: `/tmp/pi-cc-test/${info.toolName}.txt`,
				originalSize: info.content.length,
				persisted: true,
			};
		}),
		cleanupOldFiles: vi.fn().mockResolvedValue(0),
		cleanupOrphanedFiles: vi.fn().mockResolvedValue(0),
		readPersistedFile: vi.fn().mockResolvedValue(null),
	};
});

vi.mock("../src/core/context-compression/logger.js", () => ({
	compressionLogger: {
		startSession: vi.fn(),
		endSession: vi.fn(),
		logToolResultDecision: vi.fn(),
		logCompressionStep: vi.fn(),
		logError: vi.fn(),
		logIntent: vi.fn(),
		logPersistence: vi.fn(),
		logLifecycle: vi.fn(),
		logSummary: vi.fn(),
		setEnabled: vi.fn(),
		isEnabled: vi.fn().mockReturnValue(false),
		getLogDir: vi.fn().mockReturnValue("/tmp/pi-test-logs"),
	},
}));

// ============================================================================
// Test Configuration
// ============================================================================

function makeConfig(overrides: Partial<CompressionPipelineConfig> = {}): CompressionPipelineConfig {
	const defaults: CompressionPipelineConfig = {
		persistence: { ...DEFAULT_PERSISTENCE_CONFIG, largeThreshold: 5 * 1024 },
		lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG, keepRecent: 2, staleMinutes: 60 },
		summary: { ...DEFAULT_SUMMARY_CONFIG, enabled: true },
		classifier: { enabled: true },
		scoring: { enabled: false },
		enabled: true,
	};

	if (overrides.persistence) defaults.persistence = { ...defaults.persistence, ...overrides.persistence };
	if (overrides.lifecycle) defaults.lifecycle = { ...defaults.lifecycle, ...overrides.lifecycle };
	if (overrides.summary) defaults.summary = { ...defaults.summary, ...overrides.summary };
	if (overrides.classifier) defaults.classifier = { ...defaults.classifier, ...overrides.classifier };
	if (overrides.scoring) defaults.scoring = { ...defaults.scoring, ...overrides.scoring };
	if (overrides.enabled !== undefined) defaults.enabled = overrides.enabled;

	return defaults;
}

// ============================================================================
// Helper Functions
// ============================================================================

function createUserMsg(content: string): AgentMessage {
	return { role: "user", content };
}

function createAssistantMsg(content: string): AgentMessage {
	return { role: "assistant", content };
}

function createToolResult(toolName: string, content: string, timestamp?: number): AgentMessage {
	return {
		role: "tool",
		toolName: toolName,
		content,
		tool_call_id: `call_${toolName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		timestamp: timestamp ?? Date.now(),
	} as unknown as AgentMessage;
}

function createLargeContent(kb: number): string {
	const base = "x".repeat(1024);
	return base.repeat(kb);
}

function createManyToolResults(
	toolName: string,
	count: number,
	contentTemplate: (i: number) => string,
): AgentMessage[] {
	const results: AgentMessage[] = [];
	for (let i = 0; i < count; i++) {
		results.push(createToolResult(toolName, contentTemplate(i)));
	}
	return results;
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Context Compression - All Layers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ==========================================================================
	// L0: Persistence Tests
	// ==========================================================================

	describe("L0: Persistence", () => {
		it("should record persistence step when tool result exceeds threshold", async () => {
			const largeContent = createLargeContent(60);
			const messages: AgentMessage[] = [
				createUserMsg("show file"),
				createAssistantMsg("reading..."),
				createToolResult("bash", largeContent),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.persistence).toBeDefined();
			expect(result.steps.persistence!.persistedCount).toBeGreaterThan(0);
			expect(result.steps.persistence!.bytesSaved).toBeGreaterThan(0);
		});

		it("should NOT record persistence step when all results are small", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", "small output"),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.persistence).toBeUndefined();
		});

		it("should persist multiple large tool results in one call", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("check files"),
				createAssistantMsg("checking..."),
				createToolResult("bash", createLargeContent(20)),
				createToolResult("bash", createLargeContent(15)),
				createToolResult("bash", createLargeContent(10)),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.persistence).toBeDefined();
			expect(result.steps.persistence!.persistedCount).toBe(3);
		});
	});

	// ==========================================================================
	// L1: Lifecycle Count Tests
	// ==========================================================================

	describe("L1: Lifecycle Count", () => {
		it("should record lifecycle cleared count when entries exceed keepRecent*2 (excess path)", async () => {
			const results = createManyToolResults("bash", 10, () => "output line");
			const messages: AgentMessage[] = [createUserMsg("debug a bug"), createAssistantMsg("working"), ...results];

			const result = await compressContext(messages, makeConfig({ classifier: { enabled: false } }));

			expect(result.steps.lifecycle).toBeDefined();
			expect(result.steps.lifecycle!.clearedCount).toBeGreaterThan(0);
		});

		it("should record degraded+cleared count when entries are under clearThreshold", async () => {
			const results = createManyToolResults("bash", 3, () => "output");
			const messages: AgentMessage[] = [createUserMsg("debug a bug"), createAssistantMsg("working"), ...results];

			const result = await compressContext(messages, makeConfig({ classifier: { enabled: false }, lifecycle: { keepRecent: 1 } }));

			expect(result.steps.lifecycle).toBeDefined();
			expect(result.steps.lifecycle!.degradedCount + result.steps.lifecycle!.clearedCount).toBeGreaterThan(0);
		});

		it("should NOT degrade when entries are under keepRecent", async () => {
			const results = createManyToolResults("bash", 1, () => "output");
			const messages: AgentMessage[] = [createUserMsg("task"), createAssistantMsg("working"), ...results];

			const result = await compressContext(messages, makeConfig({ lifecycle: { keepRecent: 5 } }));

			if (result.steps.lifecycle) {
				expect(result.steps.lifecycle.degradedCount).toBe(0);
			}
		});
	});

	// ==========================================================================
	// L2: Lifecycle Time Tests
	// ==========================================================================

	describe("L2: Lifecycle Time", () => {
		it("should record cleared count for stale tool results", async () => {
			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			const messages: AgentMessage[] = [
				createUserMsg("old task"),
				createAssistantMsg("working"),
				createToolResult("bash", "old output", twoHoursAgo),
				createToolResult("bash", "old output 2", twoHoursAgo),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.lifecycle).toBeDefined();
			expect(result.steps.lifecycle!.clearedCount).toBeGreaterThan(0);
		});

		it("should NOT record cleared count for recent tool results", async () => {
			const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
			const messages: AgentMessage[] = [
				createUserMsg("recent task"),
				createAssistantMsg("working"),
				createToolResult("bash", "recent output", fiveMinutesAgo),
			];

			const result = await compressContext(messages, makeConfig());

			if (result.steps.lifecycle) {
				expect(result.steps.lifecycle.clearedCount).toBe(0);
			}
		});
	});

	// ==========================================================================
	// L3: Summary Tests
	// ==========================================================================

	describe("L3: Summary", () => {
		it("should summarize grep results", async () => {
			const largeGrepOutput = Array(40).fill("file.ts:10: match line").join("\n");
			const messages: AgentMessage[] = [
				createUserMsg("find stuff"),
				createAssistantMsg("grepping..."),
				createToolResult("grep", largeGrepOutput),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.summary).toBeDefined();
			expect(result.steps.summary!.summarizedCount).toBeGreaterThan(0);
		});

		it("should summarize glob results", async () => {
			const largeGlobOutput = Array(50).fill("src/components/Button.tsx").join("\n");
			const messages: AgentMessage[] = [
				createUserMsg("find files"),
				createAssistantMsg("globbing..."),
				createToolResult("glob", largeGlobOutput),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.summary).toBeDefined();
			expect(result.steps.summary!.summarizedCount).toBeGreaterThan(0);
		});

		it("should NOT summarize when summary is disabled", async () => {
			const largeGrepOutput = Array(40).fill("match").join("\n");
			const messages: AgentMessage[] = [
				createUserMsg("find"),
				createAssistantMsg("..."),
				createToolResult("grep", largeGrepOutput),
			];

			const result = await compressContext(messages, makeConfig({ summary: { enabled: false } }));

			expect(result.steps.summary).toBeUndefined();
		});
	});

	// ==========================================================================
	// Combined Pipeline Tests
	// ==========================================================================

	describe("Combined Pipeline", () => {
		it("should trigger all active layers in one run", async () => {
			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			const messages: AgentMessage[] = [
				createUserMsg("complex task"),
				createAssistantMsg("working..."),
				createToolResult("bash", createLargeContent(60)),
				createToolResult("grep", Array(40).fill("match").join("\n")),
				createToolResult("bash", "old output", twoHoursAgo),
				createToolResult("bash", "old output 2", twoHoursAgo),
				...createManyToolResults("bash", 10, () => "output"),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.steps.persistence).toBeDefined();
			expect(result.steps.lifecycle).toBeDefined();
			expect(result.steps.summary).toBeDefined();
		});

		it("should reduce token count after compression", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("task"),
				createAssistantMsg("working"),
				createToolResult("bash", createLargeContent(60)),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
		});

		it("should return all messages even after compression", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("task"),
				createAssistantMsg("working"),
				createToolResult("bash", "some output"),
			];

			const result = await compressContext(messages, makeConfig());

			expect(result.messages.length).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// Scoring System Tests
	// ==========================================================================

	describe("Scoring System", () => {
		it("should use scoring instead of legacy pipeline when enabled", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("task"),
				createAssistantMsg("working"),
				createToolResult("bash", createLargeContent(60)),
			];

			const config: CompressionPipelineConfig = {
				persistence: { ...DEFAULT_PERSISTENCE_CONFIG, largeThreshold: 5 * 1024 },
				lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG },
				summary: { ...DEFAULT_SUMMARY_CONFIG },
				classifier: { enabled: true },
				scoring: { enabled: true },
				enabled: true,
			};

			const result = await compressContext(messages, config);

			expect(result.steps.scoring).toBeDefined();
		});

		it("should categorize write/edit results as persist in scoring", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("create file"),
				createAssistantMsg("writing..."),
				createToolResult("write", "const x = 1;"),
				createToolResult("edit", "const y = 2;"),
			];

			const config: CompressionPipelineConfig = {
				persistence: { ...DEFAULT_PERSISTENCE_CONFIG, largeThreshold: 5 * 1024 },
				lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG },
				summary: { ...DEFAULT_SUMMARY_CONFIG },
				classifier: { enabled: false },
				scoring: { enabled: true },
				enabled: true,
			};

			const result = await compressContext(messages, config);

			expect(result.steps.scoring).toBeDefined();
			expect(result.steps.scoring!.persistCount).toBeGreaterThan(0);
		});

		it("should categorize old ls results as drop in scoring", async () => {
			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			const messages: AgentMessage[] = [
				createUserMsg("list files"),
				createAssistantMsg("listing..."),
				createToolResult("ls", "file1.ts\nfile2.ts\nfile3.ts", twoHoursAgo),
			];

			const config: CompressionPipelineConfig = {
				persistence: { ...DEFAULT_PERSISTENCE_CONFIG },
				lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG, staleMinutes: 60 },
				summary: { ...DEFAULT_SUMMARY_CONFIG },
				classifier: { enabled: false },
				scoring: { enabled: true },
				enabled: true,
			};

			const result = await compressContext(messages, config);

			expect(result.steps.scoring).toBeDefined();
			expect(result.steps.scoring!.dropCount).toBeGreaterThan(0);
		});

		it("should categorize error content as persist regardless of base score", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("run command"),
				createAssistantMsg("running..."),
				createToolResult("bash", "Error: Cannot find module 'lodash'\n  at resolve (/app/main.js:12)"),
			];

			const config: CompressionPipelineConfig = {
				persistence: { ...DEFAULT_PERSISTENCE_CONFIG },
				lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG },
				summary: { ...DEFAULT_SUMMARY_CONFIG },
				classifier: { enabled: false },
				scoring: { enabled: true },
				enabled: true,
			};

			const result = await compressContext(messages, config);

			expect(result.steps.scoring).toBeDefined();
			expect(result.steps.scoring!.persistCount).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// Pipeline Toggle Tests
	// ==========================================================================

	describe("Pipeline Toggle", () => {
		it("should skip all compression when enabled=false", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("task"),
				createAssistantMsg("working"),
				createToolResult("bash", createLargeContent(60)),
			];

			const result = await compressContext(messages, makeConfig({ enabled: false }));

			expect(result.steps).toEqual({});
			expect(result.tokensBefore).toBe(result.tokensAfter);
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("Edge Cases", () => {
		it("should handle empty messages array", async () => {
			const result = await compressContext([], makeConfig());
			expect(result.messages).toEqual([]);
		});

		it("should handle messages with no tool results", async () => {
			const messages = [createUserMsg("just chat"), createAssistantMsg("just talking")];
			const result = await compressContext(messages, makeConfig());
			expect(result.messages).toEqual(messages);
		});
	});
});
