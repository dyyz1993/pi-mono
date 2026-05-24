import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_REVIEW_CHANNEL_NAME, type FileReviewChannelContract } from "../../extensions/file-review/contract.js";
import fileReviewFactory from "../../extensions/file-review/index.js";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createTypedChannel } from "../../src/core/extensions/channel-factory.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { Channel, ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/types.js";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.js";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, relativePath: string): string {
	const absolute = join(tempDir, relativePath);
	return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

function writeFile(tempDir: string, relativePath: string, content: string): void {
	const absolute = join(tempDir, relativePath);
	mkdirSync(join(absolute, ".."), { recursive: true });
	writeFileSync(absolute, content, "utf-8");
}

interface PendingInvoke {
	resolve: (data: unknown) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

function createLoopbackChannel(name: string): {
	channel: Channel;
	callMethod: (method: string, params: Record<string, unknown>) => Promise<unknown>;
} {
	const handlers: ((data: unknown) => void)[] = [];
	const pendingInvokes = new Map<string, PendingInvoke>();

	const channel: Channel = {
		name,
		send: (data: unknown) => {
			const msg = data as Record<string, unknown>;
			if (msg && typeof msg.invokeId === "string") {
				const pending = pendingInvokes.get(msg.invokeId);
				if (pending) {
					clearTimeout(pending.timer);
					pendingInvokes.delete(msg.invokeId);
					pending.resolve(msg);
					return;
				}
			}
			for (const handler of handlers) {
				try {
					handler(data);
				} catch {}
			}
		},
		onReceive: (handler: (data: unknown) => void) => {
			handlers.push(handler);
			return () => {
				const idx = handlers.indexOf(handler);
				if (idx >= 0) handlers.splice(idx, 1);
			};
		},
		invoke: () => Promise.reject(new Error("not implemented")),
		call: () => Promise.reject(new Error("not implemented")),
	};

	const callMethod = (method: string, params: Record<string, unknown>): Promise<unknown> => {
		return new Promise((resolve, reject) => {
			const invokeId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const timer = setTimeout(() => {
				pendingInvokes.delete(invokeId);
				reject(new Error(`Channel call "${method}" timed out`));
			}, 5000);

			pendingInvokes.set(invokeId, { resolve, reject, timer });

			const payload = { ...params, __call: method, invokeId };
			for (const handler of handlers) {
				try {
					handler(payload);
				} catch {}
			}
		});
	};

	return { channel, callMethod };
}

function createChannelRegistry() {
	const channels = new Map<string, ReturnType<typeof createLoopbackChannel>>();

	const registerChannel = (name: string): Channel => {
		let entry = channels.get(name);
		if (!entry) {
			entry = createLoopbackChannel(name);
			channels.set(name, entry);
		}
		return entry.channel;
	};

	const call = async (channelName: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
		const entry = channels.get(channelName);
		if (!entry) throw new Error(`Channel "${channelName}" not registered`);
		return entry.callMethod(method, params);
	};

	return { registerChannel, call };
}

describe("file-review reapprove: full harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function createHarnessWithChannels(): Promise<{
		harness: Harness;
		reviewCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
	}> {
		const channelRegistry = createChannelRegistry();

		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({
			registerChannel: channelRegistry.registerChannel,
		});

		const reviewCall = (method: string, params: Record<string, unknown> = {}) =>
			channelRegistry.call("file-review", method, params);

		return { harness, reviewCall };
	}

	async function getPendingPaths(
		reviewCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
	): Promise<Array<{ turnIndex: number; path: string; status: string }>> {
		const raw = await reviewCall("review.pending");
		const data = raw as Record<string, unknown>;
		const result = data?.result ?? data;
		if (Array.isArray(result)) {
			return result as Array<{ turnIndex: number; path: string; status: string }>;
		}
		if (result && typeof result === "object") {
			const entries = Object.values(result as Record<string, unknown>);
			return entries as Array<{ turnIndex: number; path: string; status: string }>;
		}
		return [];
	}

