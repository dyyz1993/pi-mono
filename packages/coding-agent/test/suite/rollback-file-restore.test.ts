/**
 * End-to-end rollback file restore tests using the REAL file-snapshot extension.
 *
 * Validates the complete chain:
 *   navigateTree() → emit("session_tree") → file-snapshot extension → restoreFiles() → disk changes
 *
 * Also validates the read path:
 *   getModifiedFiles(fromEntryId) → correct file list per turn
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createHarness, type Harness } from "./harness.js";

function writeFile(tempDir: string, path: string, content: string): void {
	const abs = join(tempDir, path);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

function readFile(tempDir: string, path: string): string {
	const abs = join(tempDir, path);
	return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
}

function fileExists(tempDir: string, path: string): boolean {
	return existsSync(join(tempDir, path));
}

/**
 * Find the first step-snapshot entry after a given user entry.
 * Mirrors the RPC handler logic for resolving toUserMsgEntryId → fromEntryId.
 */
function findSnapshotAfterUserEntry(
	entries: Array<{ id: string; type: string; customType?: string; data?: unknown }>,
	userEntryId: string,
): string | null {
	const idx = entries.findIndex((e) => e.id === userEntryId);
	if (idx === -1) return null;
	for (let i = idx + 1; i < entries.length; i++) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === "step-snapshot") {
			return e.id;
		}
	}
	return null;
}

