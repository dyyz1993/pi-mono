import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, afterEach as afterEachHarness, describe, describe as describeHarness, expect, it } from "vitest";
import fileReviewFactory from "../../extensions/file-review/index.js";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { createHarness, type Harness } from "./harness.js";

const allDirs: string[] = [];

afterEach(() => {
	for (const d of allDirs) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {}
	}
	allDirs.length = 0;
});

function makeDir(): string {
	const d = `/tmp/pi-single-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	allDirs.push(d);
	return d;
}

function createManager(_cwd: string, storeDir?: string): { mgr: FileSnapshotManager; git: InternalGit } {
	const sDir = storeDir ?? makeDir();
	allDirs.push(sDir);
	const git = new InternalGit(sDir);
	return { mgr: new FileSnapshotManager(git), git };
}

describe("single session: getFileDiff WITHOUT any GC", () => {
	it("getFileDiff works for all files after multiple turns", async () => {
		const cwd = makeDir();
		writeFileSync(join(cwd, "pre.txt"), "pre-existing", "utf-8");

		const { mgr } = createManager(cwd);
		await mgr.initialize(cwd);

		// Turn 0: create a.ts
		writeFileSync(join(cwd, "a.ts"), "a-v1", "utf-8");
		mgr.onTurnEnd(cwd, 0, () => "e0");

		// Turn 1: create b.ts
		writeFileSync(join(cwd, "b.ts"), "b-v1", "utf-8");
		mgr.onTurnEnd(cwd, 1, () => "e1");

		// Turn 2: modify a.ts
		writeFileSync(join(cwd, "a.ts"), "a-v2", "utf-8");
		mgr.onTurnEnd(cwd, 2, () => "e2");

		// All diffs should be available
		const diffPre = mgr.getFileDiff({ filePath: "pre.txt" });
		expect(diffPre).not.toBeNull(); // pre-existing, unchanged
		expect(diffPre!.newContent).toBe("pre-existing");

		const diffA = mgr.getFileDiff({ filePath: "a.ts" });
		expect(diffA).not.toBeNull();
		expect(diffA!.oldContent).toBeNull();
		expect(diffA!.newContent).toBe("a-v2");

		const diffB = mgr.getFileDiff({ filePath: "b.ts" });
		expect(diffB).not.toBeNull();
		expect(diffB!.oldContent).toBeNull();
		expect(diffB!.newContent).toBe("b-v1");
	});

	it("getFileDiff shows deletion diff for file created and then deleted (net-zero)", async () => {
		const cwd = makeDir();
		const { mgr } = createManager(cwd);
		await mgr.initialize(cwd);

		// Turn 0: create temp.txt
		writeFileSync(join(cwd, "temp.txt"), "temp-content", "utf-8");
		mgr.onTurnEnd(cwd, 0, () => "e0");

		// Turn 1: delete temp.txt
		rmSync(join(cwd, "temp.txt"), { force: true });
		mgr.onTurnEnd(cwd, 1, () => "e1");

		// getFileDiff: backward search finds the file in turn 0 snapshot
		// Shows deletion diff: oldContent = what it was, newContent = null (deleted)
		const diff = mgr.getFileDiff({ filePath: "temp.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("temp-content"); // found via backward search
		expect(diff!.newContent).toBeNull(); // file no longer exists
	});

	it("getFileDiff for file created then modified — shows latest vs session start", async () => {
		const cwd = makeDir();
		const { mgr } = createManager(cwd);
		await mgr.initialize(cwd);

		// Turn 0: create file
		writeFileSync(join(cwd, "f.ts"), "v1", "utf-8");
		mgr.onTurnEnd(cwd, 0, () => "e0");

		// Turn 1: modify
		writeFileSync(join(cwd, "f.ts"), "v2", "utf-8");
		mgr.onTurnEnd(cwd, 1, () => "e1");

		// Turn 2: modify again
		writeFileSync(join(cwd, "f.ts"), "v3", "utf-8");
		mgr.onTurnEnd(cwd, 2, () => "e2");

		const diff = mgr.getFileDiff({ filePath: "f.ts" });
		expect(diff).not.toBeNull();
		// fromHash = sessionStart (empty), toHash = lastCommitted (v3)
		expect(diff!.oldContent).toBeNull();
		expect(diff!.newContent).toBe("v3");
	});

	it("getFileDiff after rollback via rebuildIndex", async () => {
		const cwd = makeDir();
		writeFileSync(join(cwd, "base.txt"), "base", "utf-8");

		const { mgr } = createManager(cwd);
		await mgr.initialize(cwd);

		// Turn 0
		writeFileSync(join(cwd, "a.txt"), "a", "utf-8");
		mgr.onTurnEnd(cwd, 0, () => "e0");

		// Turn 1
		writeFileSync(join(cwd, "b.txt"), "b", "utf-8");
		mgr.onTurnEnd(cwd, 1, () => "e1");

		// Collect persisted entries
		const entries: any[] = [];
		const sm = {
			getEntries: () => entries,
		};
		// Simulate entries with step-snapshot data
		for (const e of (mgr as any).snapshotIndex.values()) {
			entries.push({
				type: "custom",
				customType: "step-snapshot",
				id: e.entryId,
				parentId: null,
				data: {
					baselineTreeHash: e.baselineTreeHash,
					snapshotTreeHash: e.snapshotTreeHash,
					diff: e.diff,
					turnIndex: e.turnIndex,
				},
			});
		}

		// Simulate rollback to turn 0 by rebuilding with leaf = e0
		mgr.rebuildIndex(entries, "e0");

		// After rollback, getFileDiff should still work for a.txt
		const diffA = mgr.getFileDiff({ filePath: "a.txt" });
		console.log("[TRACE-ROLLBACK] a.txt diff:", diffA?.newContent ?? "NULL");
		expect(diffA).not.toBeNull();
		expect(diffA!.newContent).toBe("a");

		// b.txt is NOT on the path to leaf e0, so getModifiedFiles should exclude it
		const modified = mgr.getModifiedFiles();
		console.log(
			"[TRACE-ROLLBACK] modified files:",
			modified.map((f) => f.path),
		);
	});
});

describe("single session: getFileDiff vs getLiveChanges consistency", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("harness: all files written in a turn have diff in getFileDiff", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "src/a.ts", content: "// a" }),
					fauxToolCall("write", { path: "src/b.ts", content: "// b" }),
					fauxToolCall("write", { path: "src/c.ts", content: "// c" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create a b c");

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// All 3 files should have diff
		for (const file of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
			const diff = mgr!.getFileDiff({ filePath: file });
			console.log(`[TRACE-HARNESS] ${file}:`, diff?.newContent ?? "NULL");
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBeNull();
			expect(diff!.newContent).toContain("//");
		}
	});

	it("harness: create file, then modify in next turn — diff shows latest", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		// Turn 0: create
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "app.ts", content: "v1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create app");

		// Verify file content after turn 0
		const { readFileSync: rf } = await import("node:fs");
		const afterTurn0 = rf(join(harness.tempDir, "app.ts"), "utf-8");
		console.log("[TRACE-MODIFY] after turn0:", afterTurn0);

		// Turn 1: modify via write (not edit — simpler, guaranteed to overwrite)
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "app.ts", content: "v2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify app");

		const afterTurn1 = rf(join(harness.tempDir, "app.ts"), "utf-8");
		console.log("[TRACE-MODIFY] after turn1:", afterTurn1);

		const mgr = harness.session.fileSnapshotManager;
		const diff = mgr!.getFileDiff({ filePath: "app.ts" });
		console.log("[TRACE-MODIFY] diff:", diff);
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBeNull(); // didn't exist at session start
		expect(diff!.newContent).toBe("v2");
	});

	it("harness: create then delete in next turn — net-zero diff", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "temp.ts", content: "temp" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create temp");

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("bash", {
					command: "rm temp.ts",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("delete temp");

		const mgr = harness.session.fileSnapshotManager;
		const diff = mgr!.getFileDiff({ filePath: "temp.ts" });
		// Created then deleted: backward search finds file in intermediate snapshot
		// Shows deletion diff: oldContent = what it was, newContent = null
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("temp");
		expect(diff!.newContent).toBeNull();
	});
});
