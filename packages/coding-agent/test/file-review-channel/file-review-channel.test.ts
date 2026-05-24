/**
 * File-review extension: full channel handler round-trip tests.
 *
 * Tests the complete data flow through the channel mechanism:
 *   inbound RPC call → ChannelManager → ServerChannel handler → response
 *
 * This verifies that ALL 10 channel handlers actually work:
 *   review.live, review.history, review.summary, review.fileHistory,
 *   review.clear, review.pending, review.approve, review.reject,
 *   review.approveAll, review.approvals
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChange } from "../../extensions/file-review/contract.js";
import { FILE_REVIEW_CHANNEL_NAME, type FileReviewChannelContract } from "../../extensions/file-review/contract.js";
import fileReviewFactory from "../../extensions/file-review/index.js";
import { createTypedChannel } from "../../src/core/extensions/channel-factory.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTempDir(): string {
	return join(tmpdir(), `pi-review-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Extract the response payload from a ServerChannel response. */
function extractResponse(data: unknown): unknown {
	const d = data as Record<string, unknown>;
	if ("result" in d && d.result !== undefined) {
		return d.result;
	}
	const { invokeId: _, ...rest } = d;
	return rest;
}

/** Simulate an inbound RPC call and capture the outbound response. */
async function simulateInbound(
	harness: ReturnType<typeof createTestHarness>,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	const invokeId = `inv_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	harness.channelManager.handleInbound({
		type: "channel_data",
		name: FILE_REVIEW_CHANNEL_NAME,
		data: { __call: method, ...params, invokeId },
	});

	// Wait for async handler to complete
	await new Promise((r) => setTimeout(r, 30));

	const response = harness.outbound.find((m) => {
		const d = m.data as Record<string, unknown>;
		return d.invokeId === invokeId;
	});

	if (!response) {
		throw new Error(`No response found for ${method}. Outbound count: ${harness.outbound.length}`);
	}

	return response.data;
}

function createTestHarness() {
	const outbound: ChannelDataMessage[] = [];
	const channelManager = new ChannelManager((msg) => outbound.push(msg));
	const rawChannel = channelManager.register(FILE_REVIEW_CHANNEL_NAME);
	const typed = createTypedChannel<FileReviewChannelContract>(rawChannel);

	const appendEntries: Array<{ type: string; data: unknown }> = [];
	let currentCtx: ExtensionContext | null = null;

	const tempDir = createTempDir();
	mkdirSync(tempDir, { recursive: true });

	// Mock fileSnapshotManager — we control what getLiveChanges returns
	const mockGetLiveChanges = vi.fn((): LiveChange[] => []);
	const mockOnTurnEnd = vi.fn();
	const mockGetFileDiff = vi.fn(() => null);
	const mockGetBatchDiffs = vi.fn(() => ({ files: [] }));
	const mockFileSnapshotManager = {
		getLiveChanges: mockGetLiveChanges,
		onTurnEnd: mockOnTurnEnd,
		initialize: vi.fn(async () => {}),
		getFileDiff: mockGetFileDiff,
		getBatchDiffs: mockGetBatchDiffs,
	};

	// Mock ExtensionAPI (pi)
	const pi = {
		on: vi.fn(),
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		callLLM: vi.fn(async () => "{}"),
		callLLMStructured: vi.fn(async () => ({})),
		forkAgent: vi.fn(async () => ({
			text: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		})),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(() => rawChannel),
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		appendEntry: vi.fn((type: string, data?: unknown) => {
			appendEntries.push({ type, data });
		}),
	} as unknown as ExtensionAPI;

	// Initialize the extension
	fileReviewFactory(pi);

	// Extract registered event handlers
	const getHandlers = (event: string) =>
		(pi.on as ReturnType<typeof vi.fn>).mock.calls
			.filter((call: [string]) => call[0] === event)
			.map((call: [string, (event: unknown, ctx: ExtensionContext) => Promise<void>]) => call[1]);

	const sessionStartHandlers = getHandlers("session_start");
	const turnStartHandlers = getHandlers("turn_start");
	const turnEndHandlers = getHandlers("turn_end");
	const toolResultHandlers = getHandlers("tool_result");

	function makeCtx(overrides?: Record<string, unknown>): ExtensionContext {
		return {
			sessionManager: {
				getBranch: () => [],
				getEntries: () => [],
			},
			hasUI: false,
			ui: {
				notify: vi.fn(),
				setWidget: vi.fn(),
				theme: {
					fg: (_c: string, t: string) => t,
					bold: (t: string) => t,
					dim: (t: string) => t,
					accent: (t: string) => t,
					error: (t: string) => t,
					warning: (t: string) => t,
					success: (t: string) => t,
					strikethrough: (t: string) => `~~${t}~~`,
					borderMuted: (t: string) => t,
				},
			},
			cwd: tempDir,
			isIdle: () => true,
			signal: undefined,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => "",
			model: undefined,
			modelRegistry: {} as any,
			extensionName: "file-review",
			projectRoot: tempDir,
			sessionDataDir: tempDir,
			projectDataDir: tempDir,
			cwdDataDir: tempDir,
			globalDataDir: tempDir,
			sessionSignal: new AbortController().signal,
			respondUI: vi.fn(),
			fileSnapshotManager: mockFileSnapshotManager as any,
			...overrides,
		} as unknown as ExtensionContext;
	}

	async function fireSessionStart(ctxOverrides?: Record<string, unknown>) {
		const ctx = makeCtx(ctxOverrides);
		currentCtx = ctx;
		for (const h of sessionStartHandlers) {
			await h({}, ctx);
		}
		return ctx;
	}

	async function fireTurnStart() {
		for (const h of turnStartHandlers) {
			await h({}, currentCtx!);
		}
	}

	async function fireToolResult() {
		for (const h of toolResultHandlers) {
			await h({}, currentCtx!);
		}
	}

	async function fireTurnEnd(turnIndex: number) {
		for (const h of turnEndHandlers) {
			await h({ turnIndex, entryCount: 1 }, currentCtx!);
		}
	}

	return {
		channelManager,
		typed,
		outbound,
		pi,
		appendEntries,
		tempDir,
		mockFileSnapshotManager,
		mockGetLiveChanges,
		mockGetFileDiff,
		mockGetBatchDiffs,
		mockOnTurnEnd,
		makeCtx,
		fireSessionStart,
		fireTurnStart,
		fireToolResult,
		fireTurnEnd,
		getCurrentCtx: () => currentCtx,
	};
}

// Helper: create a LiveChange for testing
function makeChange(path: string, status: "added" | "modified" | "deleted"): LiveChange {
	return {
		path,
		status,
		diff: {
			path,
			oldContent: status === "added" ? null : "old",
			newContent: status === "deleted" ? null : "new",
			oldHash: status === "added" ? null : "hash-old",
			newHash: status === "deleted" ? null : "hash-new",
			unifiedDiff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`,
		},
	};
}

