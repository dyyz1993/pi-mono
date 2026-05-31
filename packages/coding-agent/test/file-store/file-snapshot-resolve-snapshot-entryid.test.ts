import { describe, expect, it, vi } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import type { StepSnapshotData } from "../../src/core/file-store/file-snapshot-manager.js";

type MockReadTreeFn = (hash: string) => Map<string, string> | null;

function createMockGit(readTreeFn: MockReadTreeFn) {
	return {
		readTree: vi.fn(readTreeFn),
		readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
		writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
		computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
		parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
	} as any;
}

function msg(id: string, parentId: string | null, role: string = "user"): any {
	return {
		type: "message",
		id,
		parentId,
		role,
		timestamp: `t-${id}`,
		message: { role, content: "" },
	};
}

function snap(
	id: string,
	parentId: string,
	data: {
		baselineTreeHash: string | null;
		snapshotTreeHash: string;
		added?: string[];
		modified?: string[];
		deleted?: string[];
		turnIndex: number;
	},
): any {
	return {
		type: "custom",
		customType: "step-snapshot",
		id,
		parentId,
		timestamp: `t-${id}`,
		data: {
			baselineTreeHash: data.baselineTreeHash,
			snapshotTreeHash: data.snapshotTreeHash,
			diff: {
				added: data.added ?? [],
				modified: data.modified ?? [],
				deleted: data.deleted ?? [],
			},
			turnIndex: data.turnIndex,
		} satisfies StepSnapshotData,
	};
}

function setupManager(
	treeStore: Map<string, Map<string, string>>,
	entries: any[],
	sessionStartTreeHash?: string,
) {
	const manager = new FileSnapshotManager(
		createMockGit((hash: string) => treeStore.get(hash) ?? null),
	);

	manager.rebuildIndex(entries);

	if (sessionStartTreeHash !== undefined) {
		(manager as any).sessionStartTreeHash = sessionStartTreeHash;
	}

	return manager;
}

function makeTree(files: Record<string, string>): Map<string, string> {
	return new Map(Object.entries(files));
}

describe("resolveSnapshotEntryIdForTarget", () => {
	it("returns same ID when target is directly a snapshot entry", () => {
		const treeStore = new Map<string, Map<string, string>>();
		treeStore.set("hash-start", makeTree({}));

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
			snap("snap-t1", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1",
				added: ["a.txt"],
				turnIndex: 0,
			}),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("snap-t1", entries);
		expect(result).toBe("snap-t1");
	});

	it("resolves user message to snapshot ancestor on path", () => {
		const treeStore = new Map<string, Map<string, string>>();
		treeStore.set("hash-start", makeTree({}));
		treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
			snap("snap-t1", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1",
				added: ["a.txt"],
				turnIndex: 0,
			}),
			msg("u2", "snap-t1", "user"),
			msg("a2", "u2", "assistant"),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("u2", entries);
		expect(result).toBe("snap-t1");
	});

	it("resolves assistant message to snapshot as direct child", () => {
		const treeStore = new Map<string, Map<string, string>>();
		treeStore.set("hash-start", makeTree({}));
		treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
			snap("snap-t1", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1",
				added: ["a.txt"],
				turnIndex: 0,
			}),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("a1", entries);
		expect(result).toBe("snap-t1");
	});

	it("returns null when target has no snapshot on path and no snapshot children", () => {
		const treeStore = new Map<string, Map<string, string>>();

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("u1", entries);
		expect(result).toBeNull();
	});

	it("returns last snapshot when multiple snapshots are direct children", () => {
		const treeStore = new Map<string, Map<string, string>>();
		treeStore.set("hash-start", makeTree({}));
		treeStore.set("hash-t1a", makeTree({ "a.txt": "a" }));
		treeStore.set("hash-t1b", makeTree({ "a.txt": "a", "b.txt": "b" }));

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
			snap("snap-t1a", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1a",
				added: ["a.txt"],
				turnIndex: 0,
			}),
			snap("snap-t1b", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1b",
				added: ["a.txt", "b.txt"],
				turnIndex: 1,
			}),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("a1", entries);
		expect(result).toBe("snap-t1b");
	});

	it("resolves deep user message via path walk to nearest ancestor snapshot", () => {
		const treeStore = new Map<string, Map<string, string>>();
		treeStore.set("hash-start", makeTree({}));
		treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
		treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));
		treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }));

		const entries = [
			msg("u1", null, "user"),
			msg("a1", "u1", "assistant"),
			snap("snap-t1", "a1", {
				baselineTreeHash: "hash-start",
				snapshotTreeHash: "hash-t1",
				added: ["a.txt"],
				turnIndex: 0,
			}),
			msg("u2", "snap-t1", "user"),
			msg("a2", "u2", "assistant"),
			snap("snap-t2", "a2", {
				baselineTreeHash: "hash-t1",
				snapshotTreeHash: "hash-t2",
				added: ["b.txt"],
				turnIndex: 1,
			}),
			msg("u3", "snap-t2", "user"),
			msg("a3", "u3", "assistant"),
			snap("snap-t3", "a3", {
				baselineTreeHash: "hash-t2",
				snapshotTreeHash: "hash-t3",
				added: ["c.txt"],
				turnIndex: 2,
			}),
		];

		const manager = setupManager(treeStore, entries);
		const result = manager.resolveSnapshotEntryIdForTarget("u3", entries);
		expect(result).toBe("snap-t2");
	});
});
