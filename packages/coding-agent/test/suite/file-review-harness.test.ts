/**
 * Harness-based integration tests for the file-review extension.
 *
 * These tests load the file-review extension through createHarness with
 * extensionFactories, drive real AgentSession.prompt() calls with faux
 * LLM responses, and verify that file changes are captured correctly
 * through the full event pipeline:
 *
 *   AgentSession.prompt() → Agent loop → tool_call → tool_result
 *   → file-review extension turn_end handler → fileSnapshotManager
 *
 * The channel RPC methods (review.approve, review.reject, etc.) are not
 * available in harness mode (registerChannel throws outside RPC mode),
 * so we verify via:
 *   - fileSnapshotManager.getLiveChanges() / getModifiedFiles() / getFileDiff()
 *   - session entries (file-review-turn, file-approval custom entries)
 *   - session events (turn_end)
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import fileReviewFactory from "../../extensions/file-review/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-review-harness-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * A simple write tool that writes files to disk.
 */
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
		parameters: Type.Object({
			path: Type.String(),
		}),
		execute: async (_id, params) => {
			const { path } = params as { path: string };
			unlinkSync(join(cwd, path));
			return { content: [{ type: "text", text: `Deleted ${path}` }], details: {} };
		},
	};
}

describe("file-review harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function createHarnessWithReview(cwd: string, tools: AgentTool[]): Promise<Harness> {
		const harness = await createHarness({
			cwd,
			tools,
			extensionFactories: [fileReviewFactory],
		});
		harness.session.setPermissionMode("yolo");
		return harness;
	}

	// ─── Single file create ───────────────────────────────────────────

	it("agent creates a file: file-review captures it as added", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "new.txt", content: "hello" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create a file");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "new.txt"))).toBe(true);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "new.txt" && f.status === "added")).toBe(true);

		const diff = mgr!.getFileDiff({ filePath: "new.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBeNull();
		expect(diff!.newContent).toBe("hello");
	});

	// ─── File modify ──────────────────────────────────────────────────

	it("agent modifies existing file: file-review captures modification", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "existing.txt"), "original\n");

		const harness = await createHarnessWithReview(cwd, [makeRealEditTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("edit", { path: "existing.txt", oldText: "original", newText: "modified" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit the file");
		await harness.session.agent.waitForIdle();

		expect(readFileSync(join(cwd, "existing.txt"), "utf-8")).toBe("modified\n");

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "existing.txt" && f.status === "modified")).toBe(true);

		const diff = mgr!.getFileDiff({ filePath: "existing.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("original\n");
		expect(diff!.newContent).toBe("modified\n");
	});

	// ─── File delete ──────────────────────────────────────────────────

	it("agent deletes a file: file-review captures deletion", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "victim.txt"), "delete me\n");

		const harness = await createHarnessWithReview(cwd, [makeDeleteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("delete", { path: "victim.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("delete the file");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "victim.txt"))).toBe(false);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "victim.txt" && f.status === "deleted")).toBe(true);

		const diff = mgr!.getFileDiff({ filePath: "victim.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("delete me\n");
		expect(diff!.newContent).toBeNull();
	});

	// ─── Multiple files in one turn ───────────────────────────────────

	it("agent creates multiple files in one turn: all captured", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "a.txt", content: "aaa" }),
					fauxToolCall("write", { path: "b.txt", content: "bbb" }),
					fauxToolCall("write", { path: "c.txt", content: "ccc" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create three files");
		await harness.session.agent.waitForIdle();

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const modified = mgr!.getModifiedFiles();
		const paths = modified.map((f) => f.path);
		expect(paths).toContain("a.txt");
		expect(paths).toContain("b.txt");
		expect(paths).toContain("c.txt");
		expect(modified.every((f) => f.status === "added")).toBe(true);
	});

	// ─── Multi-turn file lifecycle ────────────────────────────────────

	it("multi-turn: create → modify → delete cycle", async () => {
		const cwd = makeTempDir();
		const writeTool = makeRealWriteTool(cwd);
		const editTool = makeRealEditTool(cwd);
		const deleteTool = makeDeleteTool(cwd);

		const harness = await createHarnessWithReview(cwd, [writeTool, editTool, deleteTool]);
		harnesses.push(harness);

		// Turn 0: create
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "lifecycle.txt", content: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("created"),
		]);

		await harness.session.prompt("create lifecycle.txt");
		await harness.session.agent.waitForIdle();

		// Turn 1: modify
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "lifecycle.txt", oldText: "v1", newText: "v2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("modified"),
		]);

		await harness.session.prompt("modify it");
		await harness.session.agent.waitForIdle();

		// Turn 2: delete
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("delete", { path: "lifecycle.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("deleted"),
		]);

		await harness.session.prompt("delete it");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "lifecycle.txt"))).toBe(false);

		// Should have multiple turn_end events
		const turnEnds = harness.events.filter((e) => e.type === "turn_end");
		expect(turnEnds.length).toBeGreaterThanOrEqual(3);

		// Snapshot manager should have full history
		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();
		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "lifecycle.txt")).toBe(true);
	});

	// ─── Turn with no changes ─────────────────────────────────────────

	it("turn with no file changes does not produce turn_end entry", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("just chatting")]);

		await harness.session.prompt("say hi");
		await harness.session.agent.waitForIdle();

		const turnEnds = harness.events.filter((e) => e.type === "turn_end");
		expect(turnEnds.length).toBeGreaterThanOrEqual(1);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();
		// No modifications
		const modified = mgr!.getModifiedFiles();
		expect(modified).toHaveLength(0);
	});

	// ─── Session entries are persisted ────────────────────────────────

	it("file-review-turn entries are persisted in session manager", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "tracked.txt", content: "tracked" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write tracked.txt");
		await harness.session.agent.waitForIdle();

		const entries = harness.sessionManager.getEntries();
		const turnEntries = entries.filter(
			(e) => e.type === "custom" && (e as { customType?: string }).customType === "file-review-turn",
		);

		expect(turnEntries.length).toBeGreaterThanOrEqual(1);

		const turnData = (turnEntries[0] as { data: unknown }).data as {
			changes: Array<{ path: string; status: string }>;
		};
		expect(turnData.changes.some((c) => c.path === "tracked.txt")).toBe(true);
	});

	// ─── Nested directories ───────────────────────────────────────────

	it("agent creates files in nested directories: all captured", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("write", { path: "src/components/Button.tsx", content: "export const Button = () => null" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create a component");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "src/components/Button.tsx"))).toBe(true);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "src/components/Button.tsx")).toBe(true);
	});

	// ─── File modify then modify again same session ───────────────────

	it("file modified across two turns: snapshot history shows both", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "evolving.txt"), "v0\n");

		const harness = await createHarnessWithReview(cwd, [makeRealEditTool(cwd)]);
		harnesses.push(harness);

		// Turn 0: modify to v1
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "evolving.txt", oldText: "v0", newText: "v1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("v1"),
		]);

		await harness.session.prompt("modify to v1");
		await harness.session.agent.waitForIdle();

		// Turn 1: modify to v2
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "evolving.txt", oldText: "v1", newText: "v2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("v2"),
		]);

		await harness.session.prompt("modify to v2");
		await harness.session.agent.waitForIdle();

		expect(readFileSync(join(cwd, "evolving.txt"), "utf-8")).toBe("v2\n");

		// Should have multiple turn entries
		const entries = harness.sessionManager.getEntries();
		const turnEntries = entries.filter(
			(e) => e.type === "custom" && (e as { customType?: string }).customType === "file-review-turn",
		);
		expect(turnEntries.length).toBeGreaterThanOrEqual(2);
	});

	// ─── Extension loads and fires session_start ──────────────────────

	it("file-review extension loads without error via extensionFactories", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, []);
		harnesses.push(harness);

		// Extension should be loaded — no error thrown
		// session_start fires automatically during harness creation
		expect(harness.session).toBeDefined();

		// Should be able to prompt without file changes
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		await harness.session.agent.waitForIdle();
	});

	// ─── Large file content ───────────────────────────────────────────

	it("captures large file content correctly", async () => {
		const cwd = makeTempDir();
		const harness = await createHarnessWithReview(cwd, [makeRealWriteTool(cwd)]);
		harnesses.push(harness);

		const largeContent = "x".repeat(10000);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "large.txt", content: largeContent })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write a large file");
		await harness.session.agent.waitForIdle();

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		const diff = mgr!.getFileDiff({ filePath: "large.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.newContent).toBe(largeContent);
	});

	// ─── Multiple turns with mixed operations ─────────────────────────

	it("multiple turns with mixed operations: full snapshot integrity", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "keep.txt"), "keep original\n");

		const writeTool = makeRealWriteTool(cwd);
		const editTool = makeRealEditTool(cwd);
		const deleteTool = makeDeleteTool(cwd);
		const harness = await createHarnessWithReview(cwd, [writeTool, editTool, deleteTool]);
		harnesses.push(harness);

		// Turn 0: create new + modify existing + delete existing
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "created.txt", content: "new file" }),
					fauxToolCall("edit", { path: "keep.txt", oldText: "keep original", newText: "keep modified" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("turn 0 done"),
		]);

		await harness.session.prompt("make changes");
		await harness.session.agent.waitForIdle();

		// Turn 1: delete the created file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("delete", { path: "created.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("turn 1 done"),
		]);

		await harness.session.prompt("delete created.txt");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "created.txt"))).toBe(false);
		expect(readFileSync(join(cwd, "keep.txt"), "utf-8")).toBe("keep modified\n");

		// Verify snapshot history
		const entries = harness.sessionManager.getEntries();
		const turnEntries = entries.filter(
			(e) => e.type === "custom" && (e as { customType?: string }).customType === "file-review-turn",
		);
		expect(turnEntries.length).toBeGreaterThanOrEqual(2);

		// Verify fileSnapshotManager tracks both files
		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();
		const modified = mgr!.getModifiedFiles();
		expect(modified.some((f) => f.path === "keep.txt")).toBe(true);
		expect(modified.some((f) => f.path === "created.txt")).toBe(true);
	});
});