// ── Tests ────────────────────────────────────────────────────────────

describe("file-review channel: registration and setup", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(() => {
		harness = createTestHarness();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("registers channel with correct name 'file-review'", () => {
		expect(harness.pi.registerChannel).toHaveBeenCalledWith("file-review");
	});

	it("registers handlers for all 4 required events", () => {
		const events = (harness.pi.on as ReturnType<typeof vi.fn>).mock.calls.map((call: [string]) => call[0]);
		expect(events).toContain("session_start");
		expect(events).toContain("turn_start");
		expect(events).toContain("turn_end");
		expect(events).toContain("tool_result");
	});
});

describe("file-review channel: review.pending (CRITICAL - the one frontend calls)", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns empty when no turns have happened", async () => {
		const data = await simulateInbound(harness, "review.pending", {});
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});

	it("returns pending changes after a turn with file changes", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("new-file.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const data = await simulateInbound(harness, "review.pending", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThan(0);
	});

	it("tracks pending changes across multiple turns", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		const data = await simulateInbound(harness, "review.pending", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(2);
	});
});

describe("file-review channel: review.approve", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns ok:true for existing change", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("approve-me.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const data = await simulateInbound(harness, "review.approve", {
			path: "approve-me.ts",
		});

		expect((data as Record<string, unknown>).ok).toBe(true);
	});

	it("returns ok:true for non-existent change (always succeeds)", async () => {
		const data = await simulateInbound(harness, "review.approve", {
			path: "non-existent.ts",
		});

		expect((data as Record<string, unknown>).ok).toBe(true);
	});

	it("persists approval via appendEntry", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("persist.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", {
			path: "persist.ts",
		});

		const approvalEntry = harness.appendEntries.find(
			(e) => e.type === "file-approval" && (e.data as Record<string, unknown>).status === "approved",
		);
		expect(approvalEntry).toBeDefined();
		expect((approvalEntry!.data as Record<string, unknown>).path).toBe("persist.ts");
	});

	it("approved change no longer appears in pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("will-approve.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", { path: "will-approve.ts" });

		const data = await simulateInbound(harness, "review.pending", {});
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});
});