	it("approved file reappears as pending after re-modification", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create src/app.ts");
		expect(readFile(harness.tempDir, "src/app.ts")).toBe("v1");

		let pending = await getPendingPaths(reviewCall);
		expect(pending.length).toBeGreaterThanOrEqual(1);
		expect(pending.some((p) => p.path === "src/app.ts")).toBe(true);

		const approveResult = (await reviewCall("review.approve", {
			path: "src/app.ts",
		})) as Record<string, unknown>;
		const approveData = (approveResult?.result ?? approveResult) as { ok: boolean };
		expect(approveData.ok).toBe(true);

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/app.ts")).toBe(false);

		writeFile(harness.tempDir, "src/app.ts", "v2");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "v2-modified" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("modify src/app.ts");
		expect(readFile(harness.tempDir, "src/app.ts")).toBe("v2-modified");

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/app.ts")).toBe(true);
	});

	it("should track multiple turns of modifications with approvals", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "feature.ts", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create feature.ts v1");
		expect(readFile(harness.tempDir, "feature.ts")).toBe("v1");

		let pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "feature.ts")).toBe(true);
		await reviewCall("review.approve", { path: "feature.ts" });

		writeFile(harness.tempDir, "feature.ts", "v2");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "feature.ts", content: "v2-mod" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("update feature.ts v2");

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "feature.ts")).toBe(true);

		writeFile(harness.tempDir, "feature.ts", "v3");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "feature.ts", content: "v3-mod" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("update feature.ts v3");

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "feature.ts")).toBe(true);
	});

	it("should handle approveAll then re-modified file reappears as pending", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "a.ts", content: "av1" }),
					fauxToolCall("write", { path: "b.ts", content: "bv1" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create a.ts and b.ts");
		expect(readFile(harness.tempDir, "a.ts")).toBe("av1");
		expect(readFile(harness.tempDir, "b.ts")).toBe("bv1");

		const approveAllResult = (await reviewCall("review.approveAll")) as Record<string, unknown>;
		const approveAllData = (approveAllResult?.result ?? approveAllResult) as { count: number };
		expect(approveAllData.count).toBeGreaterThanOrEqual(2);

		let pending = await getPendingPaths(reviewCall);
		expect(pending.length).toBe(0);

		writeFile(harness.tempDir, "a.ts", "av2");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "av2-mod" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify a.ts");

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "a.ts")).toBe(true);
		expect(pending.some((p) => p.path === "b.ts")).toBe(false);
	});

	it("should show approved file as pending after multiple modifications with correct diff tracking", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/example.ts", content: "// initial" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create src/example.ts");
		expect(readFile(harness.tempDir, "src/example.ts")).toBe("// initial");

		let pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/example.ts")).toBe(true);

		const approveResult = (await reviewCall("review.approve", { path: "src/example.ts" })) as Record<string, unknown>;
		const approveData = (approveResult?.result ?? approveResult) as { ok: boolean };
		expect(approveData.ok).toBe(true);

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/example.ts")).toBe(false);

		writeFile(harness.tempDir, "src/example.ts", "// modified v1");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/example.ts", content: "// modified v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify src/example.ts v1");
		expect(readFile(harness.tempDir, "src/example.ts")).toBe("// modified v1");

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/example.ts")).toBe(true);
		const v1Entry = pending.find((p) => p.path === "src/example.ts");
		expect(v1Entry?.status).toBe("pending");
		expect(v1Entry?.fileStatus).toBe("modified");

		const historyResult = await reviewCall("review.fileHistory", { path: "src/example.ts" });
		const historyArray = (historyResult as Record<string, unknown>).result as Array<{
			turnIndex: number;
			status: string;
			diff: { oldContent: string | null; newContent: string | null };
		}>;
		expect(historyArray).toBeDefined();
		expect(historyArray.length).toBeGreaterThanOrEqual(2);
		expect(historyArray[0].status).toBe("added");
		expect(historyArray[0].diff?.oldContent).toBe(null);
		expect(historyArray[0].diff?.newContent).toBe("// initial");
		expect(historyArray[1].status).toBe("modified");
		expect(historyArray[1].diff?.oldContent).toBe("// initial");
		expect(historyArray[1].diff?.newContent).toBe("// modified v1");
	});

	it("should show approved deleted file with correct diff matching approved content", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		const approvedContent = "# Important Notes\n- Point A\n- Point B";
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/notes.md", content: approvedContent }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create src/notes.md");
		expect(readFile(harness.tempDir, "src/notes.md")).toBe(approvedContent);

		let pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/notes.md")).toBe(true);

		const historyResult = await reviewCall("review.fileHistory", { path: "src/notes.md" });
		const history = (historyResult as Record<string, unknown>).result as Array<{
			turnIndex: number;
			status: string;
			diff: { oldContent: string | null; newContent: string | null };
		}>;
		expect(history).toBeDefined();
		expect(history.length).toBeGreaterThanOrEqual(1);
		expect(history[0].status).toBe("added");
		expect(history[0].diff?.oldContent).toBe(null);
		expect(history[0].diff?.newContent).toBe(approvedContent);

		const approveResult = (await reviewCall("review.approve", { path: "src/notes.md" })) as Record<string, unknown>;
		const approveData = (approveResult?.result ?? approveResult) as { ok: boolean };
		expect(approveData.ok).toBe(true);

		pending = await getPendingPaths(reviewCall);
		expect(pending.some((p) => p.path === "src/notes.md")).toBe(false);

		const approvalsResult = await reviewCall("review.approvals");
		const approvalArray = (approvalsResult as Record<string, unknown>).result as Array<{
			path: string;
			status: string;
		}>;
		const notesApproval = approvalArray?.find((a) => a.path === "src/notes.md");
		expect(notesApproval?.status).toBe("approved");
	});

	it("should show diff from approved version when file is modified after approval", async () => {
		const { harness, reviewCall } = await createHarnessWithChannels();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "// initial content" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create src/app.ts");
		expect(readFile(harness.tempDir, "src/app.ts")).toBe("// initial content");

		const approveResult = (await reviewCall("review.approve", { path: "src/app.ts" })) as Record<string, unknown>;
		const approveData = (approveResult?.result ?? approveResult) as { ok: boolean };
		expect(approveData.ok).toBe(true);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("write", { path: "src/app.ts", content: "// initial content\n// added line" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify src/app.ts");

		const raw = await reviewCall("review.pending");
		const pendingResult = ((raw as Record<string, unknown>).result ?? raw) as Array<{
			path: string;
			oldContent: string | null;
			newContent: string | null;
		}>;
		const entry = pendingResult.find((p) => p.path === "src/app.ts");
		expect(entry).toBeDefined();
		expect(entry!.oldContent).toBe("// initial content");
		expect(entry!.newContent).toBe("// initial content\n// added line");
	});

	it("should restore approvedSnapshotEntry on session restart and show correct diff base", async () => {
		const sharedTempDir = join(tmpdir(), `pi-restart-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(sharedTempDir, { recursive: true });

		try {
			// ── Phase 1: create, modify, approve ──

			const channelRegistry1 = createChannelRegistry();
			const harness1 = await createHarness({
				extensionFactories: [fileSnapshotFactory, fileReviewFactory],
				cwd: sharedTempDir,
			});

			await harness1.session.bindExtensions({
				registerChannel: channelRegistry1.registerChannel,
			});

			const reviewCall1 = (method: string, params: Record<string, unknown> = {}) =>
				channelRegistry1.call("file-review", method, params);

			// Turn 0: create src/app.ts with "// v1"
			harness1.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "// v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness1.session.prompt("create src/app.ts");
			expect(readFile(sharedTempDir, "src/app.ts")).toBe("// v1");

			// Turn 1: modify src/app.ts to "// v2"
			harness1.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "// v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness1.session.prompt("modify src/app.ts");
			expect(readFile(sharedTempDir, "src/app.ts")).toBe("// v2");

			// Approve src/app.ts
			const approveResult = (await reviewCall1("review.approve", {
				path: "src/app.ts",
			})) as Record<string, unknown>;
			const approveData = (approveResult?.result ?? approveResult) as { ok: boolean };
			expect(approveData.ok).toBe(true);

			// Capture custom entries from the first session
			const allEntries = harness1.sessionManager.getEntries();
			const customEntries = allEntries.filter((e) => e.type === "custom") as Array<{
				type: "custom";
				customType: string;
				data: unknown;
				id: string;
				parentId: string | null;
				timestamp: string;
			}>;

			// Dispose harness1 (keep sharedTempDir)
			harness1.session.dispose();
			harness1.faux.unregister();

			// ── Phase 2: simulate session restart ──

			const channelRegistry2 = createChannelRegistry();
			const harness2 = await createHarness({
				extensionFactories: [fileSnapshotFactory, fileReviewFactory],
				cwd: sharedTempDir,
			});

			// Pre-populate session manager with custom entries from the first session
			for (const entry of customEntries) {
				harness2.sessionManager.appendCustomEntry(entry.customType, entry.data);
			}

			// Bind extensions (fires session_start which restores file-review state)
			await harness2.session.bindExtensions({
				registerChannel: channelRegistry2.registerChannel,
			});

			// After bindExtensions, file-snapshot's initialize() cleared the snapshot index.
			// Rebuild it from the pre-populated entries so getFileDiff can resolve old snapshots.
			harness2.session.fileSnapshotManager?.rebuildIndex(harness2.sessionManager.getEntries());

			const reviewCall2 = (method: string, params: Record<string, unknown> = {}) =>
				channelRegistry2.call("file-review", method, params);

			// Verify approvals were restored
			const approvalsRaw = await reviewCall2("review.approvals", {});
			const approvalsArr = ((approvalsRaw as Record<string, unknown>)?.result ?? approvalsRaw) as Array<{
				path: string;
				status: string;
			}>;
			const approvedEntry = approvalsArr.find((a) => a.path === "src/app.ts");
			expect(approvedEntry).toBeDefined();
			expect(approvedEntry!.status).toBe("approved");

			// Turn 2: modify src/app.ts to "// v2\n// v3"
			harness2.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "src/app.ts", content: "// v2\n// v3" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness2.session.prompt("modify src/app.ts again");
			expect(readFile(sharedTempDir, "src/app.ts")).toBe("// v2\n// v3");

			// Verify review.pending shows correct diff
			const raw = await reviewCall2("review.pending");
			const pendingResult = ((raw as Record<string, unknown>)?.result ?? raw) as Array<{
				path: string;
				oldContent: string | null;
				newContent: string | null;
				status: string;
			}>;

			const pending = pendingResult.find((p) => p.path === "src/app.ts");
			expect(pending).toBeDefined();
			expect(pending!.status).toBe("pending");
			expect(pending!.oldContent).toBe("// v2");
			expect(pending!.newContent).toBe("// v2\n// v3");

			// Cleanup
			harness2.session.dispose();
			harness2.faux.unregister();
		} finally {
			rmSync(sharedTempDir, { recursive: true, force: true });
		}
	});
});

describe("E2E: approvals and approvedSnapshotEntry survive session restart with correct diff", () => {
	function extractResponse(data: unknown): unknown {
		const d = data as Record<string, unknown>;
		if ("result" in d && d.result !== undefined) return d.result;
		const { invokeId: _, ...rest } = d;
		return rest;
	}

	async function simulateInbound(
		harness: ReturnType<typeof createTestHarness>,
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		const invokeId = `inv_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

		const tempDir = join(tmpdir(), `pi-e2e-restart-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

		function makeCtx(overrides?: Record<string, unknown>): ExtensionContext {
			return {
				sessionManager: { getBranch: () => [], getEntries: () => [] },
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

	async function getPendingWithContent(harness: ReturnType<typeof createTestHarness>): Promise<
		Array<{
			turnIndex: number;
			path: string;
			status: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>
	> {
		const data = await simulateInbound(harness, "review.pending", {});
		const result = extractResponse(data);
		const arr = Array.isArray(result) ? result : [];
		return arr.map((item: Record<string, unknown>) => ({
			turnIndex: item.turnIndex as number,
			path: item.path as string,
			status: item.status as string,
			fileStatus: item.fileStatus as string,
			oldContent: item.oldContent as string | null,
			newContent: item.newContent as string | null,
		}));
	}

	async function callApprove(harness: ReturnType<typeof createTestHarness>, path: string): Promise<boolean> {
		const data = await simulateInbound(harness, "review.approve", { path });
		return (data as Record<string, unknown>).ok as boolean;
	}

	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		tempDirs.length = 0;
	});

	it("restores approvals, everApproved, approvedSnapshotEntry from persisted entries", async () => {
		// ── Phase 1: Create session with approvals ──

		const harness = createTestHarness();
		tempDirs.push(harness.tempDir);
		await harness.fireSessionStart();

		harness.mockGetLiveChanges.mockReturnValue([
			makeChange("a.ts", "added", "// a"),
			makeChange("b.ts", "added", "// b"),
			makeChange("c.ts", "added", "// c"),
		]);
		await harness.fireTurnStart();
		await harness.fireTurnEnd(0);

		expect(await callApprove(harness, "a.ts")).toBe(true);
		expect(await callApprove(harness, "b.ts")).toBe(true);
		expect(await callApprove(harness, "c.ts")).toBe(true);

		const pending1 = await getPendingPaths(harness);
		expect(pending1).toHaveLength(0);

		const approvalsData1 = await simulateInbound(harness, "review.approvals", {});
		const approvalsResult1 = extractResponse(approvalsData1);
		const approvalsArr1 = (
			Array.isArray(approvalsResult1) ? approvalsResult1 : Object.values(approvalsResult1 as Record<string, unknown>)
		) as Array<Record<string, unknown>>;
		expect(approvalsArr1).toHaveLength(3);
		expect(approvalsArr1.every((a) => a.status === "approved")).toBe(true);

		const persistedTurnEntries = harness.appendEntries.filter((e) => e.type === "file-review-turn");
		const persistedApprovalEntries = harness.appendEntries.filter((e) => e.type === "file-approval");
		expect(persistedTurnEntries).toHaveLength(1);
		expect(persistedApprovalEntries).toHaveLength(3);

		// ── Phase 2: Simulate restart by replaying entries ──

		const harness2 = createTestHarness();
		tempDirs.push(harness2.tempDir);

		const SNAPSHOT_ID = "snap-e2e-001";
		const mockSessionManager = {
			getBranch: () => [],
			getEntries: () => [
				{
					type: "custom",
					customType: "step-snapshot",
					id: SNAPSHOT_ID,
					data: {},
				},
				...persistedTurnEntries.map((e) => ({
					type: "custom" as const,
					customType: "file-review-turn",
					data: e.data,
				})),
				...persistedApprovalEntries.map((e) => ({
					type: "custom" as const,
					customType: "file-approval",
					data: e.data,
				})),
			],
		};

		await harness2.fireSessionStart({ sessionManager: mockSessionManager });

		const approvalsData2 = await simulateInbound(harness2, "review.approvals", {});
		const approvalsResult2 = extractResponse(approvalsData2);
		const approvalsArr2 = (
			Array.isArray(approvalsResult2) ? approvalsResult2 : Object.values(approvalsResult2 as Record<string, unknown>)
		) as Array<Record<string, unknown>>;
		const approvedItems = approvalsArr2.filter((a) => a.status === "approved");
		expect(approvedItems).toHaveLength(3);

		const pending2 = await getPendingPaths(harness2);
		expect(pending2).toHaveLength(0);

		// ── Phase 3: Verify behavior after restart ──

		harness2.mockGetLiveChanges.mockReturnValue([makeChange("a.ts", "modified", "// a modified")]);

		harness2.mockGetFileDiff.mockImplementation((opts: Record<string, unknown>) => {
			if (opts.filePath === "a.ts" && opts.fromEntryId === SNAPSHOT_ID) {
				return {
					path: "a.ts",
					oldContent: "// a",
					newContent: "// a modified",
					oldHash: "hash-old-a",
					newHash: "hash-new-a",
					unifiedDiff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-// a\n+// a modified",
				};
			}
			return null;
		});

		await harness2.fireTurnStart();
		await harness2.fireTurnEnd(1);

		const pending3 = await getPendingWithContent(harness2);
		expect(pending3).toHaveLength(1);
		expect(pending3[0]).toEqual(
			expect.objectContaining({
				path: "a.ts",
				status: "pending",
				fileStatus: "modified",
				oldContent: "// a",
				newContent: "// a modified",
			}),
		);

		expect(harness2.mockGetFileDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				filePath: "a.ts",
				fromEntryId: SNAPSHOT_ID,
			}),
		);

		const pendingPaths = pending3.map((p) => p.path);
		expect(pendingPaths).not.toContain("b.ts");
		expect(pendingPaths).not.toContain("c.ts");
	});
});
