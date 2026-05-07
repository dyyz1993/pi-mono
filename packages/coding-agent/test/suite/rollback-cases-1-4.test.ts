import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, path: string): string {
	const abs = join(tempDir, path);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function writeFile(tempDir: string, path: string, content: string): void {
	const abs = join(tempDir, path);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

function deleteFile(tempDir: string, path: string): void {
	const abs = join(tempDir, path);
	if (existsSync(abs)) unlinkSync(abs);
}

function fileExists(tempDir: string, path: string): boolean {
	return existsSync(join(tempDir, path));
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string,
	targetId: string,
): boolean {
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = startId;
	while (current !== null) {
		if (current === targetId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}

function findSnapshotsOnPath(
	entries: Array<{ id: string; parentId: string | null; type: string; customType?: string; data?: unknown }>,
	leafId: string | null,
): Map<string, string> {
	const result = new Map<string, string>();
	if (!leafId) return result;

	const snapEntries = entries.filter(
		(e) => e.type === "custom" && e.customType === "file-snapshot" && isOnPathTo(entries, leafId, e.id),
	);

	for (const entry of snapEntries) {
		if (entry.type !== "custom") continue;
		const data = entry.data as { path?: string; content?: string };
		if (data?.path && data.content !== undefined) {
			result.set(data.path, data.content);
		}
	}
	return result;
}

function createSnapshotAndRestoreExtension(
	restoreLog: Array<{ action: string; paths: string[] }>,
	decision: { value: "files" | "messages-only" },
) {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("tool_result", async (event, ctx) => {
			if (event.toolName === "write" || event.toolName === "edit") {
				const path = event.input?.path as string | undefined;
				if (path) {
					try {
						pi.appendEntry("file-snapshot", {
							path,
							content: readFileSync(join(ctx.cwd, path), "utf-8"),
						});
					} catch {
						// ignore
					}
				}
			}
		});

		pi.on("session_tree", async (event, ctx) => {
			if (event.skipFiles) {
				const entries = ctx.sessionManager.getEntries();
				const targetFiles = findSnapshotsOnPath(entries, event.newLeafId);
				const currentFiles = findSnapshotsOnPath(entries, event.oldLeafId);
				const allPaths = new Set([...targetFiles.keys(), ...currentFiles.keys()]);
				if (allPaths.size > 0) {
					restoreLog.push({ action: "skip", paths: [...allPaths] });
				}
				return;
			}

			const targetId = event.newLeafId;
			if (!targetId) return;

			const entries = ctx.sessionManager.getEntries();
			const targetFiles = findSnapshotsOnPath(entries, targetId);
			const currentFiles = findSnapshotsOnPath(entries, event.oldLeafId);

			const filesToRestore = new Map<string, string | undefined>();
			for (const [path, content] of targetFiles) {
				filesToRestore.set(path, content);
			}
			for (const path of currentFiles.keys()) {
				if (!targetFiles.has(path)) {
					filesToRestore.set(path, undefined);
				}
			}

			if (filesToRestore.size === 0) return;

			if (decision.value === "messages-only") {
				restoreLog.push({ action: "skip", paths: [...filesToRestore.keys()] });
				return;
			}

			for (const [path, content] of filesToRestore) {
				if (content === undefined) {
					deleteFile(ctx.cwd, path);
				} else {
					writeFile(ctx.cwd, path, content);
				}
			}
			restoreLog.push({ action: "restore", paths: [...filesToRestore.keys()] });
		});
	};
}

function createCompactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: "Compacted summary of earlier turns.",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: { source: "test-extension" },
			},
		}));
	};
}