describe("file-review channel: review.reject", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("reject rolls back added file (deleted)", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("reject-me.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		// Create file on disk so rollback can delete it
		writeFileSync(join(harness.tempDir, "reject-me.ts"), "new", "utf-8");

		harness.mockGetFileDiff.mockReturnValue({
			oldContent: null,
			newContent: "new",
		});

		const data = await simulateInbound(harness, "review.reject", {
			path: "reject-me.ts",
		});

		expect((data as Record<string, unknown>).ok).toBe(true);
		expect((data as Record<string, unknown>).rolledBack).toBe(true);
	});

	it("persists rejection via appendEntry", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("r.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		writeFileSync(join(harness.tempDir, "r.ts"), "new", "utf-8");
		harness.mockGetFileDiff.mockReturnValue({
			oldContent: null,
			newContent: "new",
		});

		await simulateInbound(harness, "review.reject", { path: "r.ts" });

		const entry = harness.appendEntries.find(
			(e) => e.type === "file-approval" && (e.data as Record<string, unknown>).status === "rejected",
		);
		expect(entry).toBeDefined();
	});
});

describe("file-review channel: review.approveAll", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("approves all pending changes", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added"), makeChange("b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("c.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		const data = await simulateInbound(harness, "review.approveAll", {});
		expect((data as Record<string, unknown>).count).toBe(3);

		const pendingData = await simulateInbound(harness, "review.pending", {});
		const pendingResult = extractResponse(pendingData);
		expect(
			Array.isArray(pendingResult)
				? pendingResult.length
				: Object.keys(pendingResult as Record<string, unknown>).length,
		).toBe(0);
	});

	it("returns count:0 when nothing pending", async () => {
		const data = await simulateInbound(harness, "review.approveAll", {});
		expect((data as Record<string, unknown>).count).toBe(0);
	});
});

describe("file-review channel: review.history", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns empty when no turns", async () => {
		const data = await simulateInbound(harness, "review.history", {});
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});

	it("returns turn records after changes", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hist.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const data = await simulateInbound(harness, "review.history", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(1);
	});

	it("filters by fromTurn", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		const data = await simulateInbound(harness, "review.history", { fromTurn: 1 });
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(1);
	});
});

describe("file-review channel: review.summary", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns empty when no turns", async () => {
		const data = await simulateInbound(harness, "review.summary", {});
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});

	it("returns summary with counts", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("new.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const data = await simulateInbound(harness, "review.summary", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(1);
	});
});

describe("file-review channel: review.fileHistory", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns empty for unknown file", async () => {
		const data = await simulateInbound(harness, "review.fileHistory", { path: "unknown.ts" });
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});

	it("returns history for file changed across turns", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("evolved.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("evolved.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		const data = await simulateInbound(harness, "review.fileHistory", { path: "evolved.ts" });
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(2);
	});
});

describe("file-review channel: review.live", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns turnIndex and empty changes when no live changes", async () => {
		harness.mockGetLiveChanges.mockReturnValue([]);
		const data = await simulateInbound(harness, "review.live", {});
		expect((data as Record<string, unknown>).turnIndex).toBe(-1);
		expect((data as Record<string, unknown>).changes).toEqual([]);
	});

	it("returns live changes from fileSnapshotManager", async () => {
		const liveChanges = [makeChange("live.ts", "added")];
		harness.mockGetLiveChanges.mockReturnValue(liveChanges);

		const data = await simulateInbound(harness, "review.live", {});
		expect((data as Record<string, unknown>).changes).toEqual(liveChanges);
	});
});

describe("file-review channel: review.clear", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("clears all turn history", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("clear-me.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const data = await simulateInbound(harness, "review.clear", {});
		expect((data as Record<string, unknown>).ok).toBe(true);

		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		expect(
			Array.isArray(historyResult)
				? historyResult.length
				: Object.keys(historyResult as Record<string, unknown>).length,
		).toBe(0);
	});
});

describe("file-review channel: review.approvals", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("returns empty when no approvals", async () => {
		const data = await simulateInbound(harness, "review.approvals", {});
		const result = extractResponse(data);
		expect(Array.isArray(result) ? result.length : Object.keys(result as Record<string, unknown>).length).toBe(0);
	});

	it("returns approvals after approve/reject", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("app-a.ts", "added"), makeChange("app-b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", { path: "app-a.ts" });
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "new" });
		await simulateInbound(harness, "review.reject", { path: "app-b.ts" });

		const data = await simulateInbound(harness, "review.approvals", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(2);
	});

	it("filters by status=approved", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("f.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", { path: "f.ts" });

		const data = await simulateInbound(harness, "review.approvals", { status: "approved" });
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(1);

		const rejectedData = await simulateInbound(harness, "review.approvals", { status: "rejected" });
		const rejectedResult = extractResponse(rejectedData);
		expect(
			Array.isArray(rejectedResult)
				? rejectedResult.length
				: Object.keys(rejectedResult as Record<string, unknown>).length,
		).toBe(0);
	});
});

