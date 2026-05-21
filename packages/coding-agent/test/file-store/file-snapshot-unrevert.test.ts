import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-unrevert-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function readFile(path: string): string {
	return readFileSync(path, "utf-8");
}

describe("Unrevert (undo-rollback) forward path", () => {
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

	const appendEntry = (type: string, data: unknown): string => {
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

	const toSessionEntries = (): SessionEntry[] => {
		return appendedEntries as unknown as SessionEntry[];
	};

	const findUnrevertPoints = (): MockCustomEntry[] => {
		return appendedEntries.filter((e) => e.customType === "unrevert-point");
	};

	it("restoreFiles creates unrevert-point with correct preRollbackTreeHash", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		await manager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("v1");

		const unrevertPoints = findUnrevertPoints();
		expect(unrevertPoints.length).toBe(1);

		const data = unrevertPoints[0]!.data as {
			preRollbackTreeHash: string | null;
			rolledBackToLeaf: string;
		};
		expect(data.preRollbackTreeHash).not.toBeNull();
		expect(data.rolledBackToLeaf).toBe("");
	});

	it("unrevert forward path restores files to pre-rollback state", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "b1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		writeFileSync(join(tempDir, "c.ts"), "c1", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		await manager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("v1");
		expect(existsSync(join(tempDir, "c.ts"))).toBe(false);

		const unrevertPoints = findUnrevertPoints();
		expect(unrevertPoints.length).toBe(1);
		const unrevertData = unrevertPoints[0]!.data as {
			preRollbackTreeHash: string | null;
		};
		expect(unrevertData.preRollbackTreeHash).not.toBeNull();

		await manager.restoreFiles(tempDir, {
			snapshotHash: unrevertData.preRollbackTreeHash!,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("v2");
		expect(readFile(join(tempDir, "c.ts"))).toBe("c1");
		expect(readFile(join(tempDir, "b.ts"))).toBe("b1");
	});

	it("unrevert after rollback to non-root entry", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);
		const turn0EntryId = appendedEntries[0]!.id;

		writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		await manager.restoreFiles(tempDir, {
			targetEntryId: turn0EntryId,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("v2");

		const unrevertPoints = findUnrevertPoints();
		expect(unrevertPoints.length).toBe(1);
		const unrevertData = unrevertPoints[0]!.data as {
			preRollbackTreeHash: string | null;
			rolledBackToLeaf: string;
		};
		expect(unrevertData.rolledBackToLeaf).toBe(turn0EntryId);
		expect(unrevertData.preRollbackTreeHash).not.toBeNull();

		await manager.restoreFiles(tempDir, {
			snapshotHash: unrevertData.preRollbackTreeHash!,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("v3");
	});

	it("unrevert after delete-then-rollback restores deleted files", async () => {
		writeFileSync(join(tempDir, "a.ts"), "a1", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "b1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "a2", "utf-8");
		rmSync(join(tempDir, "b.ts"));
		manager.onTurnEnd(tempDir, 0, appendEntry);

		await manager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("a1");
		expect(readFile(join(tempDir, "b.ts"))).toBe("b1");

		const unrevertPoints = findUnrevertPoints();
		expect(unrevertPoints.length).toBe(1);
		const unrevertData = unrevertPoints[0]!.data as {
			preRollbackTreeHash: string | null;
		};
		expect(unrevertData.preRollbackTreeHash).not.toBeNull();

		await manager.restoreFiles(tempDir, {
			snapshotHash: unrevertData.preRollbackTreeHash!,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFile(join(tempDir, "a.ts"))).toBe("a2");
		expect(existsSync(join(tempDir, "b.ts"))).toBe(false);
	});

	it("multiple rollbacks create multiple unrevert-points, each can be unreverted", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);
		const turn0EntryId = appendedEntries[0]!.id;

		writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		await manager.restoreFiles(tempDir, {
			targetEntryId: turn0EntryId,
			entries: toSessionEntries(),
			appendEntry,
		});
		expect(readFile(join(tempDir, "a.ts"))).toBe("v2");

		const unrevertPointsAfterFirst = findUnrevertPoints();
		expect(unrevertPointsAfterFirst.length).toBe(1);

		await manager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});
		expect(readFile(join(tempDir, "a.ts"))).toBe("v1");

		const allUnrevertPoints = findUnrevertPoints();
		expect(allUnrevertPoints.length).toBe(2);

		const unrevertData2 = allUnrevertPoints[1]!.data as {
			preRollbackTreeHash: string | null;
		};

		await manager.restoreFiles(tempDir, {
			snapshotHash: unrevertData2.preRollbackTreeHash!,
			entries: toSessionEntries(),
			appendEntry,
		});
		expect(readFile(join(tempDir, "a.ts"))).toBe("v2");

		const unrevertData1 = allUnrevertPoints[0]!.data as {
			preRollbackTreeHash: string | null;
		};

		await manager.restoreFiles(tempDir, {
			snapshotHash: unrevertData1.preRollbackTreeHash!,
			entries: toSessionEntries(),
			appendEntry,
		});
		expect(readFile(join(tempDir, "a.ts"))).toBe("v3");
	});

	it("unrevert with null preRollbackTreeHash returns empty result (empty dir at start)", async () => {
		await manager.initialize(tempDir);

		const result = await manager.restoreFiles(tempDir, {
			entries: [],
			appendEntry,
		});

		expect(result.restored).toEqual([]);
		expect(result.deleted).toEqual([]);
	});
});
