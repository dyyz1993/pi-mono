import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileReviewFactory from "../../extensions/file-review/index.js";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, relativePath: string): string {
	const absolute = join(tempDir, relativePath);
	return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

/**
 * Helper: create a standalone FileSnapshotManager for unit testing getLiveChanges.
 * Store dir is placed outside cwd so scanWorkingDir won't pick it up.
 */
function createManager(tempDir: string): FileSnapshotManager {
	const storeDir = join(tempDir, "..", `.pi-review-store-${Date.now()}`);
	const git = new InternalGit(storeDir);
	return new FileSnapshotManager(git);
}

describe("file-review: getLiveChanges (unit)", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		tempDirs.length = 0;
	});

	function makeTempDir(): string {
		const d = `/tmp/pi-review-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(d, { recursive: true });
		tempDirs.push(d);
		return d;
	}

	it("returns empty when cwd has no files and no baseline", async () => {
		const dir = makeTempDir();
		const mgr = createManager(dir);
		await mgr.initialize(dir);
		const changes = mgr.getLiveChanges(dir);
		expect(changes).toEqual([]);
	});

	it("detects new files as added", async () => {
		const dir = makeTempDir();
		const mgr = createManager(dir);
		await mgr.initialize(dir);

		// Create file after init
		writeFileSync(join(dir, "new.ts"), "hello", "utf-8");

		const changes = mgr.getLiveChanges(dir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("new.ts");
		expect(changes[0]!.status).toBe("added");
		expect(changes[0]!.diff?.newContent).toBe("hello");
		expect(changes[0]!.diff?.oldContent).toBeNull();
	});

	it("detects modified files", async () => {
		const dir = makeTempDir();
		// Pre-existing file
		writeFileSync(join(dir, "a.ts"), "v1", "utf-8");

		const mgr = createManager(dir);
		await mgr.initialize(dir);

		// Modify file
		writeFileSync(join(dir, "a.ts"), "v2", "utf-8");

		const changes = mgr.getLiveChanges(dir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("a.ts");
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff?.oldContent).toBe("v1");
		expect(changes[0]!.diff?.newContent).toBe("v2");
	});

	it("detects deleted files", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "gone.ts"), "bye", "utf-8");

		const mgr = createManager(dir);
		await mgr.initialize(dir);

		rmSync(join(dir, "gone.ts"), { force: true });

		const changes = mgr.getLiveChanges(dir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("gone.ts");
		expect(changes[0]!.status).toBe("deleted");
		expect(changes[0]!.diff?.oldContent).toBe("bye");
		expect(changes[0]!.diff?.newContent).toBeNull();
	});

	it("returns empty after onTurnEnd commits snapshot", async () => {
		const dir = makeTempDir();
		const mgr = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "x.ts"), "v1", "utf-8");

		// Before onTurnEnd: has changes
		expect(mgr.getLiveChanges(dir)).toHaveLength(1);

		// Commit turn
		mgr.onTurnEnd(dir, 0, () => "entry_0");

		// After onTurnEnd: no more live changes (baseline caught up)
		expect(mgr.getLiveChanges(dir)).toHaveLength(0);
	});

	it("accumulates changes across multiple turns", async () => {
		const dir = makeTempDir();
		const mgr = createManager(dir);
		await mgr.initialize(dir);

		// Turn 0: create a.ts
		writeFileSync(join(dir, "a.ts"), "1", "utf-8");
		mgr.onTurnEnd(dir, 0, () => "e0");

		// Turn 1: create b.ts
		writeFileSync(join(dir, "b.ts"), "2", "utf-8");
		const live1 = mgr.getLiveChanges(dir);
		expect(live1.map((c) => c.path)).toContain("b.ts");
		expect(live1.map((c) => c.path)).not.toContain("a.ts");
		mgr.onTurnEnd(dir, 1, () => "e1");

		// Turn 2: modify a.ts
		writeFileSync(join(dir, "a.ts"), "11", "utf-8");
		const live2 = mgr.getLiveChanges(dir);
		expect(live2.map((c) => c.path)).toContain("a.ts");
		expect(live2[0]!.status).toBe("modified");
	});

	it("includes unified diff", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "d.ts"), "line1\nline2\nline3", "utf-8");

		const mgr = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "d.ts"), "line1\nline2-mod\nline3\nline4", "utf-8");

		const changes = mgr.getLiveChanges(dir);
		expect(changes[0]!.diff?.unifiedDiff).toContain("line2-mod");
		expect(changes[0]!.diff?.unifiedDiff).toContain("line4");
	});
});

describe("file-review extension (integration)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("turn_end fires after file changes are committed", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "review.ts", content: "hello" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create review.ts");
		expect(readFile(harness.tempDir, "review.ts")).toBe("hello");

		// Verify snapshot was created (the extension's job)
		const snapshots = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "custom" && e.customType === "step-snapshot");
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
	});

	it("tracks multiple turns", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, fileReviewFactory],
		});
		harnesses.push(harness);

		// Turn 0
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create a");

		// Turn 1
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "b.ts", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create b");

		// Turn 2
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify a");

		// Verify all files exist
		expect(readFile(harness.tempDir, "a.ts")).toBe("v2");
		expect(readFile(harness.tempDir, "b.ts")).toBe("v1");

		// Verify multiple snapshots were recorded
		const snapshots = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "custom" && e.customType === "step-snapshot");
		expect(snapshots.length).toBeGreaterThanOrEqual(2);
	});
});