describe("file-review channel: full lifecycle E2E", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("complete flow: changes → pending → approve → verify", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("feature.ts", "added"), makeChange("test.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("feature.ts", "modified"),
			makeChange("config.json", "added"),
		]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// 1. Check pending has items (aggregated by path: feature.ts, test.ts, config.json = 3 unique paths)
		const pendingData = await simulateInbound(harness, "review.pending", {});
		const pending = extractResponse(pendingData);
		const pendingArr = Array.isArray(pending) ? pending : Object.values(pending as Record<string, unknown>);
		expect(pendingArr.length).toBeGreaterThanOrEqual(3);

		// 2. Approve feature.ts
		const approveResult = await simulateInbound(harness, "review.approve", {
			path: "feature.ts",
		});
		expect((approveResult as Record<string, unknown>).ok).toBe(true);

		// 3. Get summary
		const summaryData = await simulateInbound(harness, "review.summary", {});
		const summary = extractResponse(summaryData);
		const summaryArr = Array.isArray(summary) ? summary : Object.values(summary as Record<string, unknown>);
		expect(summaryArr.length).toBeGreaterThanOrEqual(2);

		// 4. Approve all remaining
		const approveAllResult = await simulateInbound(harness, "review.approveAll", {});
		expect((approveAllResult as Record<string, unknown>).count).toBeGreaterThanOrEqual(1);

		// 5. Verify pending is now empty
		const finalPending = await simulateInbound(harness, "review.pending", {});
		const finalResult = extractResponse(finalPending);
		expect(
			Array.isArray(finalResult) ? finalResult.length : Object.keys(finalResult as Record<string, unknown>).length,
		).toBe(0);

		// 6. Verify appendEntry calls
		const approvalEntries = harness.appendEntries.filter((e) => e.type === "file-approval");
		expect(approvalEntries.length).toBeGreaterThanOrEqual(2);
	});
});

describe("file-review channel: session restoration", () => {
	it("restores approvals from session entries", async () => {
		const harness = createTestHarness();

		const mockSessionManager = {
			getBranch: () => [],
			getEntries: () => [
				{
					type: "custom",
					customType: "file-approval",
					data: { path: "restored.ts", status: "approved", timestamp: Date.now() },
				},
			],
		};

		await harness.fireSessionStart({
			sessionManager: mockSessionManager,
		});

		const data = await simulateInbound(harness, "review.approvals", { status: "approved" });
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
		expect(arr.length).toBeGreaterThanOrEqual(1);

		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});
});

// ── 精确用户场景验证 ─────────────────────────────────────────────────

/**
 * Helper: call review.pending and extract the array of pending paths
 *
 * ServerChannel wraps arrays as { "0": {...}, "1": {...}, invokeId }.
 * We reconstruct the array from numeric keys.
 */
async function getPendingPaths(
	harness: ReturnType<typeof createTestHarness>,
): Promise<Array<{ turnIndex: number; path: string; status: string }>> {
	const data = await simulateInbound(harness, "review.pending", {});
	const result = extractResponse(data);
	const arr = Array.isArray(result) ? result : [];
	return arr.map((item: Record<string, unknown>) => ({
		turnIndex: item.turnIndex as number,
		path: item.path as string,
		status: item.status as string,
	}));
}

