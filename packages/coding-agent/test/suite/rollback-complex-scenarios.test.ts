/**
 * 复杂场景测试集：
 * 1. 内容 diff (oldContent/newContent)
 * 2. 分支(fork)后各自回滚
 * 3. 长链: +A → ~A → ~A → -A → +A
 * 4. 空 turn (无文件变更的 turn)
 * 5. Session 重启后 rebuildIndex 验证
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createHarness, type Harness } from "../suite/harness.js";

function writeFile(dir: string, path: string, content: string): void {
	const abs = join(dir, path);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

function readFile(dir: string, path: string): string {
	const abs = join(dir, path);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function fileExists(dir: string, path: string): boolean {
	return existsSync(join(dir, path));
}

function findSnapshotAfterUserEntry(
	entries: Array<{ id: string; type: string; customType?: string; data?: unknown }>,
	userEntryId: string,
): string | null {
	const idx = entries.findIndex((e) => e.id === userEntryId);
	if (idx === -1) return null;
	for (let i = idx; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === "step-snapshot") {
			return e.id;
		}
	}
	return null;
}

describe("Rollback complex scenarios", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// ──────────────────────────────────────────────
	// 场景 1: 内容 diff
	// ──────────────────────────────────────────────
	it("content diff: Turn A→v1, Turn B→v2 — getFileDiff oldContent/newContent correct", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: write fileA.txt v1
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "version-one" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done A"),
		]);
		await harness.session.prompt("create fileA v1");

		// Turn B: modify fileA.txt to v2
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "version-two" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done B"),
		]);
		await harness.session.prompt("modify fileA to v2");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");

		const snapA = findSnapshotAfterUserEntry(entries, userEntries[0].id)!;
		const snapB = findSnapshotAfterUserEntry(entries, userEntries[1].id)!;

		// getFileDiff with fromEntryId=snapA, toEntryId=snapB: diff from A→B
		const diff = mgr.getFileDiff({ filePath: "fileA.txt", fromEntryId: snapA, toEntryId: snapB });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("version-one");
		expect(diff!.newContent).toBe("version-two");
		expect(diff!.path).toBe("fileA.txt");
		expect(diff!.unifiedDiff).toContain("version-one");
		expect(diff!.unifiedDiff).toContain("version-two");

		// getFileDiff with only toEntryId: diff from session start to B
		const diffToB = mgr.getFileDiff({ filePath: "fileA.txt", toEntryId: snapB });
		expect(diffToB).not.toBeNull();
		expect(diffToB!.oldContent).toBeNull(); // file didn't exist at session start
		expect(diffToB!.newContent).toBe("version-two");

		// getFileDiff with only fromEntryId: diff from session start to A
		const diffToA = mgr.getFileDiff({ filePath: "fileA.txt", toEntryId: snapA });
		expect(diffToA).not.toBeNull();
		expect(diffToA!.oldContent).toBeNull();
		expect(diffToA!.newContent).toBe("version-one");
	});

	// ──────────────────────────────────────────────
	// 场景 2: 分支后各自回滚
	// ──────────────────────────────────────────────
	it("fork: Turn A→fileA, Turn B→fileB, fork at A for Turn C→fileC — rollback each branch independently", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done A"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: create fileB (main branch)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done B"),
		]);
		await harness.session.prompt("create fileB");

		// Get userEntryA for rolling back to A (creates a fork point)
		let entries = harness.sessionManager.getEntries();
		let userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		const userEntryA = userEntries[0];
		const userEntryB = userEntries[1];

		// Fork: navigateTree to userEntryA → creates branch from A
		await harness.session.navigateTree(userEntryB.id, { summarize: false });

		// Turn C: create fileC (on forked branch from A)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done C"),
		]);
		await harness.session.prompt("create fileC");

		entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");

		// After fork, there are 3 user entries (A, B, C) but B is on a separate branch
		// userEntries[2] is C (the new fork's turn)
		const lastUser = userEntries[userEntries.length - 1];
		expect(lastUser.id).toBeDefined();
		// Verify C is NOT the rolled-back B
		expect(lastUser.id).not.toBe(userEntryB.id);

		const snapC = findSnapshotAfterUserEntry(entries, lastUser.id)!;

		// Rollback C → only fileC should be affected
		const filesC = mgr.getModifiedFiles({ fromEntryId: snapC });
		expect(filesC.map((f: any) => f.path)).toEqual(["fileC.txt"]);

		// After rollback, fileA exists, fileC does not
		await harness.session.navigateTree(lastUser.id, { summarize: false });
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(fileExists(harness.tempDir, "fileC.txt")).toBe(false);
	});

	// ──────────────────────────────────────────────
	// 场景 3: 长链
	// ──────────────────────────────────────────────
	it("long chain: +A → ~A → ~A → -A → +A — each rollback correct", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn 1: create fileA (v1)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create fileA v1");

		// Turn 2: modify fileA (v2)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify to v2");

		// Turn 3: modify fileA (v3)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v3" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify to v3");

		// Turn 4: delete fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: `rm ${join(harness.tempDir, "fileA.txt")}` }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("deleted"),
		]);
		await harness.session.prompt("delete fileA");

		// Turn 5: create fileA (v4)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v4" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create fileA v4");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("v4");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		expect(userEntries.length).toBe(5);

		// Each rollback should show correct status
		const snap5 = findSnapshotAfterUserEntry(entries, userEntries[4].id)!;
		const files5 = mgr.getModifiedFiles({ fromEntryId: snap5 });
		expect(files5.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(files5[0].status).toBe("added"); // re-created at turn 5

		const snap4 = findSnapshotAfterUserEntry(entries, userEntries[3].id)!;
		const files4 = mgr.getModifiedFiles({ fromEntryId: snap4 });
		expect(files4.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(files4[0].status).toBe("deleted"); // deleted at turn 4

		const snap3 = findSnapshotAfterUserEntry(entries, userEntries[2].id)!;
		const files3 = mgr.getModifiedFiles({ fromEntryId: snap3 });
		expect(files3.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(files3[0].status).toBe("modified"); // modified at turn 3

		const snap2 = findSnapshotAfterUserEntry(entries, userEntries[1].id)!;
		const files2 = mgr.getModifiedFiles({ fromEntryId: snap2 });
		expect(files2.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(files2[0].status).toBe("modified"); // modified at turn 2

		const snap1 = findSnapshotAfterUserEntry(entries, userEntries[0].id)!;
		const files1 = mgr.getModifiedFiles({ fromEntryId: snap1 });
		expect(files1.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(files1[0].status).toBe("added"); // created at turn 1

		// Rollback turn 5 → fileA should be deleted (turn 4 deleted it)
		await harness.session.navigateTree(userEntries[4].id, { summarize: false });
		expect(fileExists(harness.tempDir, "fileA.txt")).toBe(false);

		// Rollback turn 4 → fileA restored to v3
		await harness.session.navigateTree(userEntries[3].id, { summarize: false });
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("v3");
	});

	// ──────────────────────────────────────────────
	// 场景 4: 空 turn
	// ──────────────────────────────────────────────
	it("empty turns: turn with no file changes does not create snapshot", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done A"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: no file changes (just text)
		harness.setResponses([fauxAssistantMessage("Just text, no files")]);
		await harness.session.prompt("tell me something");

		// Turn C: create fileC
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done C"),
		]);
		await harness.session.prompt("create fileC");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		expect(userEntries.length).toBe(3);

		// There should be only 2 step-snapshots (A and C), not 3 (B had no changes)
		const stepSnapshots = entries.filter((e) => e.type === "custom" && (e as any).customType === "step-snapshot");
		expect(stepSnapshots.length).toBe(2);

		const snapC = findSnapshotAfterUserEntry(entries, userEntries[2].id)!;
		const snapA = findSnapshotAfterUserEntry(entries, userEntries[0].id)!;

		// Rollback C → only fileC
		const filesC = mgr.getModifiedFiles({ fromEntryId: snapC });
		expect(filesC.map((f: any) => f.path)).toEqual(["fileC.txt"]);

		// Rollback A → fileA + fileC (skipping B which had no snapshots)
		const filesA = mgr.getModifiedFiles({ fromEntryId: snapA });
		expect(filesA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileC.txt"]);
	});

	// ──────────────────────────────────────────────
	// 场景 5: Session 重启后 rebuildIndex 验证
	// ──────────────────────────────────────────────
	it("session restart after rollback: rebuildIndex maintains correct snapshot state", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done A"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done B"),
		]);
		await harness.session.prompt("create fileB");

		// Rollback Turn B
		let entries = harness.sessionManager.getEntries();
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		await harness.session.navigateTree(userEntries[1].id, { summarize: false });

		// Turn C: create fileC (after rollback)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done C"),
		]);
		await harness.session.prompt("create fileC");

		// Simulate session restart: rebuildIndex from entries
		entries = harness.sessionManager.getEntries();
		const leafId = harness.sessionManager.getLeafId();
		const mgr = (harness.session as any).fileSnapshotManager;
		mgr.rebuildIndex(entries, leafId);

		// After restart, get all step-snapshots and verify
		const snapEntries = entries.filter((e) => e.type === "custom" && (e as any).customType === "step-snapshot");
		// 3 snapshots created (A, B, C) but B is excluded by isOnPathTo
		// The index should have exactly 2: snap-A and snap-C

		// Find the last snapshot in entries order (which is snap-C — the newest)
		const snapCId = snapEntries[snapEntries.length - 1].id;
		// Find snap-A
		const snapAId = snapEntries[0].id;

		// Rollback C → only fileC
		const filesC = mgr.getModifiedFiles({ fromEntryId: snapCId });
		expect(filesC.map((f: any) => f.path)).toEqual(["fileC.txt"]);

		// Rollback A → both A and C (but NOT B)
		const filesA = mgr.getModifiedFiles({ fromEntryId: snapAId });
		expect(filesA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileC.txt"]);
	});
});
