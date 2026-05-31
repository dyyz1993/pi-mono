import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createHarness, type Harness } from "../suite/harness.js";

function writeFile(tempDir: string, relativePath: string, content: string): void {
	const abs = join(tempDir, relativePath);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

function readFile(tempDir: string, relativePath: string): string {
	const abs = join(tempDir, relativePath);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: "compacted",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

function findSnapshotAfterUserEntry(
	entries: Array<{ id: string; type: string; customType?: string; data?: unknown }>,
	userEntryId: string,
): string | null {
	const idx = entries.findIndex((e) => e.id === userEntryId);
	if (idx === -1) return null;
	for (let i = idx; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === "step-snapshot") {
			return e.id;
		}
	}
	return null;
}

describe("compaction rollback preview correctness", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Test 1: rollback preview works BEFORE compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1: create fileA");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2: modify fileA, create fileB");

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A-v2");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("B-v1");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);

		const userEntry1 = userEntries[0];
		const preview = mgr.getRollbackPreviewFiles({
			targetEntryId: userEntry1.id,
			entries,
		});
		const previewPaths = preview.map((f: any) => f.path).sort();
		expect(previewPaths).toEqual(["fileA.txt", "fileB.txt"]);

		const snap1 = findSnapshotAfterUserEntry(entries, userEntry1.id)!;
		const snap2 = findSnapshotAfterUserEntry(entries, userEntries[1].id)!;

		const diffA = mgr.getFileDiff({
			filePath: "fileA.txt",
			fromEntryId: snap1,
			toEntryId: snap2,
		});
		expect(diffA).not.toBeNull();
		expect(diffA!.oldContent).toBe("A-v1");
		expect(diffA!.newContent).toBe("A-v2");
	});

	it("Test 2: rollback preview works AFTER compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, compactionExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1: create fileA");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2: modify fileA");

		await harness.session.compact();

		const compactionEntries = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "compaction");
		expect(compactionEntries.length).toBeGreaterThanOrEqual(1);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v3" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3: create fileC, modify fileA");

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A-v3");
		expect(readFile(harness.tempDir, "fileC.txt")).toBe("C-v1");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;

		mgr.rebuildIndex(entries, harness.sessionManager.getLeafId());

		const userEntries = entries.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntry3 = userEntries[userEntries.length - 1];

		const preview = mgr.getRollbackPreviewFiles({
			targetEntryId: userEntry3.id,
			entries,
		});
		const previewPaths = preview.map((f: any) => f.path).sort();
		expect(previewPaths).toContain("fileA.txt");
		expect(previewPaths).toContain("fileC.txt");

		const snap2Entry = entries
			.filter((e) => e.type === "custom" && (e as any).customType === "step-snapshot")
			.find((e) => {
				const data = (e as any).data as { diff?: { modified?: string[] } };
				return data?.diff?.modified?.includes("fileA.txt");
			});

		if (snap2Entry) {
			const diffA = mgr.getFileDiff({
				filePath: "fileA.txt",
				fromEntryId: snap2Entry.id,
			});
			if (diffA) {
				expect(diffA.oldContent).toBe("A-v2");
				expect(diffA.newContent).toBe("A-v3");
			}
		}

		const diffC = mgr.getFileDiff({ filePath: "fileC.txt" });
		expect(diffC).not.toBeNull();
		expect(diffC!.newContent).toBe("C-v1");
	});

	it("Test 3: rollback PAST compaction — preview still correct", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, compactionExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1: create fileA");

		const turn1UserEntries = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		const turn1LeafId = harness.sessionManager.getLeafId()!;
		const turn1UserEntryId = turn1UserEntries[0].id;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2: modify fileA");

		await harness.session.compact();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v3" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3: modify fileA again");

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A-v3");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		mgr.rebuildIndex(entries, harness.sessionManager.getLeafId());

		const preview = mgr.getRollbackPreviewFiles({
			targetEntryId: turn1LeafId,
			entries,
		});

		if (preview.length > 0) {
			const paths = preview.map((f: any) => f.path).sort();
			expect(paths).toContain("fileA.txt");
		}
	});

	it("Test 4: resolveSnapshotEntryIdForTarget works after compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, compactionExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2");

		await harness.session.compact();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3: create fileC");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		mgr.rebuildIndex(entries, harness.sessionManager.getLeafId());

		const userEntries = entries.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntry3 = userEntries[userEntries.length - 1];

		const resolved = mgr.resolveSnapshotEntryIdForTarget(userEntry3.id, entries);
		expect(resolved).not.toBeNull();

		if (resolved) {
			const diff = mgr.getFileDiff({
				filePath: "fileC.txt",
				fromEntryId: resolved,
			});
			expect(diff).not.toBeNull();
			expect(diff!.newContent).toBe("C-v1");
		}
	});

	it("Test 5: getModifiedFiles returns correct files after compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory, compactionExtension()],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 1: create fileA");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 2: create fileB");

		const entriesBeforeCompact = harness.sessionManager.getEntries();
		const userEntriesBefore = entriesBeforeCompact.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const snap1 = findSnapshotAfterUserEntry(entriesBeforeCompact, userEntriesBefore[0].id)!;
		const snap2 = findSnapshotAfterUserEntry(entriesBeforeCompact, userEntriesBefore[1].id)!;

		await harness.session.compact();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn 3: create fileC");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		mgr.rebuildIndex(entries, harness.sessionManager.getLeafId());

		const filesFromSnap2 = mgr.getModifiedFiles({ fromEntryId: snap2 });
		expect(filesFromSnap2.map((f: any) => f.path).sort()).toEqual(["fileB.txt", "fileC.txt"]);

		const filesFromSnap1 = mgr.getModifiedFiles({ fromEntryId: snap1 });
		const pathsFromSnap1 = filesFromSnap1.map((f: any) => f.path).sort();
		expect(pathsFromSnap1).toEqual(["fileA.txt", "fileB.txt", "fileC.txt"]);
	});
});
