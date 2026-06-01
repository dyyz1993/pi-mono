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

function fileExists(tempDir: string, relativePath: string): boolean {
	return existsSync(join(tempDir, relativePath));
}

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

describe("manual edit rollback preview — current behavior documentation", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function setupThreeTurns(harness: Harness) {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "hello" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn A: create fileA");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("hello");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "world" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "foo" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn B: modify fileA, create fileB");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("world");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("foo");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "final" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "bar" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.txt", content: "baz" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("turn C: modify fileA fileB, create fileC");
		expect(readFile(harness.tempDir, "fileA.txt")).toBe("final");
		expect(readFile(harness.tempDir, "fileB.txt")).toBe("bar");
		expect(readFile(harness.tempDir, "fileC.txt")).toBe("baz");
	}

	it("Test 1: file list does NOT include manually-created fileD", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);
		await setupThreeTurns(harness);

		writeFileSync(join(harness.tempDir, "fileD.txt"), "新文件", "utf-8");
		writeFileSync(join(harness.tempDir, "fileA.txt"), "我改的", "utf-8");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");

		const userEntryA = userEntries[0];
		const preview = mgr.getRollbackPreviewFiles({
			targetEntryId: userEntryA.id,
			entries,
		});
		const previewPaths = preview.map((f: any) => f.path).sort();

		expect(previewPaths).toContain("fileA.txt");
		expect(previewPaths).toContain("fileB.txt");
		expect(previewPaths).toContain("fileC.txt");
		expect(previewPaths).not.toContain("fileD.txt");
	});

	it("Test 2: getFileDiff shows SNAPSHOT content, NOT disk content", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);
		await setupThreeTurns(harness);

		writeFileSync(join(harness.tempDir, "fileA.txt"), "我改的", "utf-8");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");

		const snapC = findSnapshotAfterUserEntry(entries, userEntries[2].id);
		expect(snapC).not.toBeNull();

		const diff = mgr.getFileDiff({
			filePath: "fileA.txt",
			fromEntryId: snapC!,
		});
		expect(diff).not.toBeNull();
		expect(diff!.newContent).toBe("final");
		expect(diff!.newContent).not.toBe("我改的");
	});

	it("Test 3: disk content is independent of preview", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);
		await setupThreeTurns(harness);

		writeFileSync(join(harness.tempDir, "fileA.txt"), "我改的", "utf-8");
		writeFileSync(join(harness.tempDir, "fileD.txt"), "新文件", "utf-8");

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("我改的");
		expect(readFile(harness.tempDir, "fileD.txt")).toBe("新文件");
	});

	it("Test 4: after actual rollback, ALL files restored including manually-edited fileA", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);
		await setupThreeTurns(harness);

		writeFileSync(join(harness.tempDir, "fileA.txt"), "我改的", "utf-8");
		writeFileSync(join(harness.tempDir, "fileD.txt"), "新文件", "utf-8");

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("我改的");
		expect(readFile(harness.tempDir, "fileD.txt")).toBe("新文件");

		const userEntries = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		const userEntryB = userEntries[1];

		await harness.session.navigateTree(userEntryB.id, { summarize: false, skipFiles: false });

		expect(readFile(harness.tempDir, "fileA.txt")).toBe("hello");
		expect(fileExists(harness.tempDir, "fileB.txt")).toBe(false);
		expect(fileExists(harness.tempDir, "fileC.txt")).toBe(false);
		expect(readFile(harness.tempDir, "fileD.txt")).toBe("新文件");
	});
});