describe("rollback cases 1-4", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Case 1: basic rollback restores files", async () => {
		const restoreLog: Array<{ action: string; paths: string[] }> = [];
		const decision = { value: "files" as const };

		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(restoreLog, decision)],
		});
		harnesses.push(harness);

		// Turn 1: Create file A
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file A"),
		]);
		await harness.session.prompt("create file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2: Create file B
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file B"),
		]);
		await harness.session.prompt("create file B");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3: Modify file B
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified file B"),
		]);
		await harness.session.prompt("modify file B");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v2");

		// Rollback to after turn 1
		await harness.session.navigateTree(afterTurn1, { summarize: false });

		// fileA exists as created in turn 1
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		// fileB was created after turn 1, should be removed
		expect(fileExists(harness.tempDir, "fileB.ts")).toBe(false);

		// Only turn 1 messages should remain
		const messages = harness.session.messages;
		const userMsgs = messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);

		expect(restoreLog.length).toBeGreaterThanOrEqual(1);
		expect(restoreLog[0].action).toBe("restore");
	});

	it("Case 2: message-only rollback skips file restoration", async () => {
		const restoreLog: Array<{ action: string; paths: string[] }> = [];
		const decision = { value: "messages-only" as const };

		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(restoreLog, decision)],
		});
		harnesses.push(harness);

		// Turn 1: Create fileA v1
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA v1"),
		]);
		await harness.session.prompt("create fileA v1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2: Modify fileA v2
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileA to v2"),
		]);
		await harness.session.prompt("modify fileA to v2");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3: Modify fileA v3
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v3" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileA to v3"),
		]);
		await harness.session.prompt("modify fileA to v3");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v3");

		// Rollback to after turn 2 with decision=messages-only
		await harness.session.navigateTree(afterTurn2, { summarize: false });

		// Files unchanged - still v3
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v3");

		// Messages show only turns 1-2
		const messages = harness.session.messages;
		const userMsgs = messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(2);

		expect(restoreLog.length).toBeGreaterThanOrEqual(1);
		expect(restoreLog[0].action).toBe("skip");
	});

	it("Case 3: rollback after compaction with skipFiles=true", async () => {
		const restoreLog: Array<{ action: string; paths: string[] }> = [];
		const decision = { value: "messages-only" as const };

		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(restoreLog, decision), createCompactionExtension()],
		});
		harnesses.push(harness);

		// Turn 1
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileB"),
		]);
		await harness.session.prompt("modify fileB");

		// Turn 4
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileA"),
		]);
		await harness.session.prompt("modify fileA");

		// Compact turns 1-2
		await harness.session.compact();

		// Verify compaction happened
		const compactionEntries = harness.sessionManager.getEntries().filter((e) => e.type === "compaction");
		expect(compactionEntries.length).toBeGreaterThanOrEqual(1);

		// Rollback to after turn 2 with skipFiles=true
		await harness.session.navigateTree(afterTurn2, { summarize: false, skipFiles: true });

		// Files unchanged - fileA at A-v2, fileB at B-v2
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v2");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v2");

		// Compaction entry should no longer be in the active branch messages
		const messages = harness.session.messages;
		const compactionInMessages = messages.filter((m) => m.role === "compactionSummary");
		expect(compactionInMessages.length).toBe(0);

		// Original messages from turns 1-2 should be visible
		const userMsgs = messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(2);
	});

	it("Case 4: rollback after compaction restores files", async () => {
		const restoreLog: Array<{ action: string; paths: string[] }> = [];
		const decision = { value: "files" as const };

		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(restoreLog, decision), createCompactionExtension()],
		});
		harnesses.push(harness);

		// Turn 1
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileB"),
		]);
		await harness.session.prompt("modify fileB");

		// Turn 4
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileA"),
		]);
		await harness.session.prompt("modify fileA");

		// Compact turns 1-2
		await harness.session.compact();

		// Verify compaction happened
		const compactionEntries = harness.sessionManager.getEntries().filter((e) => e.type === "compaction");
		expect(compactionEntries.length).toBeGreaterThanOrEqual(1);

		// Rollback to after turn 2 with skipFiles=false (default)
		await harness.session.navigateTree(afterTurn2, { summarize: false, skipFiles: false });

		// Files restored to turn 2 state: fileA=v1, fileB=v1
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");

		// Compaction gone from messages
		const messages = harness.session.messages;
		const compactionInMessages = messages.filter((m) => m.role === "compactionSummary");
		expect(compactionInMessages.length).toBe(0);

		// Original messages from turns 1-2 visible
		const userMsgs = messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(2);

		expect(restoreLog.length).toBeGreaterThanOrEqual(1);
		expect(restoreLog[0].action).toBe("restore");
	});
});
