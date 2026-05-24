/**
 * File-review extension: edge-case tests.
 *
 * Covers:
 *   Group 1: Multiple modifications without approval — dedup behavior
 *   Group 2: Click to view diff after multiple turns
 *   Group 3: Reject behavior — does it rollback?
 *   Group 4: Approve/reject specific turn's file
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	return join(tmpdir(), `pi-review-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function extractResponse(data: unknown): unknown {
	const d = data as Record<string, unknown>;
	if ("result" in d && d.result !== undefined) {
		return d.result;
	}
	const { invokeId: _, ...rest } = d;
	return rest;
}

async function simulateInbound(
	harness: ReturnType<typeof createTestHarness>,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	const invokeId = `inv_edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	harness.channelManager.handleInbound({
		type: "channel_data",
		name: FILE_REVIEW_CHANNEL_NAME,
		data: { __call: method, ...params, invokeId },
	});

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

	fileReviewFactory(pi);

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

function makeChange(path: string, status: "added" | "modified" | "deleted", content = "new"): LiveChange {
	return {
		path,
		status,
		diff: {
			path,
			oldContent: status === "added" ? null : "old",
			newContent: status === "deleted" ? null : content,
			oldHash: status === "added" ? null : "hash-old",
			newHash: status === "deleted" ? null : "hash-new",
			unifiedDiff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${content}`,
		},
	};
}

async function getPendingDetailed(
	harness: ReturnType<typeof createTestHarness>,
): Promise<Array<{ turnIndex: number; path: string; status: string; fileStatus: string; timestamp: number }>> {
	const data = await simulateInbound(harness, "review.pending", {});
	const result = extractResponse(data);
	const arr = Array.isArray(result) ? result : [];
	return arr.map((item: Record<string, unknown>) => ({
		turnIndex: item.turnIndex as number,
		path: item.path as string,
		status: item.status as string,
		fileStatus: item.fileStatus as string,
		timestamp: item.timestamp as number,
	}));
}

async function getPendingPaths(
	harness: ReturnType<typeof createTestHarness>,
): Promise<Array<{ turnIndex: number; path: string; status: string }>> {
	const detailed = await getPendingDetailed(harness);
	return detailed.map(({ turnIndex, path, status }) => ({ turnIndex, path, status }));
}

async function callApprove(harness: ReturnType<typeof createTestHarness>, path: string): Promise<boolean> {
	const data = await simulateInbound(harness, "review.approve", { path });
	return (data as Record<string, unknown>).ok as boolean;
}

async function callReject(harness: ReturnType<typeof createTestHarness>, path: string): Promise<boolean> {
	const data = await simulateInbound(harness, "review.reject", { path });
	return (data as Record<string, unknown>).ok as boolean;
}

async function callRejectAll(
	harness: ReturnType<typeof createTestHarness>,
): Promise<{ count: number; rolledBack: number }> {
	const data = await simulateInbound(harness, "review.rejectAll", {});
	return extractResponse(data) as { count: number; rolledBack: number };
}

// ── Group 1: Multiple modifications without approval ─────────────────

describe("Group 1: Multiple modifications without approval", () => {
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

	it("should show only latest turn entry when file modified across multiple turns without approval", async () => {
		// Turn 0: Create src/app.ts with "v1"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Turn 1: Modify src/app.ts to "v2"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Turn 2: Modify src/app.ts to "v3"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v3")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// Call review.pending — aggregates by path, only latest turn shown
		const pending = await getPendingDetailed(harness);

		console.log("[EdgeCase-1] pending entries:", JSON.stringify(pending, null, 2));

		// Only 1 entry for src/app.ts (latest turn = turn 2)
		expect(pending.length).toBe(1);

		expect(pending[0]).toEqual(expect.objectContaining({ turnIndex: 2, path: "src/app.ts", fileStatus: "modified" }));
	});

	it("should show file with latest status across turns (aggregated by path)", async () => {
		// Turn 0: Create src/app.ts with "v1" (status: "added")
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Turn 1: Modify src/app.ts to "v2" (status: "modified")
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		const pending = await getPendingDetailed(harness);

		console.log("[EdgeCase-2] pending entries:", JSON.stringify(pending, null, 2));

		// Aggregated: only 1 entry (latest turn = turn 1)
		expect(pending.length).toBe(1);

		// Latest turn entry should have fileStatus "modified" (from turn 1)
		expect(pending[0]!.fileStatus).toBe("modified");
		expect(pending[0]!.turnIndex).toBe(1);
	});
});

// ── Group 2: Click to view diff — does it work after multiple turns? ──

describe("Group 2: Click to view diff after multiple turns", () => {
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

	it("should match pending file with review.fileHistory result after approval + re-modification", async () => {
		// Turn 0: Create src/app.ts with "v1"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Approve it
		const approved = await callApprove(harness, "src/app.ts");
		expect(approved).toBe(true);

		// Turn 1: Modify to "v2"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Call review.pending — New behavior: modification resets approval, file reappears as pending
		const pending = await getPendingPaths(harness);
		expect(pending.length).toBe(1);
		expect(pending[0]).toEqual(expect.objectContaining({ path: "src/app.ts", status: "pending" }));

		// Call review.fileHistory for the path — simulates clicking to view diff
		const historyData = await simulateInbound(harness, "review.fileHistory", {
			path: "src/app.ts",
		});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);

		console.log("[EdgeCase-3] fileHistory:", JSON.stringify(historyArr, null, 2));

		// Should have 2 history entries: turn 0 (added) and turn 1 (modified)
		expect(historyArr.length).toBe(2);

		// The turn 1 entry should have diff data
		const turn1History = historyArr.find((h: Record<string, unknown>) => h.turnIndex === 1);
		expect(turn1History).toBeDefined();
		expect((turn1History as Record<string, unknown>).diff).toBeDefined();
	});

	it("should return diff for file that was modified multiple times", async () => {
		// Turn 0: Create src/app.ts with "v1"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Turn 1: Modify to "v2"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Turn 2: Modify to "v3"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v3")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// Call review.fileHistory for src/app.ts
		const historyData = await simulateInbound(harness, "review.fileHistory", {
			path: "src/app.ts",
		});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);

		console.log("[EdgeCase-4] fileHistory for multi-modified file:", JSON.stringify(historyArr, null, 2));

		// Should have 3 entries: turn 0 (added, v1), turn 1 (modified, v2), turn 2 (modified, v3)
		expect(historyArr.length).toBe(3);

		// Each entry retains its own diff
		const turn0 = historyArr.find((h: Record<string, unknown>) => h.turnIndex === 0) as Record<string, unknown>;
		const turn1 = historyArr.find((h: Record<string, unknown>) => h.turnIndex === 1) as Record<string, unknown>;
		const turn2 = historyArr.find((h: Record<string, unknown>) => h.turnIndex === 2) as Record<string, unknown>;

		expect(turn0).toBeDefined();
		expect(turn0.status).toBe("added");
		expect(turn0.diff).toBeDefined();

		expect(turn1).toBeDefined();
		expect(turn1.status).toBe("modified");
		expect(turn1.diff).toBeDefined();

		expect(turn2).toBeDefined();
		expect(turn2.status).toBe("modified");
		expect(turn2.diff).toBeDefined();

		// Verify diff content: turn 0 has "v1", turn 1 has "v2", turn 2 has "v3"
		const diff0 = turn0.diff as Record<string, unknown>;
		const diff1 = turn1.diff as Record<string, unknown>;
		const diff2 = turn2.diff as Record<string, unknown>;

		expect(diff0.newContent).toBe("v1");
		expect(diff1.newContent).toBe("v2");
		expect(diff2.newContent).toBe("v3");
	});
});

// ── Group 3: Reject behavior — does it rollback? ─────────────────────

describe("Group 3: Reject behavior", () => {
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

	it("reject should rollback file and remove from turnLog", async () => {
		// Turn 0: Create src/app.ts with "v1" (create actual file for rollback)
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v1", "utf-8");
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// review.pending → should show 1 item
		const pending1 = await getPendingPaths(harness);
		expect(pending1.length).toBe(1);
		expect(pending1[0]!.path).toBe("src/app.ts");

		// review.reject (with getFileDiff mock for rollback)
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "v1" });
		const rejected = await callReject(harness, "src/app.ts");
		expect(rejected).toBe(true);

		// review.pending → should show 0 items (status changed to "rejected")
		const pending2 = await getPendingPaths(harness);
		expect(pending2.length).toBe(0);

		// The file should be removed from turnLog (rollback removes it)
		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		expect(historyArr.length).toBe(1);
		const turn0Changes = historyArr[0]!.changes as Array<Record<string, unknown>>;
		expect(turn0Changes.length).toBe(0);

		// Verify the file was deleted from disk (rollback of added file)
		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(false);

		// Verify the approval entry was persisted with "rejected" status
		const rejectEntry = harness.appendEntries.find(
			(e) =>
				e.type === "file-approval" &&
				(e.data as Record<string, unknown>).path === "src/app.ts" &&
				(e.data as Record<string, unknown>).status === "rejected",
		);
		expect(rejectEntry).toBeDefined();
	});

	it("approved file should still appear in review.fileHistory", async () => {
		// Turn 0: Create src/app.ts with "v1"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Approve it
		const approved = await callApprove(harness, "src/app.ts");
		expect(approved).toBe(true);

		// Call review.fileHistory — the file should STILL appear
		const historyData = await simulateInbound(harness, "review.fileHistory", {
			path: "src/app.ts",
		});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);

		console.log("[EdgeCase-6] fileHistory after approval:", JSON.stringify(historyArr, null, 2));

		expect(historyArr.length).toBe(1);
		expect((historyArr[0] as Record<string, unknown>).path).toBeUndefined();
		expect((historyArr[0] as Record<string, unknown>).turnIndex).toBe(0);
		expect((historyArr[0] as Record<string, unknown>).status).toBe("added");
		expect((historyArr[0] as Record<string, unknown>).diff).toBeDefined();
	});

	it("should handle reject of a file that no longer exists on disk", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "temp.ts"), "// temp", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/temp.ts", "added", "// temp")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const pending1 = await getPendingPaths(harness);
		expect(pending1.length).toBe(1);
		expect(pending1[0]!.path).toBe("src/temp.ts");

		rmSync(join(harness.tempDir, "src", "temp.ts"));
		expect(existsSync(join(harness.tempDir, "src", "temp.ts"))).toBe(false);

		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "// temp" });
		const rejectData = await simulateInbound(harness, "review.reject", { path: "src/temp.ts" });
		const rejectResult = rejectData as Record<string, unknown>;

		expect(rejectResult.ok).toBe(true);
		expect(rejectResult.rolledBack).toBe(false);

		const pending2 = await getPendingPaths(harness);
		expect(pending2.length).toBe(0);
	});

	it("rejected file is removed from turnLog after rollback", async () => {
		// Create actual file for rollback to delete
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v1", "utf-8");

		// Turn 0: Create src/app.ts with "v1"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Reject it (with diff for rollback)
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "v1" });
		const rejected = await callReject(harness, "src/app.ts");
		expect(rejected).toBe(true);

		// Call review.fileHistory — file was rolled back and removed from turnLog
		const historyData = await simulateInbound(harness, "review.fileHistory", {
			path: "src/app.ts",
		});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);

		console.log("[EdgeCase-7] fileHistory after rejection:", JSON.stringify(historyArr, null, 2));

		expect(historyArr.length).toBe(0);
	});
});

// ── Group 4: Approve/reject specific turn's file ─────────────────────

describe("Group 4: Approve/reject specific turn's file", () => {
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

	it("should independently approve/reject files from different turns", async () => {
		// Turn 0: Create src/a.ts and src/b.ts
		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added", "a-v1"),
			makeChange("src/b.ts", "added", "b-v1"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Approve only src/a.ts
		const approvedA = await callApprove(harness, "src/a.ts");
		expect(approvedA).toBe(true);

		// Turn 1: Modify src/a.ts to "v2"
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/a.ts", "modified", "a-v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Call review.pending — a.ts was approved then modified → reset to pending; b.ts still pending
		const pending = await getPendingDetailed(harness);

		console.log("[EdgeCase-8] pending after independent approve:", JSON.stringify(pending, null, 2));

		// Should show src/a.ts (pending, reset from approved) and src/b.ts (pending)
		expect(pending.length).toBe(2);

		const aEntry = pending.find((p) => p.path === "src/a.ts");
		expect(aEntry).toBeDefined();
		expect(aEntry!.fileStatus).toBe("modified");

		const bEntry = pending.find((p) => p.path === "src/b.ts");
		expect(bEntry).toBeDefined();
		expect(bEntry!.fileStatus).toBe("added");

		// Reject src/b.ts (with diff for rollback)
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "b-v1", "utf-8");
		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "b-v1" });
		const rejectedB = await callReject(harness, "src/b.ts");
		expect(rejectedB).toBe(true);

		// Call review.pending again
		const pending2 = await getPendingDetailed(harness);

		console.log("[EdgeCase-8] pending after rejecting b:", JSON.stringify(pending2, null, 2));

		// Should show 1 item (a.ts is pending after reset, b.ts is rejected)
		expect(pending2.length).toBe(1);
		expect(pending2[0]!.path).toBe("src/a.ts");

		// Verify approval history — approvals are per-path, latest status wins
		const approvalsData = await simulateInbound(harness, "review.approvals", {});
		const approvalsResult = extractResponse(approvalsData);
		const approvalsArr = (
			Array.isArray(approvalsResult) ? approvalsResult : Object.values(approvalsResult as Record<string, unknown>)
		) as Array<Record<string, unknown>>;

		// src/a.ts: pending (was approved, reset by re-modification)
		const aApproval = approvalsArr.find((a) => a.path === "src/a.ts");
		expect(aApproval).toBeDefined();
		expect(aApproval!.status).toBe("pending");

		// src/b.ts: rejected
		const bApproval = approvalsArr.find((a) => a.path === "src/b.ts");
		expect(bApproval).toBeDefined();
		expect(bApproval!.status).toBe("rejected");
	});
});

// ── Group 5: rejectAll and rollback ─────────────────────────────────

describe("rejectAll and rollback", () => {
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

	it("rejectAll should rollback all pending files", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "a.ts"), "content-a", "utf-8");
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "content-b", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added", "content-a"),
			makeChange("src/b.ts", "added", "content-b"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const pending1 = await getPendingPaths(harness);
		expect(pending1.length).toBe(2);

		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (filePath === "src/a.ts") return { oldContent: null, newContent: "content-a" };
			if (filePath === "src/b.ts") return { oldContent: null, newContent: "content-b" };
			return null;
		});

		const result = await callRejectAll(harness);
		expect(result.count).toBe(2);
		expect(result.rolledBack).toBe(2);

		const pending2 = await getPendingPaths(harness);
		expect(pending2.length).toBe(0);

		expect(existsSync(join(harness.tempDir, "src", "a.ts"))).toBe(false);
		expect(existsSync(join(harness.tempDir, "src", "b.ts"))).toBe(false);
	});

	it("rejectAll should restore modified files to original content", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "original", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "original")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		writeFileSync(join(harness.tempDir, "src", "app.ts"), "modified", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		harness.mockGetFileDiff.mockReturnValue({ oldContent: "original", newContent: "modified" });

		const result = await callRejectAll(harness);
		expect(result.count).toBe(1);
		expect(result.rolledBack).toBe(1);

		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("original");
	});

	it("rejectAll should restore deleted files", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "keep-me", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "keep-me")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		rmSync(join(harness.tempDir, "src", "app.ts"));

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		harness.mockGetFileDiff.mockReturnValue({ oldContent: "keep-me", newContent: null });

		const result = await callRejectAll(harness);
		expect(result.count).toBe(1);
		expect(result.rolledBack).toBe(1);

		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(true);
		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("keep-me");
	});

	it("reject should rollback single modified file", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "a.ts"), "v1", "utf-8");
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "v1", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added", "v1"),
			makeChange("src/b.ts", "added", "v1"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		writeFileSync(join(harness.tempDir, "src", "a.ts"), "v2", "utf-8");
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "v2", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "modified", "v2"),
			makeChange("src/b.ts", "modified", "v2"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		const pending1 = await getPendingPaths(harness);
		expect(pending1.length).toBe(2);

		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (filePath === "src/a.ts") return { oldContent: "v1", newContent: "v2" };
			if (filePath === "src/b.ts") return { oldContent: "v1", newContent: "v2" };
			return null;
		});

		const rejected = await callReject(harness, "src/a.ts");
		expect(rejected).toBe(true);

		expect(readFileSync(join(harness.tempDir, "src", "a.ts"), "utf-8")).toBe("v1");
		expect(readFileSync(join(harness.tempDir, "src", "b.ts"), "utf-8")).toBe("v2");

		const pending2 = await getPendingPaths(harness);
		expect(pending2.length).toBe(1);
		expect(pending2[0]!.path).toBe("src/b.ts");
	});

	it("approve should NOT rollback file", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v1", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v2", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		const approved = await callApprove(harness, "src/app.ts");
		expect(approved).toBe(true);

		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("v2");
	});

	it("rejectAll should only affect pending files, not already approved", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "a.ts"), "content-a", "utf-8");
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "content-b", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added", "content-a"),
			makeChange("src/b.ts", "added", "content-b"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const approved = await callApprove(harness, "src/a.ts");
		expect(approved).toBe(true);

		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (filePath === "src/b.ts") return { oldContent: null, newContent: "content-b" };
			return null;
		});

		const result = await callRejectAll(harness);
		expect(result.count).toBe(1);
		expect(result.rolledBack).toBe(1);

		expect(existsSync(join(harness.tempDir, "src", "b.ts"))).toBe(false);
		expect(existsSync(join(harness.tempDir, "src", "a.ts"))).toBe(true);
	});

	it("rejectAll should only roll back pending files, preserving approved files untouched", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "a.ts"), "// a-content", "utf-8");
		writeFileSync(join(harness.tempDir, "src", "b.ts"), "// b-content", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("src/a.ts", "added", "// a-content"),
			makeChange("src/b.ts", "added", "// b-content"),
		]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const approvedA = await callApprove(harness, "src/a.ts");
		expect(approvedA).toBe(true);

		writeFileSync(join(harness.tempDir, "src", "b.ts"), "// b-modified", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/b.ts", "modified", "// b-modified")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		const pendingBefore = await getPendingPaths(harness);
		expect(pendingBefore.length).toBe(1);
		expect(pendingBefore[0]!.path).toBe("src/b.ts");

		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (filePath === "src/b.ts") return { oldContent: "// b-content", newContent: "// b-modified" };
			return null;
		});

		const result = await callRejectAll(harness);
		expect(result.count).toBe(1);
		expect(result.rolledBack).toBe(1);

		expect(readFileSync(join(harness.tempDir, "src", "b.ts"), "utf-8")).toBe("// b-content");
		expect(readFileSync(join(harness.tempDir, "src", "a.ts"), "utf-8")).toBe("// a-content");

		const pendingAfter = await getPendingPaths(harness);
		expect(pendingAfter.length).toBe(0);
	});

	it("should handle multiple tool_result events within a single turn (last one wins)", async () => {
		await harness.fireTurnStart();

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/a.ts", "added", "// v1")]);
		await harness.fireToolResult();

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/a.ts", "modified", "// v2")]);
		await harness.fireToolResult();

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/a.ts", "modified", "// v3")]);
		await harness.fireToolResult();

		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		const pending = await getPendingDetailed(harness);
		expect(pending.length).toBe(1);
		expect(pending[0]!.path).toBe("src/a.ts");
		expect(pending[0]!.fileStatus).toBe("modified");

		const historyData = await simulateInbound(harness, "review.fileHistory", { path: "src/a.ts" });
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult)
			? historyResult
			: Object.values(historyResult as Record<string, unknown>);

		expect(historyArr.length).toBe(1);
		const entry = historyArr[0] as Record<string, unknown>;
		expect(entry.turnIndex).toBe(0);
		expect(entry.status).toBe("modified");

		const diff = entry.diff as Record<string, unknown>;
		expect(diff.newContent).toBe("// v3");
	});

	it("pending should aggregate by path across multiple turns", async () => {
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v1", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v2", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v2")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		writeFileSync(join(harness.tempDir, "src", "app.ts"), "v3", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "modified", "v3")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		const pending = await getPendingDetailed(harness);
		expect(pending.length).toBe(1);
		expect(pending[0]!.fileStatus).toBe("modified");

		harness.mockGetFileDiff.mockReturnValue({ oldContent: null, newContent: "v3" });

		const rejected = await callReject(harness, "src/app.ts");
		expect(rejected).toBe(true);

		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(false);
	});
});

// ── Group 6: Critical scenario — create → approve → delete → reject → delete again ──

describe("Critical scenario: create → approve → delete → reject (rollback) → delete again", () => {
	let harness: ReturnType<typeof createTestHarness>;
	const filePaths = ["a.ts", "b.ts", "c.ts"];
	const fileContents: Record<string, string> = {
		"a.ts": "// a",
		"b.ts": "// b",
		"c.ts": "// c",
	};

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("pending list should show all 3 files after full create → approve → delete → reject → delete cycle", async () => {
		// ── Step 1: Turn 0 — Create a.ts ("// a"), b.ts ("// b"), c.ts ("// c") ──
		for (const f of filePaths) {
			writeFileSync(join(harness.tempDir, f), fileContents[f], "utf-8");
		}
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "added", fileContents[f])));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Verify: all 3 files show as "added" in pending
		const pending1 = await getPendingDetailed(harness);
		expect(pending1).toHaveLength(3);
		const paths1 = pending1.map((p) => p.path).sort();
		expect(paths1).toEqual(["a.ts", "b.ts", "c.ts"]);
		for (const p of pending1) {
			expect(p.fileStatus).toBe("added");
			expect(p.status).toBe("pending");
		}

		// ── Step 2: Approve all (needed so subsequent delete is not net-zero filtered) ──
		const approveResult = await simulateInbound(harness, "review.approveAll", {});
		expect((approveResult as Record<string, unknown>).count).toBe(3);

		const pending2 = await getPendingPaths(harness);
		expect(pending2).toHaveLength(0);

		// ── Step 3: Turn 1 — Agent deletes all 3 files ──
		for (const f of filePaths) {
			rmSync(join(harness.tempDir, f), { force: true });
		}
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Verify: all 3 files show as "deleted" in pending
		// everApproved bypasses net-zero: firstStatus=added, latestFileStatus=deleted, but everApproved.has(path)
		const pending3 = await getPendingDetailed(harness);
		expect(pending3).toHaveLength(3);
		for (const p of pending3) {
			expect(p.fileStatus).toBe("deleted");
			expect(p.status).toBe("pending");
		}

		// ── Step 4: Reject all — rollback restores files from oldContent ──
		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (filePaths.includes(filePath)) {
				return { oldContent: fileContents[filePath], newContent: null };
			}
			return null;
		});

		const rejectResult = await callRejectAll(harness);
		expect(rejectResult.count).toBe(3);
		expect(rejectResult.rolledBack).toBe(3);

		// Verify: files restored on disk
		for (const f of filePaths) {
			expect(existsSync(join(harness.tempDir, f))).toBe(true);
			expect(readFileSync(join(harness.tempDir, f), "utf-8")).toBe(fileContents[f]);
		}

		// Verify: pending is empty (all rejected)
		const pending4 = await getPendingPaths(harness);
		expect(pending4).toHaveLength(0);

		// Verify: approval status is "rejected"
		const approvalsData = await simulateInbound(harness, "review.approvals", {});
		const approvalsResult = extractResponse(approvalsData);
		const approvalsArr = (
			Array.isArray(approvalsResult) ? approvalsResult : Object.values(approvalsResult as Record<string, unknown>)
		) as Array<Record<string, unknown>>;
		for (const f of filePaths) {
			const entry = approvalsArr.find((a) => a.path === f);
			expect(entry).toBeDefined();
			expect(entry!.status).toBe("rejected");
		}

		// ── Step 5: Turn 2 — Agent deletes all 3 files again ──
		for (const f of filePaths) {
			rmSync(join(harness.tempDir, f), { force: true });
		}
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// ── Step 6: Verify pending list shows all 3 files ──
		// turn_end should have reset status from "rejected" back to "pending"
		// pathMeta: firstStatus="deleted" (old entries removed by reject), latestFileStatus="deleted"
		// Net-zero: firstStatus !== "added" → NOT filtered
		const pending5 = await getPendingDetailed(harness);
		expect(pending5).toHaveLength(3);
		const paths5 = pending5.map((p) => p.path).sort();
		expect(paths5).toEqual(["a.ts", "b.ts", "c.ts"]);

		for (const p of pending5) {
			expect(p.fileStatus).toBe("deleted");
			expect(p.status).toBe("pending");
			expect(p.turnIndex).toBe(2);
		}
	});

	it("without prior approval: create → delete → rejectAll (no rollback) → delete → pending should still show files", async () => {
		// When getFileDiff returns null during reject (file created then deleted = null diff),
		// rollback fails and turnLog entries are preserved.
		// After re-deletion, net-zero still filters (firstStatus=added, latest=deleted, not everApproved).
		// This is the KNOWN LIMITATION — files won't appear because the full create→delete cycle
		// is treated as a no-op when never approved.

		// Step 1: Turn 0 — Create files
		for (const f of filePaths) {
			writeFileSync(join(harness.tempDir, f), fileContents[f], "utf-8");
		}
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "added", fileContents[f])));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Step 2: Turn 1 — Delete files
		for (const f of filePaths) {
			rmSync(join(harness.tempDir, f), { force: true });
		}
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Net-zero: firstStatus=added, latestFileStatus=deleted, not everApproved → filtered
		const pendingAfterDelete = await getPendingPaths(harness);
		expect(pendingAfterDelete).toHaveLength(0);

		// Step 3: Reject all — getFileDiff returns null (create→delete cycle = null diff)
		// so rollback fails, but approval is still set to "rejected"
		harness.mockGetFileDiff.mockReturnValue(null);
		const rejectResult = await callRejectAll(harness);
		expect(rejectResult.count).toBe(3);
		expect(rejectResult.rolledBack).toBe(0); // no rollback because diff is null

		// turnLog entries preserved (not removed because rolledBack=false)
		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		expect(historyArr).toHaveLength(2); // turn 0 and turn 1 still have entries

		// Step 4: Turn 2 — Delete files again
		harness.mockGetLiveChanges.mockReturnValue(filePaths.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// turn_end resets rejected→pending for changed files
		// BUT net-zero still applies: firstStatus=added (from turn 0), latestFileStatus=deleted (from turn 2)
		// and file was never approved → filtered!
		// This is expected behavior: create→delete→delete is still net-zero without approval.
		const pendingFinal = await getPendingPaths(harness);
		expect(pendingFinal).toHaveLength(0);
	});
});

// ── Group 7: Critical scenario — create → delete → rejectAll (with rollback) → delete again ──

describe("Critical scenario: create → delete → rejectAll (rollback restores) → delete again — WITHOUT prior approval", () => {
	let harness: ReturnType<typeof createTestHarness>;
	const files = ["a.ts", "b.ts"];
	const contents: Record<string, string> = { "a.ts": "// a", "b.ts": "// b" };

	beforeEach(async () => {
		harness = createTestHarness();
		await harness.fireSessionStart();
	});

	afterEach(() => {
		try {
			rmSync(harness.tempDir, { recursive: true, force: true });
		} catch {}
	});

	it("pending should show exactly 2 files after create → delete → rejectAll (rollback) → delete again", async () => {
		// ── Step 1: Turn 0 — Create a.ts ("// a"), b.ts ("// b") on disk ──
		for (const f of files) {
			writeFileSync(join(harness.tempDir, f), contents[f], "utf-8");
		}
		harness.mockGetLiveChanges.mockReturnValue(files.map((f) => makeChange(f, "added", contents[f])));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Verify: 2 files show as "added" in pending
		const pending1 = await getPendingDetailed(harness);
		expect(pending1).toHaveLength(2);
		for (const p of pending1) {
			expect(p.fileStatus).toBe("added");
			expect(p.status).toBe("pending");
		}

		// ── Step 2: Turn 1 — Delete both files ──
		for (const f of files) {
			rmSync(join(harness.tempDir, f), { force: true });
		}
		harness.mockGetLiveChanges.mockReturnValue(files.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Net-zero: firstStatus=added, latestFileStatus=deleted, not everApproved → 0 pending
		const pendingAfterDelete = await getPendingPaths(harness);
		expect(pendingAfterDelete).toHaveLength(0);

		// ── Step 3: rejectAll — getFileDiff returns oldContent so rollback restores files ──
		// This simulates the case where the snapshot manager has the original content
		// (e.g. files existed before session or were captured at turn_start)
		harness.mockGetFileDiff.mockImplementation(({ filePath }: { filePath: string }) => {
			if (contents[filePath] !== undefined) {
				return { oldContent: contents[filePath], newContent: null };
			}
			return null;
		});

		const rejectResult = await callRejectAll(harness);
		console.log("[Group7-Step3] rejectAll result:", JSON.stringify(rejectResult));
		expect(rejectResult.count).toBe(2);
		expect(rejectResult.rolledBack).toBe(2);

		// Verify: files restored on disk
		for (const f of files) {
			expect(existsSync(join(harness.tempDir, f))).toBe(true);
			expect(readFileSync(join(harness.tempDir, f), "utf-8")).toBe(contents[f]);
		}

		// Verify: pending is empty (all rejected)
		const pendingAfterReject = await getPendingPaths(harness);
		expect(pendingAfterReject).toHaveLength(0);

		// Verify: approval status is "rejected" for both files
		const approvalsData = await simulateInbound(harness, "review.approvals", {});
		const approvalsResult = extractResponse(approvalsData);
		const approvalsArr = (
			Array.isArray(approvalsResult) ? approvalsResult : Object.values(approvalsResult as Record<string, unknown>)
		) as Array<Record<string, unknown>>;
		for (const f of files) {
			const entry = approvalsArr.find((a) => a.path === f);
			expect(entry).toBeDefined();
			expect(entry!.status).toBe("rejected");
		}

		// Verify: turnLog entries for these files were removed (rollback cleared them)
		const historyData = await simulateInbound(harness, "review.history", {});
		const historyResult = extractResponse(historyData);
		const historyArr = Array.isArray(historyResult) ? historyResult : [];
		for (const record of historyArr) {
			const changes = (record as Record<string, unknown>).changes as Array<Record<string, unknown>>;
			for (const f of files) {
				expect(changes.find((c) => c.path === f)).toBeUndefined();
			}
		}

		// ── Step 4: Turn 2 — Agent deletes both files AGAIN ──
		for (const f of files) {
			rmSync(join(harness.tempDir, f), { force: true });
		}
		harness.mockGetLiveChanges.mockReturnValue(files.map((f) => makeChange(f, "deleted")));
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// turn_end should have reset "rejected" → "pending" for changed files

		// ── Step 5: Check pending list ──
		// After rollback cleared turnLog entries, the only entries for these paths
		// are from turn 2 (status: "deleted"). So:
		//   pathMeta: firstStatus="deleted", latestFileStatus="deleted"
		//   Net-zero check: firstStatus !== "added" → NOT filtered
		//   Approval status: reset from "rejected" to "pending" by turn_end
		// Expected: 2 files in pending
		const pendingFinal = await getPendingDetailed(harness);
		console.log("[Group7-Step5] pending final:", JSON.stringify(pendingFinal, null, 2));

		expect(pendingFinal).toHaveLength(2);

		const pathsFinal = pendingFinal.map((p) => p.path).sort();
		expect(pathsFinal).toEqual(["a.ts", "b.ts"]);

		for (const p of pendingFinal) {
			expect(p.fileStatus).toBe("deleted");
			expect(p.status).toBe("pending");
			expect(p.turnIndex).toBe(2);
		}
	});
});

// ── Group 8: Reject uses approvedSnapshotEntry as diff base ──

describe("Reject uses approved snapshot as diff base for rollback", () => {
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

	it("reject should rollback deleted file that was previously approved, using approved snapshot as diff base", async () => {
		const stepSnapshotEntry = { id: "snapshot-1", type: "custom", customType: "step-snapshot", data: {} };
		await harness.fireSessionStart({
			sessionManager: {
				getBranch: () => [],
				getEntries: () => [stepSnapshotEntry],
			},
		});

		// Turn 0: Create src/app.ts with "// v1"
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "// v1", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "// v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		// Approve src/app.ts — this records the approvedSnapshotEntry
		const approved = await callApprove(harness, "src/app.ts");
		expect(approved).toBe(true);

		// Turn 1: Delete src/app.ts
		rmSync(join(harness.tempDir, "src", "app.ts"));
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Verify pending shows src/app.ts as deleted
		const pending = await getPendingDetailed(harness);
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("src/app.ts");
		expect(pending[0]!.fileStatus).toBe("deleted");

		// Reject src/app.ts — mock getFileDiff to return oldContent ONLY when fromEntryId is passed
		harness.mockGetFileDiff.mockImplementation(
			({ filePath, fromEntryId }: { filePath: string; fromEntryId?: string }) => {
				if (filePath === "src/app.ts" && fromEntryId) {
					return { oldContent: "// v1", newContent: null };
				}
				return null;
			},
		);

		const rejectData = await simulateInbound(harness, "review.reject", { path: "src/app.ts" });
		const rejectResult = rejectData as Record<string, unknown>;
		expect(rejectResult.ok).toBe(true);
		expect(rejectResult.rolledBack).toBe(true);

		// Assert: file restored with "// v1" content
		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(true);
		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("// v1");
	});

	it("should rollback on second reject after approve → delete → reject → delete cycle", async () => {
		const stepSnapshotEntry = { id: "snapshot-1", type: "custom", customType: "step-snapshot", data: {} };
		await harness.fireSessionStart({
			sessionManager: {
				getBranch: () => [],
				getEntries: () => [stepSnapshotEntry],
			},
		});

		// Step 1: Create → approve
		mkdirSync(join(harness.tempDir, "src"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "app.ts"), "// v1", "utf-8");

		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "added", "// v1")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(0);

		await callApprove(harness, "src/app.ts");

		// Step 2: Delete
		rmSync(join(harness.tempDir, "src", "app.ts"));
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(1);

		// Step 3: Reject — file restored
		harness.mockGetFileDiff.mockImplementation(
			({ filePath, fromEntryId }: { filePath: string; fromEntryId?: string }) => {
				if (filePath === "src/app.ts" && fromEntryId) {
					return { oldContent: "// v1", newContent: null };
				}
				return null;
			},
		);

		const reject1 = await simulateInbound(harness, "review.reject", { path: "src/app.ts" });
		expect((reject1 as Record<string, unknown>).rolledBack).toBe(true);
		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(true);
		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("// v1");

		// Step 4: Delete again
		rmSync(join(harness.tempDir, "src", "app.ts"));
		harness.mockGetLiveChanges.mockReturnValue([makeChange("src/app.ts", "deleted")]);
		await harness.fireTurnStart();
		await harness.fireToolResult();
		harness.mockGetLiveChanges.mockReturnValue([]);
		await harness.fireTurnEnd(2);

		// Step 5: Reject again — second reject should also restore the file
		harness.mockGetFileDiff.mockImplementation(
			({ filePath, fromEntryId }: { filePath: string; fromEntryId?: string }) => {
				if (filePath === "src/app.ts" && fromEntryId) {
					return { oldContent: "// v1", newContent: null };
				}
				return null;
			},
		);

		const reject2 = await simulateInbound(harness, "review.reject", { path: "src/app.ts" });
		expect((reject2 as Record<string, unknown>).ok).toBe(true);
		expect((reject2 as Record<string, unknown>).rolledBack).toBe(true);
		expect(existsSync(join(harness.tempDir, "src", "app.ts"))).toBe(true);
		expect(readFileSync(join(harness.tempDir, "src", "app.ts"), "utf-8")).toBe("// v1");
	});
});
