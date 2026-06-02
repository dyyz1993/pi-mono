import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager, type StepSnapshotData } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

function customSnapshotEntry(
	id: string,
	parentId: string | null,
	timestamp: string,
	data: StepSnapshotData,
): SessionEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp,
		customType: "step-snapshot",
		data,
	};
}

describe("FileSnapshotManager", () => {
	let testDir: string;
	let storeDir: string;

	beforeEach(() => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		testDir = join(tmpdir(), `pi-file-snapshot-test-${suffix}`);
		storeDir = join(tmpdir(), `pi-file-snapshot-store-${suffix}`);
		mkdirSync(testDir, { recursive: true });
		mkdirSync(storeDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("preserves an empty session-start baseline when rebuilding from snapshots", async () => {
		const git = new InternalGit(storeDir);
		const firstTree = git.writeTree(new Map([["notes.txt", "first\n"]]));
		const secondTree = git.writeTree(new Map([["notes.txt", "second\n"]]));
		const entries: SessionEntry[] = [
			customSnapshotEntry("snap-1", "assistant-1", "2026-01-01T00:00:00.000Z", {
				baselineTreeHash: null,
				snapshotTreeHash: firstTree.treeHash,
				diff: { added: ["notes.txt"], modified: [], deleted: [] },
				turnIndex: 0,
			}),
			customSnapshotEntry("snap-2", "assistant-2", "2026-01-01T00:01:00.000Z", {
				baselineTreeHash: firstTree.treeHash,
				snapshotTreeHash: secondTree.treeHash,
				diff: { added: [], modified: ["notes.txt"], deleted: [] },
				turnIndex: 1,
			}),
		];
		const manager = new FileSnapshotManager(git);
		manager.rebuildIndex(entries);
		writeFileSync(join(testDir, "notes.txt"), "second\n");

		const result = await manager.restoreFiles(testDir, {
			entries,
			preview: false,
		});

		expect(result.deleted).toEqual(["notes.txt"]);
		expect(result.restored).toEqual([]);
		expect(existsSync(join(testDir, "notes.txt"))).toBe(false);
	});
});