describe("Rollback file restore — real file-snapshot extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Turn A creates fileA, Turn B creates fileB — rollback Turn B deletes only fileB", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Verify the extension is loaded
		const mgr = (harness.session as any).fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A-v1");

		const entriesAfterA = harness.sessionManager.getEntries();
		const userEntryA = entriesAfterA
			.filter((e) => e.type === "message" && (e as any).message?.role === "user")
			.pop()!;
		expect(userEntryA).toBeDefined();

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("B-v1");

		const entriesAfterB = harness.sessionManager.getEntries();
		const userEntries = entriesAfterB.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		expect(userEntries.length).toBe(2);
		const userEntryB = userEntries[1]!;

		// --- Read path: getModifiedFiles ---
		const snapA = findSnapshotAfterUserEntry(entriesAfterB, userEntryA.id);
		const snapB = findSnapshotAfterUserEntry(entriesAfterB, userEntryB.id);

		// Rollback Turn B → should only show fileB
		const filesB = mgr.getModifiedFiles({ fromEntryId: snapB! });
		expect(filesB.map((f: any) => f.path)).toEqual(["fileB.txt"]);

		// Rollback Turn A → should show fileA + fileB
		const filesA = mgr.getModifiedFiles({ fromEntryId: snapA! });
		expect(filesA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileB.txt"]);

		// --- Write path: navigateTree + restoreFiles ---
		// Rollback Turn B by navigating to userEntryB.
		// For user messages, navigateTree sets newLeafId = userEntryB.parentId
		// (the last entry of Turn A — a step-snapshot or assistant message).
		// The extension's session_tree handler will call restoreFiles
		// targeting that position, which should preserve fileA and delete fileB.
		await harness.session.navigateTree(userEntryB.id, { summarize: false });

		// fileA should still exist
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A-v1");
		// fileB should be DELETED from disk (created in Turn B)
		expect(fileExists(harness.tempDir, "fileB.txt")).toBe(false);

		// Only 1 user message should remain (Turn A)
		const remainingMsgs = harness.session.messages;
		const remainingUsers = remainingMsgs.filter((m) => m.role === "user");
		expect(remainingUsers.length).toBe(1);
	});

	it("Turn A creates fileA, Turn B modifies fileA — rollback Turn B restores fileA v1", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("v1");

		const entriesAfterA = harness.sessionManager.getEntries();
		const userEntryA = entriesAfterA
			.filter((e) => e.type === "message" && (e as any).message?.role === "user")
			.pop()!;

		// Turn B: modify fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified fileA"),
		]);
		await harness.session.prompt("modify fileA");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("v2");

		// --- Read path: getModifiedFiles ---
		const entriesAfterB = harness.sessionManager.getEntries();
		const userEntries = entriesAfterB.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntryB = userEntries[1]!;
		const snapB = findSnapshotAfterUserEntry(entriesAfterB, userEntryB.id);

		const mgr = (harness.session as any).fileSnapshotManager;
		const filesB = mgr.getModifiedFiles({ fromEntryId: snapB! });
		// Turn B modified fileA
		expect(filesB.map((f: any) => f.path)).toEqual(["fileA.txt"]);
		expect(filesB[0].status).toBe("modified");

		// --- Write path: rollback Turn B by navigating to userEntryB ---
		await harness.session.navigateTree(userEntryB.id, { summarize: false });

		// fileA should be restored to v1
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("v1");
	});

	it("3 turns: A→B→C — rollback Turn B shows B+C, rollback Turn C shows only C", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");

		const entriesAfterA = harness.sessionManager.getEntries();
		const userEntryA = entriesAfterA
			.filter((e) => e.type === "message" && (e as any).message?.role === "user")
			.pop()!;

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");

		const entriesAfterB = harness.sessionManager.getEntries();
		const userEntriesAfterB = entriesAfterB.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntryB = userEntriesAfterB[1]!;

		// Turn C: create fileC
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileC"),
		]);
		await harness.session.prompt("create fileC");

		const entriesAfterC = harness.sessionManager.getEntries();

		// --- Read path ---
		const snapA = findSnapshotAfterUserEntry(entriesAfterC, userEntryA.id);
		const snapB = findSnapshotAfterUserEntry(entriesAfterC, userEntryB.id);

		const mgr = (harness.session as any).fileSnapshotManager;

		// Rollback Turn B → should show B + C
		const filesB = mgr.getModifiedFiles({ fromEntryId: snapB! });
		expect(filesB.map((f: any) => f.path).sort()).toEqual(["fileB.txt", "fileC.txt"]);

		// Rollback Turn A → should show A + B + C
		const filesA = mgr.getModifiedFiles({ fromEntryId: snapA! });
		expect(filesA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileB.txt", "fileC.txt"]);

		// --- Write path: rollback Turn B (navigate to userEntryB) ---
		await harness.session.navigateTree(userEntryB.id, { summarize: false });

		// fileA should still exist
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		// fileB and fileC should be DELETED
		expect(fileExists(harness.tempDir, "fileB.txt")).toBe(false);
		expect(fileExists(harness.tempDir, "fileC.txt")).toBe(false);

		// Only 1 user message should remain
		const remainingUsers = harness.session.messages.filter((m) => m.role === "user");
		expect(remainingUsers.length).toBe(1);
	});

	it("skipFiles=true does NOT restore files but does navigate tree", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");

		const entries = harness.sessionManager.getEntries();
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		const userEntryB = userEntries[1]!;

		// Rollback Turn B with skipFiles=true
		await harness.session.navigateTree(userEntryB.id, { summarize: false, skipFiles: true });

		// Files should NOT be touched
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("B");

		// But tree should have navigated (1 user msg)
		const remainingUsers = harness.session.messages.filter((m) => m.role === "user");
		expect(remainingUsers.length).toBe(1);
	});

	it("rollback → continue → rollback again: multi-cycle file restoration", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("B");

		// Get entry IDs for rollback
		const entriesAfterB = harness.sessionManager.getEntries();
		const userEntries = entriesAfterB.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntryB = userEntries[1]!;

		// Cycle 1: Rollback Turn B → fileB deleted, fileA preserved
		await harness.session.navigateTree(userEntryB.id, { summarize: false });
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(fileExists(harness.tempDir, "fileB.txt")).toBe(false);
		// Verify user messages count
		let remainingUsers = harness.session.messages.filter((m) => m.role === "user");
		expect(remainingUsers.length).toBe(1);

		// Cycle 2: Turn C (after rollback) — create fileC
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "C" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileC"),
		]);
		await harness.session.prompt("create fileC");
		expect(readFile(harness.tempDir, "fileC.txt")).toBe("C");

		// Verify fileA still exists, fileB still does not
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(fileExists(harness.tempDir, "fileB.txt")).toBe(false);

		// Rollback Turn C → fileC deleted, fileA preserved
		const entriesAfterC = harness.sessionManager.getEntries();
		const userEntriesAfterC = entriesAfterC.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntryC = userEntriesAfterC[1]!; // user A is first, user C is second after rollback
		await harness.session.navigateTree(userEntryC.id, { summarize: false });
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(fileExists(harness.tempDir, "fileC.txt")).toBe(false);

		// Cycle 3: Turn D (after third rollback) — create fileD
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileD.txt", content: "D" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileD"),
		]);
		await harness.session.prompt("create fileD");
		expect(readFile(harness.tempDir, "fileD.txt")).toBe("D");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");

		// Rollback Turn D → fileD deleted
		const entriesAfterD = harness.sessionManager.getEntries();
		const userEntriesAfterD = entriesAfterD.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		const userEntryD = userEntriesAfterD[1]!;
		await harness.session.navigateTree(userEntryD.id, { summarize: false });
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("A");
		expect(fileExists(harness.tempDir, "fileD.txt")).toBe(false);

		// Final verification: only 1 user message (Turn A)
		remainingUsers = harness.session.messages.filter((m) => m.role === "user");
		expect(remainingUsers.length).toBe(1);
	});
});