describe("用户场景: 完整 Change Review 交互流程", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	// ── 场景 1: 创建文件 → pending → 批准 → 面板清空 ──

	it("场景1: pi 创建 a.ts → pending 显示 a.ts → 用户批准 → pending 为空", async () => {
		// Step 1: Turn 0 — pi 创建了 a.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		// Step 2: 前端调用 review.pending → 应该看到 a.ts
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 0, path: "a.ts", status: "pending" });

		// Step 3: 用户点 [批准 a.ts]
		const approveResult = await simulateInbound(harness, "review.approve", {
			path: "a.ts",
		});
		expect((approveResult as Record<string, unknown>).ok).toBe(true);

		// Step 4: 前端再次拉取 pending → 应该为空
		const afterApprove = await getPendingPaths(harness);
		expect(afterApprove).toHaveLength(0);
	});

	// ── 场景 2: 创建文件 → pending → 拒绝 → 面板清空（拒绝的不显示）──

	it("场景2: pi 创建 b.ts → pending 显示 b.ts → 用户拒绝 → pending 为空", async () => {
		// Turn 0: pi 创建了 b.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		// pending 显示 b.ts
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("b.ts");

		// 用户点 [拒绝 b.ts]
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "new" });
		const rejectResult = await simulateInbound(harness, "review.reject", {
			path: "b.ts",
		});
		expect((rejectResult as Record<string, unknown>).ok).toBe(true);

		// 拒绝后 pending 为空
		const afterReject = await getPendingPaths(harness);
		expect(afterReject).toHaveLength(0);

		// 验证 rejection 被持久化
		const rejectionEntry = harness.appendEntries.find(
			(e) =>
				e.type === "file-approval" &&
				(e.data as Record<string, unknown>).path === "b.ts" &&
				(e.data as Record<string, unknown>).status === "rejected",
		);
		expect(rejectionEntry).toBeDefined();
	});

	// ── 场景 3: approve is per-path, not per-turn ──

	it("场景3: approve path once → subsequent turn modification resets to pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("feature.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", {
			path: "feature.ts",
		});

		const afterFirstApprove = await getPendingPaths(harness);
		expect(afterFirstApprove).toHaveLength(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("feature.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// New behavior: modification resets approval to pending — file reappears
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 1, path: "feature.ts", status: "pending" });

		const historyData = await simulateInbound(harness, "review.fileHistory", {
			path: "feature.ts",
		});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);
		expect(historyArr).toHaveLength(2);
	});

	// ── 场景 4: 拒绝后再修改 → 同文件重新出现为 pending ──

	it("场景4: Turn0 拒绝 config.ts → Turn1 再次修改 config.ts → config.ts reappears as pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("config.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "new" });
		await simulateInbound(harness, "review.reject", {
			path: "config.ts",
		});

		const afterReject = await getPendingPaths(harness);
		expect(afterReject).toHaveLength(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("config.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// New behavior: modification resets rejection to pending — file reappears
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 1, path: "config.ts", status: "pending" });
	});

	// ── 场景 5: 混合场景 — 多文件 + 部分批准 + 部分拒绝 + 再修改 ──

	it("场景5: 多文件混合审批 — re-modified files reappear as pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("a.ts", "added"),
			makeChange("b.ts", "added"),
			makeChange("c.ts", "added"),
		]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const pending0 = await getPendingPaths(harness);
		expect(pending0).toHaveLength(3);

		await simulateInbound(harness, "review.approve", { path: "a.ts" });
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "new" });
		await simulateInbound(harness, "review.reject", { path: "b.ts" });

		const pending1 = await getPendingPaths(harness);
		expect(pending1).toHaveLength(1);
		expect(pending1[0]!.path).toBe("c.ts");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("a.ts", "modified"),
			makeChange("b.ts", "modified"),
			makeChange("d.ts", "added"),
		]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// New behavior: a.ts and b.ts reset to "pending" after re-modification
		// pending: a.ts (pending) + b.ts (pending) + c.ts (pending) + d.ts (pending) = 4
		const pending2 = await getPendingPaths(harness);
		expect(pending2).toHaveLength(4);

		const paths = pending2.map((p) => p.path).sort();
		expect(paths).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);

		const approveAllResult = await simulateInbound(harness, "review.approveAll", {});
		expect((approveAllResult as Record<string, unknown>).count).toBe(4);

		const finalPending = await getPendingPaths(harness);
		expect(finalPending).toHaveLength(0);
	});

	// ── 场景 6: 拒绝后的文件不再修改 → 始终不出现 ──

	it("场景6: Turn0 拒绝 x.ts → Turn1 不改 x.ts → x.ts 永远不再 pending", async () => {
		// Turn 0: 创建 x.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("x.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		// 拒绝
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "new" });
		await simulateInbound(harness, "review.reject", { path: "x.ts" });

		// Turn 1: 创建 y.ts（x.ts 没有改动）
		harness.mockGetLiveChanges.mockReturnValue([makeChange("y.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// pending 只有 y.ts，没有 x.ts
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("y.ts");
		expect(pending.every((p) => p.path !== "x.ts")).toBe(true);
	});
});

describe('turn_end 持久化: appendEntry("file-review-turn") 写入验证', () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("turn_end with changes appends a file-review-turn entry", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("persisted.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const turnEntry = harness.appendEntries.find((e) => e.type === "file-review-turn");
		expect(turnEntry).toBeDefined();
		const data = turnEntry!.data as Record<string, unknown>;
		expect(data.turnIndex).toBe(0);
		const changes = data.changes as Array<Record<string, unknown>>;
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("persisted.ts");
		expect(changes[0]!.status).toBe("added");
		// Should NOT include diff
		expect("diff" in changes[0]!).toBe(false);
	});

	it("turn_end without changes does NOT append entry", async () => {
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		const turnEntries = harness.appendEntries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(0);
	});

	it("multiple turns append multiple entries with correct indices", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("b.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("c.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(2);

		const turnEntries = harness.appendEntries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(3);
		const indices = turnEntries.map((e) => (e.data as Record<string, unknown>).turnIndex);
		expect(indices).toEqual([0, 1, 2]);
	});
});

