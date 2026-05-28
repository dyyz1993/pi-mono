/**
 * 验证 get_modified_files 的完整解析链路：
 * 1. 前端发送 toUserMsgEntryId
 * 2. RPC handler 解析出 fromEntryId（找到 user entry 后的 step-snapshot）
 * 3. fileSnapshotManager.getModifiedFiles(fromEntryId) 返回正确的文件列表
 *
 * 确保 rollback Turn B 只显示 Turn B 的文件，不显示 Turn A 的。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createHarness, type Harness } from "../suite/harness.js";

function writeFile(tempDir: string, path: string, content: string): void {
	const abs = join(tempDir, path);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

/**
 * 模拟 RPC handler 的 toUserMsgEntryId 解析逻辑:
 * 找到 user entry 之后第一个 step-snapshot 的 entryId。
 */
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

describe("File snapshot RPC resolution — real entries from harness", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Turn A creates fileA, Turn B creates fileB — getModifiedFiles with fromEntryId from RPC resolves to only fileB", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");

		const entries = harness.sessionManager.getEntries();
		const mgr = (harness.session as any).fileSnapshotManager;
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		expect(userEntries.length).toBe(2);

		const userEntryB = userEntries[1]!;
		const userEntryA = userEntries[0]!;

		// 1. 验证 RPC handler 能找到正确的 step-snapshot
		const snapBId = findSnapshotAfterUserEntry(entries, userEntryB.id);
		expect(snapBId).not.toBeNull();

		const snapAId = findSnapshotAfterUserEntry(entries, userEntryA.id);
		expect(snapAId).not.toBeNull();

		// snap-B 应该和 snap-A 不同
		expect(snapAId).not.toBe(snapBId);

		// 2. 验证 entry 树结构：userEntryB 在 entries 中的位置
		const userIdxB = entries.findIndex((e) => e.id === userEntryB.id);
		const snapIdxB = entries.findIndex((e) => e.id === snapBId);
		const snapIdxA = entries.findIndex((e) => e.id === snapAId);

		// snap-A 应该在 user-B 之前
		expect(snapIdxA).toBeLessThan(userIdxB);
		// snap-B 应该在 user-B 之后
		expect(snapIdxB).toBeGreaterThan(userIdxB);

		// 3. 验证 RPC handler 从 user-B 开始向后找，找到的是 snap-B 不是 snap-A
		const foundSnapshotAfterB = findSnapshotAfterUserEntry(entries, userEntryB.id);
		expect(foundSnapshotAfterB).toBe(snapBId);

		// 4. getModifiedFiles 应该只返回 fileB
		const files = mgr.getModifiedFiles({ fromEntryId: snapBId });
		const paths = files.map((f: any) => f.path);
		expect(paths).toEqual(["fileB.txt"]);

		// 5. 反向验证：从 snap-A 开始应该返回 A+B
		const filesFromA = mgr.getModifiedFiles({ fromEntryId: snapAId });
		expect(filesFromA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileB.txt"]);
	});

	it("Round 2: _initFileSnapshotManager rebuildIndex does not corrupt snapshotIndex", async () => {
		const harness = await createHarness({
			extensionFactories: [fileSnapshotFactory],
		});
		harnesses.push(harness);

		// Turn A: create fileA
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.txt", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileA"),
		]);
		await harness.session.prompt("create fileA");

		// Turn B: create fileB
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.txt", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created fileB"),
		]);
		await harness.session.prompt("create fileB");

		const mgr = (harness.session as any).fileSnapshotManager;

		// 手动模拟 session 重启时的 rebuildIndex
		const entries = harness.sessionManager.getEntries();
		const leafId = harness.sessionManager.getLeafId();
		mgr.rebuildIndex(entries, leafId);

		// rebuildIndex 后验证：
		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		const userEntryB = userEntries[1]!;
		const userEntryA = userEntries[0]!;

		const snapBId = findSnapshotAfterUserEntry(entries, userEntryB.id);
		const snapAId = findSnapshotAfterUserEntry(entries, userEntryA.id);

		// snap-A 应该在 snapshotIndex 中（在 leafId 的路径上）
		const filesFromA = mgr.getModifiedFiles({ fromEntryId: snapAId });
		expect(filesFromA.map((f: any) => f.path).sort()).toEqual(["fileA.txt", "fileB.txt"]);

		// snap-B 返回只有 B
		const filesFromB = mgr.getModifiedFiles({ fromEntryId: snapBId });
		expect(filesFromB.map((f: any) => f.path)).toEqual(["fileB.txt"]);
	});
});
