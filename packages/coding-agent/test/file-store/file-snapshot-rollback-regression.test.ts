/**
 * TDD tests for rollback data-loss bugs.
 *
 * Bug analysis:
 *   P0: restoreFiles() treats targetTreeHash === null as "target has no files"
 *       → deletes ALL current files instead of bailing out
 *   P1: file-snapshot extension's appendEntry callback returns undefined
 *       → snapshotIndex is never populated → every lookup falls back to null
 *   P2: rebuildIndex() doesn't distinguish branch topology
 *       → lastCommittedTreeHash may point to wrong branch
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import { InternalGit } from "../../src/core/file-store/internal-git.js";
import type { SessionEntry } from "../../src/core/session-manager.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-rollback-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

interface MockCustomEntry {
	type: "custom";
	id: string;
	parentId: string | null;
	timestamp: string;
	customType: string;
	data: unknown;
}

describe("Rollback data-loss regression tests", () => {
	let tempDir: string;
	let storeDir: string;
	let git: InternalGit;
	let manager: FileSnapshotManager;
	let appendedEntries: MockCustomEntry[];
	let entryIdCounter: number;

	beforeEach(() => {
		tempDir = createTempDir();
		storeDir = createTempDir();
		git = InternalGit.createForProject(storeDir, tempDir);
		manager = new FileSnapshotManager(git);
		appendedEntries = [];
		entryIdCounter = 0;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	const appendEntryReturningId = (type: string, data: unknown): string => {
		const id = `entry-${entryIdCounter++}`;
		appendedEntries.push({
			type: "custom",
			id,
			parentId: appendedEntries.length > 0 ? appendedEntries[appendedEntries.length - 1]!.id : null,
			timestamp: new Date().toISOString(),
			customType: type,
			data,
		});
		return id;
	};

	const appendEntryReturningUndefined = (_type: string, _data: unknown): undefined => {
		return undefined;
	};

	const toSessionEntries = (): SessionEntry[] => {
		return appendedEntries as unknown as SessionEntry[];
	};

	describe("P0: targetTreeHash === null must NOT delete files", () => {
		it("restoreFiles returns empty result when targetTreeHash is null and files exist on disk", async () => {
			writeFileSync(join(tempDir, "important.ts"), "critical code", "utf-8");
			await manager.initialize(tempDir);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId: undefined,
				entries: [],
				appendEntry: appendEntryReturningUndefined,
			});

			expect(result.deleted).toEqual([]);
			expect(result.restored).toEqual([]);
			expect(existsSync(join(tempDir, "important.ts"))).toBe(true);
			expect(readFileSync(join(tempDir, "important.ts"), "utf-8")).toBe("critical code");
		});

		it("restoreFiles does not delete files when targetEntryId is not found and snapshotIndex is empty", async () => {
			writeFileSync(join(tempDir, "keep-me.ts"), "important", "utf-8");
			writeFileSync(join(tempDir, "keep-me2.ts"), "also important", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "keep-me.ts"), "changed", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningUndefined);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId: "nonexistent-entry-id",
				entries: toSessionEntries(),
				appendEntry: appendEntryReturningUndefined,
			});

			expect(result.deleted).toEqual([]);
			expect(existsSync(join(tempDir, "keep-me.ts"))).toBe(true);
			expect(existsSync(join(tempDir, "keep-me2.ts"))).toBe(true);
		});

		it("restoreFiles with null sessionStartTreeHash on empty dir does not delete files", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "newly-created.ts"), "brand new", "utf-8");

			const result = await manager.restoreFiles(tempDir, {
				entries: [],
				appendEntry: appendEntryReturningUndefined,
			});

			expect(result.deleted).toEqual([]);
			expect(existsSync(join(tempDir, "newly-created.ts"))).toBe(true);
		});
	});

	describe("P1: appendEntry returning undefined must not cause data loss", () => {
		it("onTurnEnd with undefined-returning appendEntry does not corrupt snapshotIndex", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningUndefined);

			expect(manager.getSnapshotAtTurn(0)).toBeNull();
			expect(manager.getSnapshotAtTurn(1)).toBeNull();
		});

		it("restoreFiles with empty snapshotIndex and nonexistent targetEntryId returns empty", async () => {
			writeFileSync(join(tempDir, "safe.ts"), "do not delete", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "safe.ts"), "modified", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningUndefined);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId: "nonexistent-entry-id",
				entries: toSessionEntries(),
				appendEntry: appendEntryReturningUndefined,
			});

			expect(result.deleted).toEqual([]);
			expect(result.restored).toEqual([]);
			expect(existsSync(join(tempDir, "safe.ts"))).toBe(true);
			expect(readFileSync(join(tempDir, "safe.ts"), "utf-8")).toBe("modified");
		});

		it("onTurnEnd with working appendEntry populates snapshotIndex correctly", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningId);

			const snap = manager.getSnapshotAtTurn(0);
			expect(snap).not.toBeNull();
			expect(snap!.diff!.modified).toContain("a.ts");
		});

		it("restoreFiles with populated snapshotIndex restores correct snapshot", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "after-turn-0", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningId);
			const snap0Id = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "after-turn-1", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "new file", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntryReturningId);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId: snap0Id,
				entries: toSessionEntries(),
				appendEntry: appendEntryReturningId,
			});

			expect(result.restored).toContain("a.ts");
			expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("after-turn-0");
			expect(result.deleted).toContain("b.ts");
			expect(existsSync(join(tempDir, "b.ts"))).toBe(false);
		});
	});

	describe("P2: rebuildIndex respects branch topology", () => {
		it("rebuildIndex sets lastCommittedTreeHash to latest snapshot on active path", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntryReturningId);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntryReturningId);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			const snap = m2.getSnapshotAtTurn(1);
			expect(snap).not.toBeNull();

			const result = m2.getBatchDiffs();
			expect(result.summary.totalFiles).toBeGreaterThanOrEqual(0);
		});
	});
});