describe("session restart: turnLog and approvals restored from entries", () => {
	it("restores turnLog and approvals from session entries, pending survives restart", async () => {
		// Phase 1: Simulate a session that had turns and approvals
		const harness = createTestHarness();
		await harness.fireSessionStart();

		// Turn 0: create a.ts, b.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added"), makeChange("b.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		// Approve a.ts in turn 0
		await simulateInbound(harness, "review.approve", {
			path: "a.ts",
		});

		// Capture the entries that were persisted
		const persistedTurnEntries = harness.appendEntries.filter((e) => e.type === "file-review-turn");
		const persistedApprovalEntries = harness.appendEntries.filter((e) => e.type === "file-approval");
		expect(persistedTurnEntries).toHaveLength(1);
		expect(persistedApprovalEntries).toHaveLength(1);

		// Phase 2: Simulate session restart — create a new harness with entries
		const harness2 = createTestHarness();
		const mockSessionManager = {
			getBranch: () => [],
			getEntries: () => [
				{
					type: "custom",
					customType: "file-review-turn",
					data: persistedTurnEntries[0]!.data,
				},
				{
					type: "custom",
					customType: "file-approval",
					data: persistedApprovalEntries[0]!.data,
				},
			],
		};

		await harness2.fireSessionStart({
			sessionManager: mockSessionManager,
		});

		// Verify: a.ts is approved (not in pending), b.ts is pending
		const pending = await getPendingPaths(harness2);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 0, path: "b.ts", status: "pending" });

		// Verify: history is restored
		const historyData = await simulateInbound(harness2, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);
		expect(historyArr).toHaveLength(1);

		// Verify: approvals are restored (a.ts approved from entry)
		// Note: getApproval() lazily creates pending entries, so b.ts may also appear
		const approvalsData = await simulateInbound(harness2, "review.approvals", {});
		const approvalsResult = extractResponse(approvalsData);
		const approvalsArr = (
			Array.isArray(approvalsResult) ? approvalsResult : Object.values(approvalsResult as Record<string, unknown>)
		) as Array<Record<string, unknown>>;
		// At minimum a.ts should be approved
		const approvedA = approvalsArr.find((a) => a.path === "a.ts" && a.status === "approved");
		expect(approvedA).toBeDefined();

		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
		try {
			rmSync(harness2.tempDir, { recursive: true, force: true });
		} catch {}
	});
});

describe("BUG修复验证: file-snapshot 先提交 baseline 时 file-review 仍能拿到变更", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("tool_result 采集的变更不会因 file-snapshot 提交 baseline 而丢失", async () => {
		// 模拟真实场景：
		// 1. tool_result 时 getLiveChanges() 返回变更（baseline 还没更新）
		// 2. turn_end 时 file-snapshot 先跑 onTurnEnd() → baseline 被更新
		// 3. file-review 的 turn_end handler 应该用 tool_result 采集的数据

		// tool_result: file-review 记录 currentTurnChanges
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult(); // currentTurnChanges = [hello.ts added]

		// 模拟 file-snapshot 的 onTurnEnd 先执行（baseline 被更新）
		// 此时 getLiveChanges 会返回 []（因为 baseline 已包含新文件）
		harness.mockGetLiveChanges.mockReturnValue([]);

		// file-review 的 turn_end handler 执行
		await harness.fireTurnEnd(0);

		// 关键断言：pending 应该有 hello.ts（来自 tool_result 采集），而不是空
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 0, path: "hello.ts", status: "pending" });
	});

	it("没有 tool_result 时 fallback 到 getLiveChanges", async () => {
		// 没有 tool_result 事件（比如 turn 里没有工具调用）
		// 此时 currentTurnChanges 为空，应 fallback 到 getLiveChanges
		harness.mockGetLiveChanges.mockReturnValue([makeChange("fallback.ts", "added")]);
		await harness.fireTurnStart();
		// 注意：没有 fireToolResult
		await harness.fireTurnEnd(0);

		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("fallback.ts");
	});

	it("多次 tool_result 只保留最终状态", async () => {
		// Turn 中有多次工具调用：
		// tool_result 1: 创建 a.ts
		// tool_result 2: 创建 b.ts + 修改 a.ts
		// → currentTurnChanges 应该是最终状态

		await harness.fireTurnStart();

		// 第1次 tool_result
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "added")]);
		await harness.fireToolResult();

		// 第2次 tool_result
		harness.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "modified"), makeChange("b.ts", "added")]);
		await harness.fireToolResult();

		// file-snapshot 先提交 baseline
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const pending = await getPendingPaths(harness);
		// 应该拿到最后一次 tool_result 的状态
		expect(pending).toHaveLength(2);
		const paths = pending.map((p) => p.path).sort();
		expect(paths).toEqual(["a.ts", "b.ts"]);
	});
});

