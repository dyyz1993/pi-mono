import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSnapshotHashesFromDir } from "../../extensions/file-snapshot/index.js";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";

const allDirs: string[] = [];

afterEach(() => {
	for (const dir of allDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	allDirs.length = 0;
});

function makeDir(): string {
	const d = `/tmp/pi-gc-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	allDirs.push(d);
	return d;
}

function createManager(_cwd: string, storeDir: string): { mgr: FileSnapshotManager; git: InternalGit } {
	const git = new InternalGit(storeDir);
	return { mgr: new FileSnapshotManager(git), git };
}

describe("GC cross-session: verify real-world scenarios", () => {
	it("subagent GC does NOT delete blobs when tree hashes overlap", async () => {
		const store = makeDir();
		const cwd = makeDir();

		writeFileSync(join(cwd, "pre.txt"), "pre", "utf-8");

		// Main session starts
		const main = createManager(cwd, store);
		await main.mgr.initialize(cwd);

		// Subagent creates file
		writeFileSync(join(cwd, "new.txt"), "from-sub", "utf-8");

		// Subagent session — same cwd, same store
		const sub = createManager(cwd, store);
		await sub.mgr.initialize(cwd);
		sub.mgr.onTurnEnd(cwd, 0, () => "sub_e0");

		// Main session also commits
		main.mgr.onTurnEnd(cwd, 0, () => "main_e0");

		// Both should have same lastCommittedTreeHash (same disk state)
		const mainLast = (main.mgr as any).lastCommittedTreeHash;
		const subLast = (sub.mgr as any).lastCommittedTreeHash;
		console.log("[TRACE] mainLast:", mainLast, "subLast:", subLast, "same:", mainLast === subLast);

		// Subagent GC with its own active hashes
		const subActive = sub.mgr.getActiveTreeHashes();
		const gcResult = await sub.git.gc(subActive);
		console.log("[TRACE] GC deleted:", gcResult.deletedObjects, "objects");

		// Main session's getFileDiff should still work
		const diff = main.mgr.getFileDiff({ filePath: "new.txt" });
		console.log("[TRACE] diff after sub GC:", diff?.newContent);
		expect(diff).not.toBeNull();
		expect(diff!.newContent).toBe("from-sub");
	});

	it("subagent GC CAN delete blobs when sessions have DIFFERENT disk states", async () => {
		const store = makeDir();
		const cwd = makeDir();

		writeFileSync(join(cwd, "shared.txt"), "shared", "utf-8");

		// Main session starts, commits turn with shared.txt
		const main = createManager(cwd, store);
		await main.mgr.initialize(cwd);
		main.mgr.onTurnEnd(cwd, 0, () => "main_e0");

		// Subagent creates a NEW file (main session hasn't seen it yet)
		writeFileSync(join(cwd, "sub-only.txt"), "sub-only-content", "utf-8");

		// Subagent session starts and commits
		const sub = createManager(cwd, store);
		await sub.mgr.initialize(cwd);
		sub.mgr.onTurnEnd(cwd, 0, () => "sub_e0");

		// Subagent GC: sub's active hashes include sub's tree (which has sub-only.txt)
		const subActive = sub.mgr.getActiveTreeHashes();
		await sub.git.gc(subActive);

		// sub-only.txt blob should survive because sub's tree references it
		const subHash = sub.git.hashContent("sub-only-content");
		expect(sub.git.hasObject(subHash)).toBe(true);

		// Now main session also commits (disk now has both files)
		main.mgr.onTurnEnd(cwd, 1, () => "main_e1");

		// Main session GC: main's active hashes include main's tree
		const mainActive = main.mgr.getActiveTreeHashes();
		await main.git.gc(mainActive);

		// Both files' blobs should survive
		expect(main.git.hasObject(subHash)).toBe(true);
		expect(main.git.hasObject(main.git.hashContent("shared"))).toBe(true);
	});

	it("enforceLimit deletes blobs when store exceeds limit", async () => {
		const store = makeDir();
		const cwd = makeDir();

		writeFileSync(join(cwd, "keep.txt"), "keep-content", "utf-8");
		const { mgr, git } = createManager(cwd, store);
		await mgr.initialize(cwd);

		// Create a big file to fill the store
		const bigContent = "x".repeat(100_000);
		writeFileSync(join(cwd, "big.txt"), bigContent, "utf-8");
		mgr.onTurnEnd(cwd, 0, () => "e0");

		// Verify big file has diff
		const diff1 = mgr.getFileDiff({ filePath: "big.txt" });
		expect(diff1).not.toBeNull();
		expect(diff1!.newContent).toBe(bigContent);

		// Now delete the big file and commit a new turn
		rmSync(join(cwd, "big.txt"), { force: true });
		writeFileSync(join(cwd, "other.txt"), "other", "utf-8");
		mgr.onTurnEnd(cwd, 1, () => "e1");

		// enforceLimit with very small limit (1KB) — should trigger aggressive GC
		const activeHashes = mgr.getActiveTreeHashes();
		const limitResult = await git.enforceLimit(1024, activeHashes);
		console.log("[TRACE] enforceLimit deleted:", limitResult.deletedObjects, "freed:", limitResult.freedBytes);

		// Current files should still have diff
		const diffKeep = mgr.getFileDiff({ filePath: "keep.txt" });
		expect(diffKeep).not.toBeNull();

		// big.txt might lose its blob if GC deleted it
		const bigHash = git.hashContent(bigContent);
		const bigBlobExists = git.hasObject(bigHash);
		console.log("[TRACE] big blob exists after enforceLimit:", bigBlobExists);

		// If big blob was deleted, getFileDiff for big.txt returns null
		if (!bigBlobExists) {
			const diffBig = mgr.getFileDiff({ filePath: "big.txt" });
			console.log("[TRACE] big.txt diff after enforceLimit:", diffBig);
			// This is the bug: file shows in history but diff is blank
		}
	});

	it("collectSnapshotHashesFromDir protects cross-session blobs", async () => {
		const sessionDir = makeDir();

		// Simulate: main session wrote a step-snapshot entry to its JSONL
		const mainSessionFile = join(sessionDir, "2026-01-01_main.jsonl");
		const treeHash = "abc12345";
		const baselineHash = "def67890";
		writeFileSync(
			mainSessionFile,
			`${JSON.stringify({
				customType: "step-snapshot",
				data: { snapshotTreeHash: treeHash, baselineTreeHash: baselineHash },
			})}\n`,
			"utf-8",
		);

		// Simulate: subagent session wrote its own entry
		const subSessionFile = join(sessionDir, "2026-01-01_sub.jsonl");
		const subTreeHash = "sub11111";
		writeFileSync(
			subSessionFile,
			`${JSON.stringify({
				customType: "step-snapshot",
				data: { snapshotTreeHash: subTreeHash, baselineTreeHash: treeHash },
			})}\n`,
			"utf-8",
		);

		// collectSnapshotHashesFromDir should find ALL hashes
		const hashes = collectSnapshotHashesFromDir(sessionDir);
		expect(hashes.has(treeHash)).toBe(true);
		expect(hashes.has(baselineHash)).toBe(true);
		expect(hashes.has(subTreeHash)).toBe(true);
		console.log("[TRACE] collected hashes:", [...hashes]);
	});

	it("FULL E2E: subagent shutdown GC preserves main session blobs", async () => {
		const store = makeDir();
		const cwd = makeDir();
		const sessionDir = makeDir();

		// Main session initializes with empty dir
		const main = createManager(cwd, store);
		await main.mgr.initialize(cwd);

		// Main session creates a file AFTER init, BEFORE onTurnEnd
		writeFileSync(join(cwd, "main-file.txt"), "main-content", "utf-8");
		main.mgr.onTurnEnd(cwd, 0, (type, data) => {
			// Simulate persisting to JSONL
			writeFileSync(join(sessionDir, "main.jsonl"), `${JSON.stringify({ customType: type, data })}\n`, {
				flag: "a",
			});
			return "main_e0";
		});

		// Subagent creates different files (also after init)
		const sub = createManager(cwd, store);
		await sub.mgr.initialize(cwd);
		writeFileSync(join(cwd, "sub-file.txt"), "sub-content", "utf-8");
		sub.mgr.onTurnEnd(cwd, 0, (type, data) => {
			writeFileSync(join(sessionDir, "sub.jsonl"), `${JSON.stringify({ customType: type, data })}\n`, { flag: "a" });
			return "sub_e0";
		});

		// Verify both have diffs
		expect(main.mgr.getFileDiff({ filePath: "main-file.txt" })!.newContent).toBe("main-content");
		expect(sub.mgr.getFileDiff({ filePath: "sub-file.txt" })!.newContent).toBe("sub-content");

		// Subagent shutdown GC — WITH collectSnapshotHashesFromDir protection
		const subActiveHashes = sub.mgr.getActiveTreeHashes();
		collectSnapshotHashesFromDir(sessionDir, subActiveHashes);
		console.log("[TRACE-E2E] sub active + session hashes:", [...subActiveHashes]);

		const gcResult = await sub.git.gc(subActiveHashes);
		console.log("[TRACE-E2E] sub GC deleted:", gcResult.deletedObjects);

		// Main session's diff should STILL work
		const mainDiff = main.mgr.getFileDiff({ filePath: "main-file.txt" });
		expect(mainDiff).not.toBeNull();
		expect(mainDiff!.newContent).toBe("main-content");

		// Sub file's diff should also survive
		const subDiff = main.mgr.getFileDiff({ filePath: "sub-file.txt" });
		console.log("[TRACE-E2E] sub-file diff after sub GC:", subDiff?.newContent ?? "NULL");
	});

	it("FULL E2E: subagent GC WITHOUT collectSnapshotHashesFromDir protection", async () => {
		const store = makeDir();
		const cwd = makeTempDir();

		writeFileSync(join(cwd, "main-file.txt"), "main-content", "utf-8");
		const main = createManager(cwd, store);
		await main.mgr.initialize(cwd);
		main.mgr.onTurnEnd(cwd, 0, () => "main_e0");

		writeFileSync(join(cwd, "sub-file.txt"), "sub-content", "utf-8");
		const sub = createManager(cwd, store);
		await sub.mgr.initialize(cwd);
		sub.mgr.onTurnEnd(cwd, 0, () => "sub_e0");

		// Subagent GC WITHOUT scanning session dir — only sub's own hashes
		const subActiveHashes = sub.mgr.getActiveTreeHashes();
		console.log("[TRACE-NO-DIR] sub active hashes:", [...subActiveHashes]);
		console.log("[TRACE-NO-DIR] main active hashes:", [...main.mgr.getActiveTreeHashes()]);

		// Check overlap
		const mainActive = main.mgr.getActiveTreeHashes();
		const overlap = [...subActiveHashes].filter((h) => mainActive.has(h));
		console.log("[TRACE-NO-DIR] overlapping hashes:", overlap);

		const gcResult = await sub.git.gc(subActiveHashes);
		console.log("[TRACE-NO-DIR] GC deleted:", gcResult.deletedObjects);

		// Main's diff might break if blobs were deleted
		const mainDiff = main.mgr.getFileDiff({ filePath: "main-file.txt" });
		console.log("[TRACE-NO-DIR] main-file diff:", mainDiff?.newContent ?? "NULL");

		const subDiff = main.mgr.getFileDiff({ filePath: "sub-file.txt" });
		console.log("[TRACE-NO-DIR] sub-file diff:", subDiff?.newContent ?? "NULL");
	});
});

function makeTempDir(): string {
	const d = `/tmp/pi-gc-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	allDirs.push(d);
	return d;
}
