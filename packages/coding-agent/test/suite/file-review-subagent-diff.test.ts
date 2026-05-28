import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";

const tempDirs: string[] = [];
const storeDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	for (const dir of storeDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tempDirs.length = 0;
	storeDirs.length = 0;
});

function makeTempDir(): string {
	const d = `/tmp/pi-subagent-diff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

function createManager(tempDir: string, storeDir?: string): { mgr: FileSnapshotManager; git: InternalGit } {
	const sDir = storeDir ?? join(tempDir, "..", `.pi-subagent-store-${Date.now()}`);
	storeDirs.push(sDir);
	const git = new InternalGit(sDir);
	const mgr = new FileSnapshotManager(git);
	return { mgr, git };
}

describe("subagent scenario: external file creation → getFileDiff", () => {
	it("getLiveChanges detects externally created file", async () => {
		const dir = makeTempDir();
		const { mgr } = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "subagent-file.ts"), "// created by subagent", "utf-8");

		const changes = mgr.getLiveChanges(dir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("subagent-file.ts");
		expect(changes[0]!.status).toBe("added");
		expect(changes[0]!.diff?.newContent).toBe("// created by subagent");
		expect(changes[0]!.diff?.oldContent).toBeNull();
	});

	it("getFileDiff returns null BEFORE onTurnEnd commits snapshot", async () => {
		const dir = makeTempDir();
		const { mgr } = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "subagent-file.ts"), "// created by subagent", "utf-8");

		const diff = mgr.getFileDiff({ filePath: "subagent-file.ts" });
		expect(diff).toBeNull();
	});

	it("getFileDiff returns diff AFTER onTurnEnd commits snapshot", async () => {
		const dir = makeTempDir();
		const { mgr } = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "subagent-file.ts"), "// created by subagent", "utf-8");

		mgr.onTurnEnd(dir, 0, () => "entry_0");

		const diff = mgr.getFileDiff({ filePath: "subagent-file.ts" });
		expect(diff).not.toBeNull();
		expect(diff!.newContent).toBe("// created by subagent");
		expect(diff!.oldContent).toBeNull();
	});

	it("getFileDiff returns null when main session turn has NOT ended yet", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "pre.ts"), "pre", "utf-8");

		const { mgr } = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "new-from-sub.ts"), "sub-content", "utf-8");

		const live = mgr.getLiveChanges(dir);
		expect(live).toHaveLength(1);

		const diff = mgr.getFileDiff({ filePath: "new-from-sub.ts" });
		expect(diff).toBeNull();

		mgr.onTurnEnd(dir, 0, () => "e0");
		const diffAfter = mgr.getFileDiff({ filePath: "new-from-sub.ts" });
		expect(diffAfter).not.toBeNull();
		expect(diffAfter!.newContent).toBe("sub-content");
	});

	it("verifies fromHash and toHash are the same before first turn", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "pre.ts"), "pre", "utf-8");

		const { mgr } = createManager(dir);
		await mgr.initialize(dir);

		writeFileSync(join(dir, "new.ts"), "from-sub", "utf-8");

		const diff = mgr.getFileDiff({ filePath: "new.ts" });
		expect(diff).toBeNull();

		mgr.onTurnEnd(dir, 0, () => "e0");

		const diffAfter = mgr.getFileDiff({ filePath: "new.ts" });
		expect(diffAfter).not.toBeNull();
		expect(diffAfter!.oldContent).toBeNull();
		expect(diffAfter!.newContent).toBe("from-sub");
	});
});

describe("GC scenario: shared git store between two sessions", () => {
	it("subagent session shutdown GC can delete objects needed by main session", async () => {
		const sharedStore = `/tmp/pi-shared-store-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		storeDirs.push(sharedStore);
		const dir = makeTempDir();

		writeFileSync(join(dir, "pre.ts"), "pre-existing", "utf-8");

		// Main session starts
		const mainResult = createManager(dir, sharedStore);
		await mainResult.mgr.initialize(dir);

		// Subagent session starts (same cwd, same store)
		const subResult = createManager(dir, sharedStore);
		await subResult.mgr.initialize(dir);

		// Subagent creates files and commits snapshot
		writeFileSync(join(dir, "sub-a.ts"), "from-subagent", "utf-8");
		subResult.mgr.onTurnEnd(dir, 0, () => "sub_entry_0");

		// Subagent's getFileDiff works
		const subDiff = subResult.mgr.getFileDiff({ filePath: "sub-a.ts" });
		expect(subDiff).not.toBeNull();
		expect(subDiff!.newContent).toBe("from-subagent");

		// Subagent shuts down — GC runs with only subagent's active hashes
		const subActiveHashes = subResult.mgr.getActiveTreeHashes();
		await subResult.git.gc(subActiveHashes);

		// Now check: does main session's getFileDiff still work?
		// Main session hasn't committed any snapshot yet, so:
		// - sessionStartTreeHash = initial state (has "pre.ts" but NOT "sub-a.ts")
		// - lastCommittedTreeHash = null
		// getFileDiff: fromHash = sessionStartTreeHash, toHash = sessionStartTreeHash (same!)
		// sub-a.ts is in neither → returns null
		const mainDiffBefore = mainResult.mgr.getFileDiff({ filePath: "sub-a.ts" });
		console.log("[TRACE-GC] mainDiffBefore:", mainDiffBefore);

		// Now main session commits a turn
		mainResult.mgr.onTurnEnd(dir, 0, () => "main_entry_0");

		// Main session's getFileDiff — does it still work?
		const mainDiffAfter = mainResult.mgr.getFileDiff({ filePath: "sub-a.ts" });
		console.log("[TRACE-GC] mainDiffAfter:", mainDiffAfter);
		console.log("[TRACE-GC] main sessionStartTreeHash:", (mainResult.mgr as any).sessionStartTreeHash);
		console.log("[TRACE-GC] main lastCommittedTreeHash:", (mainResult.mgr as any).lastCommittedTreeHash);
		console.log("[TRACE-GC] sub sessionStartTreeHash:", (subResult.mgr as any).sessionStartTreeHash);
		console.log("[TRACE-GC] sub lastCommittedTreeHash:", (subResult.mgr as any).lastCommittedTreeHash);

		// Key question: did the subagent's GC delete the blob objects that the main session needs?
		const mainActiveHashes = mainResult.mgr.getActiveTreeHashes();
		console.log("[TRACE-GC] main active hashes:", [...mainActiveHashes]);
		console.log("[TRACE-GC] sub active hashes:", [...subActiveHashes]);
	});

	it("readTree silently skips files whose blob was GC'd", async () => {
		const sharedStore = `/tmp/pi-gc-skip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		storeDirs.push(sharedStore);
		const dir = makeTempDir();

		// Start with one file
		writeFileSync(join(dir, "keep.ts"), "keep-content", "utf-8");

		const { mgr, git } = createManager(dir, sharedStore);
		await mgr.initialize(dir);

		// Now add a second file (simulating subagent creation AFTER session init)
		writeFileSync(join(dir, "victim.ts"), "victim-content", "utf-8");

		// Commit turn — this creates a snapshot with both files
		mgr.onTurnEnd(dir, 0, () => "e0");

		// Verify both files are in the snapshot
		const diff1 = mgr.getFileDiff({ filePath: "victim.ts" });
		expect(diff1).not.toBeNull();
		expect(diff1!.newContent).toBe("victim-content");

		// Now simulate GC deleting victim's blob
		const victimHash = git.hashContent("victim-content");
		expect(git.hasObject(victimHash)).toBe(true);
		const prefix = victimHash.slice(0, 2);
		const suffix = victimHash.slice(2);
		const { rmSync: rmS } = await import("node:fs");
		rmS(join((git as any).objectsDir, prefix, suffix), { force: true });
		expect(git.hasObject(victimHash)).toBe(false);

		// readTree silently skips victim.ts because hasObject returns false
		const lastCommitted = (mgr as any).lastCommittedTreeHash as string;
		expect(lastCommitted).not.toBeNull();

		const treeFiles = git.readTree(lastCommitted);
		console.log("[TRACE-GC-SKIP] treeFiles keys:", [...(treeFiles?.keys() ?? [])]);
		expect(treeFiles).not.toBeNull();
		expect(treeFiles!.has("keep.ts")).toBe(true);
		expect(treeFiles!.has("victim.ts")).toBe(false); // silently skipped!

		// getFileDiff for victim.ts returns null because readTree skipped it
		const diff2 = mgr.getFileDiff({ filePath: "victim.ts" });
		console.log("[TRACE-GC-SKIP] diff2:", diff2);
		expect(diff2).toBeNull();

		// But keep.ts is fine — "some files work, some don't"
		const diff3 = mgr.getFileDiff({ filePath: "keep.ts" });
		expect(diff3).not.toBeNull();
		expect(diff3!.newContent).toBe("keep-content");
	});
});
