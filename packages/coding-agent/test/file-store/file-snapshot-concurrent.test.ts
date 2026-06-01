import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("FileSnapshotManager concurrent/external modification", () => {
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

	it("dirty file detection during restoreFiles reports externally modified files but still restores them", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		const targetEntryId = appendedEntries[0]!.id;

		writeFileSync(join(tempDir, "a.ts"), "v3-dirty", "utf-8");

		const result = await manager.restoreFiles(tempDir, {
			targetEntryId,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(result.dirty).toContain("a.ts");
		expect(result.skipped).toEqual([]);
		expect(result.restored).toContain("a.ts");
		expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("v2");
	});

	it("external file added between turns IS captured in snapshot and gets deleted on rollback", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "external.ts"), "external", "utf-8");

		writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		const turn1Data = appendedEntries[1]!.data as {
			diff: { added: string[]; modified: string[]; deleted: string[] };
		};
		expect(turn1Data.diff.added).toContain("external.ts");

		const targetEntryId = appendedEntries[0]!.id;

		const result = await manager.restoreFiles(tempDir, {
			targetEntryId,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("v2");
		expect(existsSync(join(tempDir, "external.ts"))).toBe(false);
		expect(result.deleted).toContain("external.ts");
	});

	it("external file modification between initialize and first turn is detected in snapshot diff", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "b.ts"), "v1-dirty", "utf-8");

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		const data = appendedEntries[0]!.data as {
			diff: { added: string[]; modified: string[]; deleted: string[] };
		};
		expect(data.diff.modified).toContain("a.ts");
		expect(data.diff.modified).toContain("b.ts");
	});

	it("rapid consecutive onTurnEnd calls handle state correctly", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);
		manager.onTurnEnd(tempDir, 1, appendEntry);
		manager.onTurnEnd(tempDir, 2, appendEntry);

		const snapshotCount = appendedEntries.filter((e) => e.customType === "step-snapshot").length;
		expect(snapshotCount).toBe(1);
	});

	it("file deleted externally between turns, then rollback restores it", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		rmSync(join(tempDir, "b.ts"));

		manager.onTurnEnd(tempDir, 1, appendEntry);

		const data = appendedEntries[1]!.data as {
			diff: { added: string[]; modified: string[]; deleted: string[] };
		};
		expect(data.diff.deleted).toContain("b.ts");

		const targetEntryId = appendedEntries[0]!.id;

		await manager.restoreFiles(tempDir, {
			targetEntryId,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(existsSync(join(tempDir, "b.ts"))).toBe(true);
		expect(readFileSync(join(tempDir, "b.ts"), "utf-8")).toBe("v1");
	});

	it("restoreFiles when target and current tree hash are identical returns empty", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		manager.onTurnEnd(tempDir, 1, appendEntry);

		const targetEntryId = appendedEntries[0]!.id;

		const result = await manager.restoreFiles(tempDir, {
			targetEntryId,
			currentLeafId: appendedEntries[0]!.id,
			entries: toSessionEntries(),
			appendEntry,
		});

		expect(result.restored).toEqual([]);
		expect(result.deleted).toEqual([]);
	});

	it("restoreFiles with selective file list ignores unlisted files even if they changed", async () => {
		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
		writeFileSync(join(tempDir, "c.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "v2", "utf-8");
		writeFileSync(join(tempDir, "c.ts"), "v2", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
		writeFileSync(join(tempDir, "b.ts"), "v3", "utf-8");
		writeFileSync(join(tempDir, "c.ts"), "v3", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		const targetEntryId = appendedEntries[0]!.id;

		const result = await manager.restoreFiles(tempDir, {
			targetEntryId,
			entries: toSessionEntries(),
			appendEntry,
			files: ["a.ts", "c.ts"],
		});

		expect(result.restored).toContain("a.ts");
		expect(result.restored).toContain("c.ts");
		expect(result.restored).not.toContain("b.ts");
		expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("v2");
		expect(readFileSync(join(tempDir, "c.ts"), "utf-8")).toBe("v2");
		expect(readFileSync(join(tempDir, "b.ts"), "utf-8")).toBe("v3");
	});
});
