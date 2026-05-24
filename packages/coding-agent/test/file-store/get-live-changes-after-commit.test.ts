import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import { InternalGit } from "../../src/core/file-store/internal-git.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `glc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("getLiveChanges after onTurnEnd baseline commit", () => {
	let tempDir: string;
	let storeDir: string;
	let git: InternalGit;
	let manager: FileSnapshotManager;
	let entryIdCounter: number;
	let appendedEntries: Array<{ id: string; type: string; data: unknown }>;

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
		appendedEntries.push({ id, type, data });
		return id;
	};

	it("should detect modified file after baseline commit", async () => {
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");

		let changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("foo.ts");
		expect(changes[0]!.status).toBe("added");

		manager.onTurnEnd(tempDir, 0, appendEntry);

		changes = manager.getLiveChanges(tempDir);
		expect(changes).toEqual([]);

		writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");

		changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("foo.ts");
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff).not.toBeNull();
		expect(changes[0]!.diff!.oldContent).toBe("v1");
		expect(changes[0]!.diff!.newContent).toBe("v2");
	});

	it("should detect file added after baseline commit", async () => {
		await manager.initialize(tempDir);

		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "new.ts"), "hello", "utf-8");

		const changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("new.ts");
		expect(changes[0]!.status).toBe("added");
		expect(changes[0]!.diff!.newContent).toBe("hello");
	});

	it("should detect file deleted after baseline commit", async () => {
		writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
		await manager.initialize(tempDir);

		manager.onTurnEnd(tempDir, 0, appendEntry);

		rmSync(join(tempDir, "foo.ts"));

		const changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("foo.ts");
		expect(changes[0]!.status).toBe("deleted");
		expect(changes[0]!.diff!.oldContent).toBe("v1");
		expect(changes[0]!.diff!.newContent).toBeNull();
	});

	it("should detect changes across multiple turn commits", async () => {
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
		manager.onTurnEnd(tempDir, 1, appendEntry);

		writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");

		const changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("a.ts");
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff!.oldContent).toBe("v1");
		expect(changes[0]!.diff!.newContent).toBe("v2");
	});

	it("should return empty when file rewritten with identical content", async () => {
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
		manager.onTurnEnd(tempDir, 0, appendEntry);

		writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");

		const changes = manager.getLiveChanges(tempDir);
		expect(changes).toEqual([]);
	});

	it("should detect changes when onTurnEnd is called between getLiveChanges calls", async () => {
		await manager.initialize(tempDir);

		writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
		let changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.status).toBe("added");

		manager.onTurnEnd(tempDir, 0, appendEntry);
		changes = manager.getLiveChanges(tempDir);
		expect(changes).toEqual([]);

		writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
		changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff!.oldContent).toBe("v1");
		expect(changes[0]!.diff!.newContent).toBe("v2");

		manager.onTurnEnd(tempDir, 1, appendEntry);
		changes = manager.getLiveChanges(tempDir);
		expect(changes).toEqual([]);

		writeFileSync(join(tempDir, "foo.ts"), "v3", "utf-8");
		changes = manager.getLiveChanges(tempDir);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff!.oldContent).toBe("v2");
		expect(changes[0]!.diff!.newContent).toBe("v3");
	});
});
