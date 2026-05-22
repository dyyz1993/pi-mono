import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-rebuild-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("rebuildIndex sessionStartTreeHash regression", () => {
	let tempDir: string;
	let storeDir: string;
	let git: InternalGit;
	let appendedEntries: MockCustomEntry[];
	let entryIdCounter: number;

	beforeEach(() => {
		tempDir = createTempDir();
		storeDir = createTempDir();
		git = InternalGit.createForProject(storeDir, tempDir);
		appendedEntries = [];
		entryIdCounter = 0;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	const appendEntry = (type: string, data: unknown): string => {
		const id = `entry-${entryIdCounter++}`;
		const entry: MockCustomEntry = {
			type: "custom",
			id,
			parentId: appendedEntries.length > 0 ? appendedEntries[appendedEntries.length - 1]!.id : null,
			timestamp: new Date().toISOString(),
			customType: type,
			data,
		};
		appendedEntries.push(entry);
		return id;
	};

	const toSessionEntries = (): SessionEntry[] => {
		return appendedEntries as unknown as SessionEntry[];
	};

	it("rebuildIndex restores sessionStartTreeHash from first snapshot's baselineTreeHash", async () => {
		writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");

		const manager = new FileSnapshotManager(git);
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "changed", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		const firstSnapshotData = appendedEntries[0]!.data as { baselineTreeHash: string | null };
		expect(firstSnapshotData.baselineTreeHash).not.toBeNull();

		writeFileSync(join(tempDir, "a.ts"), "changed-more", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		const newManager = new FileSnapshotManager(git);
		newManager.rebuildIndex(toSessionEntries());

		const result = await newManager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(result.restored).toContain("a.ts");
		expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("original");
	});

	it("rebuildIndex with empty entries leaves sessionStartTreeHash as null", async () => {
		const manager = new FileSnapshotManager(git);
		manager.rebuildIndex([]);

		const result = await manager.restoreFiles(tempDir, {
			entries: [],
			appendEntry,
		});

		expect(result.restored).toEqual([]);
		expect(result.deleted).toEqual([]);
	});

	it("rebuildIndex with only one snapshot restores rollback-to-root correctly", async () => {
		writeFileSync(join(tempDir, "b.ts"), "b-content", "utf-8");
		writeFileSync(join(tempDir, "c.ts"), "c-content", "utf-8");

		const manager = new FileSnapshotManager(git);
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "b.ts"), "b-modified", "utf-8");
		rmSync(join(tempDir, "c.ts"));
		manager.onTurnEnd(tempDir, 0, appendEntry);

		const newManager = new FileSnapshotManager(git);
		newManager.rebuildIndex(toSessionEntries());

		const result = await newManager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(result.restored).toContain("b.ts");
		expect(result.restored).toContain("c.ts");
		expect(readFileSync(join(tempDir, "b.ts"), "utf-8")).toBe("b-content");
		expect(readFileSync(join(tempDir, "c.ts"), "utf-8")).toBe("c-content");
	});

	it("rebuildIndex after multiple turns restores sessionStartTreeHash from first turn only", async () => {
		writeFileSync(join(tempDir, "x.ts"), "x-v0", "utf-8");

		const manager = new FileSnapshotManager(git);
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "x.ts"), "x-v1", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "x.ts"), "x-v2", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		writeFileSync(join(tempDir, "x.ts"), "x-v3", "utf-8");
		manager.onTurnEnd(tempDir, 2, appendEntry);

		const firstBaseline = (appendedEntries[0]!.data as { baselineTreeHash: string | null }).baselineTreeHash;
		expect(firstBaseline).not.toBeNull();

		const newManager = new FileSnapshotManager(git);
		newManager.rebuildIndex(toSessionEntries());

		const result = await newManager.restoreFiles(tempDir, {
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(result.restored).toContain("x.ts");
		expect(readFileSync(join(tempDir, "x.ts"), "utf-8")).toBe("x-v0");
	});
});