describe("BUG reproduction: approved file re-modified in subsequent turn does not appear in pending", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("step-by-step: add foo.ts → approve → modify foo.ts → file reappears as pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("foo.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const pending1 = await getPendingPaths(harness);
		expect(pending1).toHaveLength(1);
		expect(pending1[0]).toEqual({ turnIndex: 0, path: "foo.ts", status: "pending" });

		const approveResult = await simulateInbound(harness, "review.approve", {
			path: "foo.ts",
		});
		expect((approveResult as Record<string, unknown>).ok).toBe(true);

		const pending2 = await getPendingPaths(harness);
		expect(pending2).toHaveLength(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("foo.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// New behavior — modification resets approval, file reappears as pending
		const pending3 = await getPendingPaths(harness);
		expect(pending3).toHaveLength(1);
		expect(pending3[0]).toEqual({ turnIndex: 1, path: "foo.ts", status: "pending" });

		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		expect(historyArr).toHaveLength(2);
		expect(historyArr[0]!.turnIndex).toBe(0);
		expect(historyArr[1]!.turnIndex).toBe(1);
	});

	it("without tool_result: same scenario — file reappears as pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("foo.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		await simulateInbound(harness, "review.approve", { path: "foo.ts" });
		const pending1 = await getPendingPaths(harness);
		expect(pending1).toHaveLength(0);

		harness.mockGetLiveChanges.mockReturnValue([makeChange("foo.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(1);

		// New behavior: modification resets approval, file reappears as pending
		const pending2 = await getPendingPaths(harness);
		expect(pending2).toHaveLength(1);
		expect(pending2[0]).toEqual({ turnIndex: 1, path: "foo.ts", status: "pending" });
	});
});

describe("用户场景: bash rm 删除文件后 review.pending 能检测到删除", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("session 开始时有 hello.txt → turn 中 rm → pending 显示 deleted", async () => {
		// 模拟 session 开始时 hello.txt 已存在
		// file-snapshot 的 sessionStartTreeHash 包含 hello.txt
		// 但 file-review 不关心 sessionStartTreeHash，它只看 getLiveChanges

		// 模拟 getLiveChanges 返回删除
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.txt", "deleted")]);

		await harness.fireTurnStart();
		// 模拟 bash rm 的 tool_result
		await harness.fireToolResult();
		await harness.fireTurnEnd(0);

		// pending 应该显示 hello.txt 被删除
		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual({ turnIndex: 0, path: "hello.txt", status: "pending" });

		// history 也应该有
		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		expect(historyArr).toHaveLength(1);
		expect(historyArr[0]!.changes).toHaveLength(1);
		expect(historyArr[0]!.changes[0]!.status).toBe("deleted");
	});

	it("先创建再删除同一文件 → net zero，不出现 pending", async () => {
		// turn 0: 创建 hello.txt
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.txt", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		await harness.fireTurnEnd(0);

		// turn 1: 删除 hello.txt — first=added, latest=deleted → net zero
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.txt", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		await harness.fireTurnEnd(1);

		const pending = await getPendingPaths(harness);
		// Net zero: added then deleted without approval → should NOT appear
		expect(pending).toHaveLength(0);
	});

	it("删除 + 创建同时发生 → 两个都出现在 pending", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("old.txt", "deleted"), makeChange("new.txt", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		await harness.fireTurnEnd(0);

		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(2);
		const paths = pending.map((p) => p.path).sort();
		expect(paths).toEqual(["new.txt", "old.txt"]);
	});

	it("没有 tool_result 时 fallback 到 getLiveChanges 也能检测删除", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.txt", "deleted")]);
		await harness.fireTurnStart();
		// 没有 fireToolResult — 模拟没有工具调用的 turn
		await harness.fireTurnEnd(0);

		const pending = await getPendingPaths(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("hello.txt");
	});

	it("appendEntry 持久化删除记录", async () => {
		harness.mockGetLiveChanges.mockReturnValue([makeChange("hello.txt", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		await harness.fireTurnEnd(0);

		const turnEntry = harness.appendEntries.find((e) => e.type === "file-review-turn");
		expect(turnEntry).toBeDefined();
		const data = turnEntry!.data as Record<string, unknown>;
		const changes = data.changes as Array<Record<string, unknown>>;
		expect(changes[0]!.path).toBe("hello.txt");
		expect(changes[0]!.status).toBe("deleted");
	});
});

async function getPendingDetailed(
	harness: ReturnType<typeof createTestHarness>,
): Promise<Array<{ turnIndex: number; path: string; status: string; fileStatus: string }>> {
	const data = await simulateInbound(harness, "review.pending", {});
	const result = extractResponse(data);
	const arr = Array.isArray(result) ? result : [];
	return arr.map((item: Record<string, unknown>) => ({
		turnIndex: item.turnIndex as number,
		path: item.path as string,
		status: item.status as string,
		fileStatus: item.fileStatus as string,
	}));
}

describe("re-modification after approval", () => {
	let harness: ReturnType<typeof createTestHarness>;

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("should show file as pending when modified again after approval (multi-turn)", async () => {
		// Turn 1: Create src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Approve src/app.ts
		const approveResult = await simulateInbound(harness, "review.approve", {
			path: "src/app.ts",
		});
		expect((approveResult as Record<string, unknown>).ok).toBe(true);

		// Verify pending is empty after approval
		const afterApprove = await getPendingPaths(harness);
		expect(afterApprove).toHaveLength(0);

		// Turn 2: Modify src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// New behavior: modification resets approval, file reappears as pending
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual(
			expect.objectContaining({ turnIndex: 2, path: "src/app.ts", fileStatus: "modified", status: "pending" }),
		);
	});

	it("should show file as pending when modified after approveAll", async () => {
		// Turn 1: Create src/app.ts and src/utils.ts
		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/app.ts", "added"),
			makeChange("src/utils.ts", "added"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Approve all
		const approveAllResult = await simulateInbound(harness, "review.approveAll", {});
		expect((approveAllResult as Record<string, unknown>).count).toBe(2);

		// Verify pending is empty
		const afterApproveAll = await getPendingPaths(harness);
		expect(afterApproveAll).toHaveLength(0);

		// Turn 2: Modify src/app.ts only
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// New behavior: modification resets approval, file reappears as pending
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual(
			expect.objectContaining({ turnIndex: 2, path: "src/app.ts", fileStatus: "modified", status: "pending" }),
		);
	});

	it("should track file through added→modified→deleted across turns", async () => {
		// Turn 1: Create src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Approve turn 1
		await simulateInbound(harness, "review.approve", { path: "src/app.ts" });

		// Turn 2: Modify src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// Approve turn 2
		await simulateInbound(harness, "review.approve", { path: "src/app.ts" });

		// Turn 3: Delete src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(3);

		// New behavior: deletion resets approval to pending, everApproved prevents net-zero filter
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual(
			expect.objectContaining({ turnIndex: 3, path: "src/app.ts", fileStatus: "deleted", status: "pending" }),
		);
	});

	it("should show file as pending after 3 consecutive modifications with approvals", async () => {
		// Turn 1: Create src/app.ts
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);
		await simulateInbound(harness, "review.approve", { path: "src/app.ts" });

		// Turn 2: Modify to v2
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);
		await simulateInbound(harness, "review.approve", { path: "src/app.ts" });

		// Turn 3: Modify to v3
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(3);
		await simulateInbound(harness, "review.approve", { path: "src/app.ts" });

		// Turn 4: Modify to v4 — no approval
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(4);

		// New behavior: Turn 4 modification resets approval to pending
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toEqual(
			expect.objectContaining({ turnIndex: 4, path: "src/app.ts", fileStatus: "modified", status: "pending" }),
		);

		// History should have all 4 turns
		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		expect(historyArr).toHaveLength(4);
	});

	it("should handle multiple files where some approved and some pending, then one re-modified", async () => {
		// Turn 1: Create 3 files
		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added"),
			makeChange("src/b.ts", "added"),
			makeChange("src/c.ts", "added"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Approve a.ts and b.ts (c.ts stays pending)
		await simulateInbound(harness, "review.approve", { path: "src/a.ts" });
		await simulateInbound(harness, "review.approve", { path: "src/b.ts" });

		// Pending should only have c.ts
		const pendingAfterApprove = await getPendingPaths(harness);
		expect(pendingAfterApprove).toHaveLength(1);
		expect(pendingAfterApprove[0]!.path).toBe("src/c.ts");

		// Turn 2: Modify src/a.ts (which was approved)
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/a.ts", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// New behavior: a.ts reset to pending after re-modification, c.ts still pending = 2 items
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(2);
		const paths = pending.map((p) => p.path).sort();
		expect(paths).toEqual(["src/a.ts", "src/c.ts"]);
	});
});
