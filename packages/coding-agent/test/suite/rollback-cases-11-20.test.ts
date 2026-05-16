import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
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

function deleteFile(tempDir: string, relativePath: string): void {
	const absolute = join(tempDir, relativePath);
	if (existsSync(absolute)) rmSync(absolute);
}

function fileExists(tempDir: string, relativePath: string): boolean {
	return existsSync(join(tempDir, relativePath));
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string | null,
	targetId: string,
): boolean {
	if (!startId) return false;
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

function createSnapshotAndRestoreExtension() {
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
			if (event.skipFiles) return;
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
			for (const [path, content] of filesToRestore) {
				if (content === undefined) {
					deleteFile(ctx.cwd, path);
				} else {
					writeFile(ctx.cwd, path, content);
				}
			}
		});
	};
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: `compacted: ${event.preparation.firstKeptEntryId}`,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

describe("rollback cases 11-20", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Case 11: rollback ALL to root is rejected (safety guard prevents message loss)", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");
		expect(fileExists(harness.tempDir, "fileA.ts")).toBe(true);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2");
		expect(fileExists(harness.tempDir, "fileB.ts")).toBe(true);

		const userMsgsBefore = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgsBefore.length).toBe(2);

		// Navigate to the root entry — this would eliminate all user messages,
		// so the safety guard should reject it.
		const entries = harness.sessionManager.getEntries();
		const firstEntry = entries.find((e) => e.parentId === null);
		expect(firstEntry).toBeDefined();

		const result = await harness.session.navigateTree(firstEntry!.id, { summarize: false });

		// Navigation should be cancelled (safety guard)
		expect(result.cancelled).toBe(true);
		expect(result.reason).toBeDefined();

		// Messages should still be present (not destroyed)
		const userMsgsAfter = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgsAfter.length).toBe(2);
	});

	it("Case 12: no-op when navigating to current leaf", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");

		const currentLeaf = harness.sessionManager.getLeafId()!;
		const msgCountBefore = harness.session.messages.length;

		const result = await harness.session.navigateTree(currentLeaf, { summarize: false });
		expect(result.cancelled).toBe(false);

		const msgCountAfter = harness.session.messages.length;
		expect(msgCountAfter).toBe(msgCountBefore);
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
	});

	it("Case 13: rollback invalid entry throws error", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		await expect(harness.session.navigateTree("nonexistent-entry-id", { summarize: false })).rejects.toThrow();
	});

	it("Case 14: rollback with subdirectory files restores nested paths", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/components/App.tsx", content: "App-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create nested file");
		expect(readFile(harness.tempDir, "src/components/App.tsx")).toBe("App-v1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "src/components/App.tsx", content: "App-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify nested file");
		expect(readFile(harness.tempDir, "src/components/App.tsx")).toBe("App-v2");

		await harness.session.navigateTree(afterTurn1, { summarize: false });
		expect(readFile(harness.tempDir, "src/components/App.tsx")).toBe("App-v1");
	});

	it("Case 15: multiple files modified in one turn, all restored on rollback", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create a");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("step 1"),
		]);
		await harness.session.prompt("modify a");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "b.ts", content: "b1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create b");
		expect(readFile(harness.tempDir, "a.ts")).toBe("a2");
		expect(readFile(harness.tempDir, "b.ts")).toBe("b1");

		await harness.session.navigateTree(afterTurn1, { summarize: false });

		expect(readFile(harness.tempDir, "a.ts")).toBe("a1");
		expect(fileExists(harness.tempDir, "b.ts")).toBe(false);
	});

	it("Case 16: rollback after compaction + new turn restores correctly", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "x.ts", content: "x1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "x.ts", content: "x2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2");

		await harness.session.compact();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "y.ts", content: "y1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3");
		expect(readFile(harness.tempDir, "y.ts")).toBe("y1");

		await harness.session.navigateTree(afterTurn1, { summarize: false });

		expect(readFile(harness.tempDir, "x.ts")).toBe("x1");
		expect(fileExists(harness.tempDir, "y.ts")).toBe(false);

		const userMsgs = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);
	});

	it("Case 17: rollback, continue, rollback to different point", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "f.ts", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "f.ts", content: "v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "f.ts", content: "v3" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3");

		await harness.session.navigateTree(afterTurn1, { summarize: false });
		expect(readFile(harness.tempDir, "f.ts")).toBe("v1");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "f.ts", content: "v4" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 4 after rollback");

		await harness.session.navigateTree(afterTurn2, { summarize: false });
		expect(readFile(harness.tempDir, "f.ts")).toBe("v2");

		const userMsgs = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(2);
	});

	it("Case 18: file created then deleted, rollback restores it", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "temp.ts", content: "temp-content" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create temp");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		deleteFile(harness.tempDir, "temp.ts");
		expect(fileExists(harness.tempDir, "temp.ts")).toBe(false);

		harness.setResponses([fauxAssistantMessage("noted")]);
		await harness.session.prompt("turn 2");

		await harness.session.navigateTree(afterTurn1, { summarize: false });
		expect(readFile(harness.tempDir, "temp.ts")).toBe("temp-content");
	});

	it("Case 19: navigateTree with skipFiles option does not crash", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "b.ts", content: "b1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3");

		const result = await harness.session.navigateTree(afterTurn1, { summarize: false, skipFiles: true });
		expect(result.cancelled).toBe(false);

		const userMsgs = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);
	});

	it("Case 20: empty rollback (no file changes) does not crash", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("just text, no tools")]);
		await harness.session.prompt("turn 1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		harness.setResponses([fauxAssistantMessage("more text")]);
		await harness.session.prompt("turn 2");

		await harness.session.navigateTree(afterTurn1, { summarize: false });

		const userMsgs = harness.session.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);
	});
});
