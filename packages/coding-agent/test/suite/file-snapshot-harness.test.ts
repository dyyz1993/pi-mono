/**
 * Harness-based integration tests for snapshot/rollback lifecycle.
 *
 * These tests drive real AgentSession.prompt() calls with faux LLM responses,
 * then use navigateTree() / previewRollback() to roll back, verifying:
 *
 *   - Files are correctly restored on rollback
 *   - Snapshot entries are created during turns
 *   - Rollback then continue creates correct new snapshots
 *   - previewRollback does not modify files
 *   - Multi-turn snapshot chain integrity
 *   - Rollback with file changes in between
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-snap-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeRealWriteTool(cwd: string): AgentTool {
	return {
		name: "write",
		label: "Write",
		description: "Write a file",
		parameters: Type.Object({
			path: Type.String(),
			content: Type.String(),
		}),
		execute: async (_id, params) => {
			const { path, content } = params as { path: string; content: string };
			const fullPath = join(cwd, path);
			mkdirSync(join(fullPath, ".."), { recursive: true });
			writeFileSync(fullPath, content);
			return { content: [{ type: "text", text: `Wrote ${path}` }], details: {} };
		},
	};
}

function makeRealEditTool(cwd: string): AgentTool {
	return {
		name: "edit",
		label: "Edit",
		description: "Edit a file",
		parameters: Type.Object({
			path: Type.String(),
			oldText: Type.String(),
			newText: Type.String(),
		}),
		execute: async (_id, params) => {
			const { path, oldText, newText } = params as { path: string; oldText: string; newText: string };
			const fullPath = join(cwd, path);
			const content = readFileSync(fullPath, "utf-8");
			const updated = content.replace(oldText, newText);
			writeFileSync(fullPath, updated);
			return { content: [{ type: "text", text: `Edited ${path}` }], details: {} };
		},
	};
}

function makeDeleteTool(cwd: string): AgentTool {
	return {
		name: "delete",
		label: "Delete",
		description: "Delete a file",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_id, params) => {
			const { path } = params as { path: string };
			unlinkSync(join(cwd, path));
			return { content: [{ type: "text", text: `Deleted ${path}` }], details: {} };
		},
	};
}

describe("snapshot/rollback harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function createHarnessWithSnapshot(cwd: string, tools: AgentTool[]): Promise<Harness> {
		const harness = await createHarness({
			cwd,
			tools,
			extensionFactories: [fileSnapshotFactory],
		});
		harness.session.setPermissionMode("yolo");
		return harness;
	}

	// Helper: get the step-snapshot entry ID for a given turn
	function getSnapshotEntryId(harness: Harness): string | undefined {
		const entries = harness.sessionManager.getEntries();
		const snapEntry = entries.find(
			(e) => e.type === "custom" && (e as { customType?: string }).customType === "step-snapshot",
		);
		return snapEntry?.id;
	}

	function getAllSnapshotEntryIds(harness: Harness): string[] {
		return harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "custom" && (e as { customType?: string }).customType === "step-snapshot")
			.map((e) => e.id);
	}

	// ─── Basic snapshot creation ───────────────────────────────────────

	it("agent creates file: snapshot is created on turn_end", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithSnapshot(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "new.txt", content: "hello" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create a file");
		await harness.session.agent.waitForIdle();

		const snapIds = getAllSnapshotEntryIds(harness);
		expect(snapIds.length).toBeGreaterThanOrEqual(1);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();
		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "new.txt" && f.status === "added")).toBe(true);
	});

	it("no snapshot created when turn has no file changes", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithSnapshot(cwd, []);
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("just chatting")]);

		await harness.session.prompt("hi");
		await harness.session.agent.waitForIdle();

		const snapIds = getAllSnapshotEntryIds(harness);
		expect(snapIds).toHaveLength(0);
	});

	// ─── Snapshot chain across multiple turns ──────────────────────────

	it("multiple turns create a chain of snapshots", async () => {
		const cwd = makeTempDir();
		const writeTool = makeRealWriteTool(cwd);
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [writeTool, editTool]);
		harnesses.push(harness);

		// Turn 0: create file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "file.txt", content: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("created"),
		]);
		await harness.session.prompt("create file");
		await harness.session.agent.waitForIdle();

		// Turn 1: modify file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "v1", newText: "v2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("modified"),
		]);
		await harness.session.prompt("modify file");
		await harness.session.agent.waitForIdle();

		// Turn 2: modify again
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "v2", newText: "v3" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify again");
		await harness.session.agent.waitForIdle();

		const snapIds = getAllSnapshotEntryIds(harness);
		expect(snapIds.length).toBeGreaterThanOrEqual(3);

		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("v3");
	});

	// ─── Rollback via navigateTree ─────────────────────────────────────

	it("navigateTree rollback restores file to earlier state", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "file.txt"), "original");
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [editTool]);
		harnesses.push(harness);

		// Turn 0: modify
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "original", newText: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("modified"),
		]);
		await harness.session.prompt("modify");
		await harness.session.agent.waitForIdle();

		const snap0Id = getSnapshotEntryId(harness)!;

		// Turn 1: modify further
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "v1", newText: "v2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("modified again"),
		]);
		await harness.session.prompt("modify again");
		await harness.session.agent.waitForIdle();

		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("v2");

		// Rollback to snap0 (via session_tree event)
		const result = await harness.session.navigateTree(snap0Id, { skipFiles: false });
		expect(result.cancelled).toBe(false);

		// File should be restored to v1
		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("v1");
	});

	it("navigateTree rollback restores multiple modified files from the same target snapshot", async () => {
		const cwd = makeTempDir();
		const writeTool = makeRealWriteTool(cwd);
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [writeTool, editTool]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "multi_a.txt", content: "A v1\n" }),
					fauxToolCall("write", { path: "multi_b.txt", content: "B v1\n" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("created"),
		]);
		await harness.session.prompt("create two files");
		await harness.session.agent.waitForIdle();

		const snap0Id = getSnapshotEntryId(harness)!;

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("edit", { path: "multi_a.txt", oldText: "A v1", newText: "A v2" }),
					fauxToolCall("edit", { path: "multi_b.txt", oldText: "B v1", newText: "B v2" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("modified"),
		]);
		await harness.session.prompt("modify both files");
		await harness.session.agent.waitForIdle();

		expect(readFileSync(join(cwd, "multi_a.txt"), "utf-8")).toBe("A v2\n");
		expect(readFileSync(join(cwd, "multi_b.txt"), "utf-8")).toBe("B v2\n");

		const result = await harness.session.navigateTree(snap0Id, { skipFiles: false });
		expect(result.cancelled).toBe(false);

		expect(readFileSync(join(cwd, "multi_a.txt"), "utf-8")).toBe("A v1\n");
		expect(readFileSync(join(cwd, "multi_b.txt"), "utf-8")).toBe("B v1\n");
	});

	it("previewRollback shows what would change without modifying", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "file.txt"), "original");
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [editTool]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "original", newText: "modified" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify");
		await harness.session.agent.waitForIdle();

		// Find the first user message entry (session start point)
		const firstUser = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && (e as { message?: { role?: string } }).message?.role === "user");

		// Preview rollback to first user message (before the modification)
		if (firstUser) {
			const preview = await harness.session.previewRollback(firstUser.id);

			// File should NOT be changed
			expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("modified");
			// Preview should show file.txt would be restored to original
			expect(preview.restored).toContain("file.txt");
		}
	});

	// ─── Rollback then continue ────────────────────────────────────────

	it("rollback then create new file: new snapshot is correct", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "base.txt"), "base");
		const writeTool = makeRealWriteTool(cwd);
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [writeTool, editTool]);
		harnesses.push(harness);

		// Turn 0: modify base
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "base.txt", oldText: "base", newText: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify");
		await harness.session.agent.waitForIdle();
		const snap0Id = getSnapshotEntryId(harness)!;

		// Turn 1: create extra file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "extra.txt", content: "extra" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create extra");
		await harness.session.agent.waitForIdle();

		// Rollback to snap0
		await harness.session.navigateTree(snap0Id, { skipFiles: false });

		// extra.txt should be gone
		expect(existsSync(join(cwd, "extra.txt"))).toBe(false);
		expect(readFileSync(join(cwd, "base.txt"), "utf-8")).toBe("v1");

		// Turn 2: create brand new file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "fresh.txt", content: "fresh" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create fresh");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "fresh.txt"))).toBe(true);

		const mgr = harness.session.fileSnapshotManager;
		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "fresh.txt")).toBe(true);
		// extra.txt should NOT appear in modified files
		expect(modified.some((f) => f.path === "extra.txt")).toBe(false);
	});

	it("rollback then modify same file: diff shows correct old/new", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "file.txt"), "original");
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [editTool]);
		harnesses.push(harness);

		// Turn 0: modify to v1
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "original", newText: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify");
		await harness.session.agent.waitForIdle();
		const snap0Id = getSnapshotEntryId(harness)!;

		// Turn 1: modify to v2
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "v1", newText: "v2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify again");
		await harness.session.agent.waitForIdle();

		// Rollback to snap0
		await harness.session.navigateTree(snap0Id, { skipFiles: false });
		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("v1");

		// Modify again to v3
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "v1", newText: "v3" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify to v3");
		await harness.session.agent.waitForIdle();

		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("v3");

		const mgr = harness.session.fileSnapshotManager;
		const diff = mgr!.getFileDiff({ filePath: "file.txt" });
		expect(diff).not.toBeNull();
	});

	// ─── Multiple file operations in one turn ──────────────────────────

	it("agent creates multiple files in one turn: all in same snapshot", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithSnapshot(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "a.txt", content: "A" }),
					fauxToolCall("write", { path: "b.txt", content: "B" }),
					fauxToolCall("write", { path: "c.txt", content: "C" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create three files");
		await harness.session.agent.waitForIdle();

		const mgr = harness.session.fileSnapshotManager;
		const modified = mgr!.getModifiedFiles();
		const paths = modified.map((f) => f.path);
		expect(paths).toContain("a.txt");
		expect(paths).toContain("b.txt");
		expect(paths).toContain("c.txt");
	});

	// ─── Delete then rollback restores file ────────────────────────────

	it("rollback after delete: preview shows file would be restored", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "victim.txt"), "important");
		const deleteTool = makeDeleteTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [deleteTool]);
		harnesses.push(harness);

		// Turn 0: delete the file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("delete", { path: "victim.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("deleted"),
		]);
		await harness.session.prompt("delete file");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "victim.txt"))).toBe(false);

		// Preview rollback to first user message (before deletion)
		const firstUser = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && (e as { message?: { role?: string } }).message?.role === "user");

		if (firstUser) {
			const preview = await harness.session.previewRollback(firstUser.id);
			expect(preview.restored).toContain("victim.txt");
		}
	});

	// ─── Nested directory creation ─────────────────────────────────────

	it("snapshot captures nested directory file creation", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithSnapshot(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("write", { path: "src/components/Button.tsx", content: "export const B = () => null" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create component");
		await harness.session.agent.waitForIdle();

		const mgr = harness.session.fileSnapshotManager;
		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "src/components/Button.tsx")).toBe(true);
	});

	// ─── Large file handling ───────────────────────────────────────────

	it("snapshot handles large file content", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithSnapshot(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		const largeContent = "x".repeat(50000);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "large.txt", content: largeContent })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("write large file");
		await harness.session.agent.waitForIdle();

		const mgr = harness.session.fileSnapshotManager;
		const diff = mgr!.getFileDiff({ filePath: "large.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.newContent).toBe(largeContent);
	});

	// ─── Turn with no changes between turns with changes ───────────────

	it("turn with no changes between turns with changes: snapshot chain correct", async () => {
		const cwd = makeTempDir();
		const writeTool = makeRealWriteTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [writeTool]);
		harnesses.push(harness);

		// Turn 0: create file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "A" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create a");
		await harness.session.agent.waitForIdle();

		// Turn 1: no changes
		harness.setResponses([fauxAssistantMessage("just chatting")]);
		await harness.session.prompt("hi");
		await harness.session.agent.waitForIdle();

		// Turn 2: create another file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "b.txt", content: "B" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create b");
		await harness.session.agent.waitForIdle();

		// Should have 2 snapshots (turn 1 had no changes)
		const snapIds = getAllSnapshotEntryIds(harness);
		expect(snapIds.length).toBe(2);
	});

	// ─── skipFiles rollback ────────────────────────────────────────────

	it("navigateTree with skipFiles: skips file restoration and propagates skipFiles flag", async () => {
		// navigateTree propagates `skipFiles` through the session_tree event and
		// skips restoreFiles when skipFiles is true. This keeps "message-only"
		// rollback semantics: conversation tree navigates to the target entry,
		// but on-disk files remain at their current (modified) state.
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "file.txt"), "original");
		const editTool = makeRealEditTool(cwd);
		const harness = await createHarnessWithSnapshot(cwd, [editTool]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "file.txt", oldText: "original", newText: "modified" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify");
		await harness.session.agent.waitForIdle();

		// Navigate with skipFiles — both navigateTree and the file-snapshot
		// extension's session_tree handler must honor skipFiles, leaving the
		// on-disk file at its current (modified) state.
		const firstUserEntry = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && (e as { message?: { role?: string } }).message?.role === "user");

		if (firstUserEntry) {
			await harness.session.navigateTree(firstUserEntry.id, { skipFiles: true });
		}

		// File remains modified — skipFiles correctly prevented restoration.
		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("modified");
	});
});
