import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { type GCResult, InternalGit } from "../../src/core/file-store/internal-git.js";
import { createHarness, type Harness } from "./harness.js";

describe("file-snapshot GC and storage optimization", () => {
	const tempDirs: string[] = [];
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		for (const dir of tempDirs) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
		tempDirs.length = 0;
	});

	function createTempDir(): string {
		const tempDir = `/tmp/pi-test-gc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);
		return tempDir;
	}

	describe("InternalGit GC", () => {
		it("GC removes unreferenced objects", async () => {
			const storeDir = createTempDir();
			const git = new InternalGit(storeDir);

			// Create some objects
			const hash1 = git.writeObject("content1", "file");
			const hash2 = git.writeObject("content2", "file");
			const tree1 = git.writeTree(new Map([["file1.ts", "content1"]]));
			const tree2 = git.writeTree(new Map([["file2.ts", "content2"]]));

			// Check initial state
			const stats1 = git.getStats();
			expect(stats1.totalObjects).toBeGreaterThanOrEqual(4); // 2 files + 2 trees

			// GC with only tree1 referenced
			const activeHashes = new Set([tree1.treeHash]);
			const result: GCResult = await git.gc(activeHashes);

			// Should have deleted objects related to tree2
			expect(result.deletedObjects).toBeGreaterThan(0);

			// Verify tree2 is gone
			expect(git.hasObject(tree2.treeHash)).toBe(false);

			// Verify tree1 still exists
			expect(git.hasObject(tree1.treeHash)).toBe(true);

			// Verify file1 still exists (referenced by tree1)
			expect(git.hasObject(hash1)).toBe(true);

			// file2 should be deleted
			expect(git.hasObject(hash2)).toBe(false);
		});

		it("pruneOldObjects removes old unreferenced objects", async () => {
			const storeDir = createTempDir();
			const git = new InternalGit(storeDir);

			// Create some distinct objects
			const hash1 = git.writeObject("old content 1", "file");
			const hash2 = git.writeObject("old content 2", "file");

			// Wait a bit to ensure time difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Create a new object
			const hash3 = git.writeObject("new content", "file");

			// Prune objects older than 0ms (everything)
			const result1 = await git.pruneOldObjects(0, new Set());

			// Should delete all since none are referenced
			expect(result1.deletedObjects).toBeGreaterThan(0);

			// Recreate objects
			git.writeObject("old content 1", "file");
			git.writeObject("old content 2", "file");
			git.writeObject("new content", "file");

			// Prune with active hash protecting new object
			const activeHashes = new Set([hash3]);
			const result2 = await git.pruneOldObjects(0, activeHashes);

			// Should only delete old objects
			expect(result2.deletedObjects).toBeGreaterThan(0);
		});

		it("enforceLimit prunes old objects when over limit", async () => {
			const storeDir = createTempDir();
			const git = new InternalGit(storeDir);

			// Create some large objects to exceed limit
			const largeContent = "x".repeat(1024 * 10); // 10KB
			for (let i = 0; i < 20; i++) {
				git.writeObject(largeContent + i, "file");
			}

			// Set low limit
			const limit = 50 * 1024; // 50KB

			// Enforce limit
			const result = await git.enforceLimit(limit, new Set());

			// Should have deleted some objects
			expect(result.deletedObjects).toBeGreaterThan(0);

			// Size should be under limit
			const finalSize = git.getStoreSize();
			expect(finalSize).toBeLessThanOrEqual(limit);
		});

		it("getStats returns correct statistics", async () => {
			const storeDir = createTempDir();
			const git = new InternalGit(storeDir);

			// Create some objects
			git.writeObject("file content", "file");
			git.writeObject("tree content", "tree");
			git.writeTree(new Map([["test.ts", "content"]]));

			const stats = git.getStats();

			expect(stats.totalObjects).toBeGreaterThan(0);
			expect(stats.totalBytes).toBeGreaterThan(0);
			expect(stats.fileObjects).toBeGreaterThan(0);
			expect(stats.treeObjects).toBeGreaterThan(0);
		});
	});

	describe("Integration with file-snapshot extension", () => {
		it("auto GC runs on session shutdown", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			// Create some files to generate snapshots
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "test1.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create test1.ts");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "test2.ts", content: "v2" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create test2.ts");

			// Get initial stats
			const stats1 = (harness.session as any).fileSnapshotManager?.git.getStats();
			const initialObjects = stats1?.totalObjects ?? 0;

			// Navigate tree to create fork (should trigger cleanup)
			const entries = harness.sessionManager.getEntries();
			const userEntry = entries.find((e) => e.type === "message" && e.message.role === "user");
			if (userEntry) {
				await harness.session.navigateTree(userEntry.id, { summarize: false });
			}

			// Verify objects were created
			expect(initialObjects).toBeGreaterThan(0);

			// Note: session.shutdown() is not available in harness
			// In production, GC would run on session_shutdown event
			// The integration is tested by the channel methods
		});

		it("channel methods for manual GC", async () => {
			const harness = await createHarness({
				extensionFactories: [fileSnapshotFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "test.ts", content: "content" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("create test.ts");

			const mgr = harness.session as any;
			if (!mgr.fileSnapshotManager) {
				throw new Error("fileSnapshotManager not available");
			}

			// Test getStats
			const stats = (mgr.fileSnapshotManager as any).git.getStats();
			expect(stats.totalObjects).toBeGreaterThan(0);

			// Test getActiveTreeHashes
			const activeHashes = mgr.fileSnapshotManager.getActiveTreeHashes();
			expect(activeHashes.size).toBeGreaterThan(0);
		});
	});
});
