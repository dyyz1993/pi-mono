/**
 * End-to-end tests for: bash tool executes `rm` → file-review extension collects the deletion.
 *
 * Full chain verified:
 * 1. file-review extension loaded via extensionFactories (session_start fires)
 * 2. Agent calls bash tool with `rm file.txt` (real tool execution)
 * 3. tool_result event fires → file-review captures live changes
 * 4. turn_end event fires → file-review records to turnLog + fileSnapshotManager.onTurnEnd
 * 5. Verify the deletion is visible in fileSnapshotManager live changes and snapshot history
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import fileReviewFactory from "../../extensions/file-review/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-rm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create a bash tool that executes real shell commands in the given cwd.
 * This exercises the same tool dispatch pipeline as production —
 * tool_call → execute → tool_result → turn_end events all fire,
 * which file-review listens to.
 */
function makeRealBashTool(cwd: string): AgentTool {
	return {
		name: "bash",
		label: "Bash",
		description: "Execute a bash command",
		parameters: Type.Object({
			command: Type.String(),
			description: Type.Optional(Type.String()),
		}),
		execute: async (_id, params) => {
			const { command } = params as { command: string };
			try {
				const output = execSync(command, { cwd, encoding: "utf-8", timeout: 5000 });
				return { content: [{ type: "text", text: output }], details: { exitCode: 0 } };
			} catch (err) {
				return {
					content: [{ type: "text", text: String(err) }],
					details: { exitCode: 1 },
					isError: true,
				};
			}
		},
	};
}

describe("bash rm → file-review collection end-to-end", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	/**
	 * Create a harness with file-review extension + real bash tool.
	 *
	 * IMPORTANT: Files that should appear in the snapshot baseline must be
	 * written to disk BEFORE calling this function, because
	 * fileSnapshotManager.initialize() runs during harness creation and
	 * captures the session-start baseline from the working directory.
	 */
	async function createHarnessWithBash(cwd: string): Promise<Harness> {
		const bashTool = makeRealBashTool(cwd);
		const harness = await createHarness({
			cwd,
			tools: [bashTool],
			extensionFactories: [fileReviewFactory],
		});
		harness.session.setPermissionMode("yolo");
		return harness;
	}

	it("bash tool deletes a file and file-review turn_end captures it as deleted", async () => {
		const cwd = makeTempDir();
		const filePath = join(cwd, "victim.txt");
		writeFileSync(filePath, "important content\n");

		// Create harness AFTER file exists → fileSnapshotManager baseline includes victim.txt
		const harness = await createHarnessWithBash(cwd);
		harnesses.push(harness);

		expect(existsSync(filePath)).toBe(true);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: `rm "${filePath}"` })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("delete the file");
		await harness.session.agent.waitForIdle();

		// File should be gone from disk
		expect(existsSync(filePath)).toBe(false);

		// turn_end event should have fired
		const turnEndEvents = harness.events.filter((e) => e.type === "turn_end");
		expect(turnEndEvents.length).toBeGreaterThan(0);

		// Verify fileSnapshotManager picked up the deletion
		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// getModifiedFiles tracks ALL changes across snapshots (turn_end already fired)
		const modifiedFiles = mgr!.getModifiedFiles();
		const deletedFile = modifiedFiles.find((f) => f.path === "victim.txt");
		expect(deletedFile).toBeDefined();

		// Verify diff: oldContent (from baseline) → null (deleted from disk)
		const diff = mgr!.getFileDiff({ filePath: "victim.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("important content\n");
		expect(diff!.newContent).toBeNull();
	});

	it("bash rm then create new file: file-review shows both deleted and added", async () => {
		const cwd = makeTempDir();
		const oldFile = join(cwd, "old.txt");
		const newFile = join(cwd, "new.txt");
		writeFileSync(oldFile, "old content\n");

		const harness = await createHarnessWithBash(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("bash", { command: `rm "${oldFile}" && echo "new content" > "${newFile}"` })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("replace the file");
		await harness.session.agent.waitForIdle();

		expect(existsSync(oldFile)).toBe(false);
		expect(existsSync(newFile)).toBe(true);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// getModifiedFiles tracks ALL changes across snapshots (not just live diff)
		const modifiedFiles = mgr!.getModifiedFiles();

		const deleted = modifiedFiles.find((f) => f.path === "old.txt");
		expect(deleted).toBeDefined();

		const added = modifiedFiles.find((f) => f.path === "new.txt");
		expect(added).toBeDefined();

		// Verify diffs via getFileDiff
		const deletedDiff = mgr!.getFileDiff({ filePath: "old.txt" });
		expect(deletedDiff).not.toBeNull();
		expect(deletedDiff!.oldContent).toBe("old content\n");
		expect(deletedDiff!.newContent).toBeNull();

		const addedDiff = mgr!.getFileDiff({ filePath: "new.txt" });
		expect(addedDiff).not.toBeNull();
		expect(addedDiff!.oldContent).toBeNull();
		expect(addedDiff!.newContent).toContain("new content");
	});

	it("bash rm multiple files: all deletions captured", async () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "a.txt"), "content a\n");
		writeFileSync(join(cwd, "b.txt"), "content b\n");
		writeFileSync(join(cwd, "c.txt"), "content c\n");

		const harness = await createHarnessWithBash(cwd);
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", {
						command: `rm "${join(cwd, "a.txt")}" "${join(cwd, "b.txt")}" "${join(cwd, "c.txt")}"`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("delete all three files");
		await harness.session.agent.waitForIdle();

		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(existsSync(join(cwd, "b.txt"))).toBe(false);
		expect(existsSync(join(cwd, "c.txt"))).toBe(false);

		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// getModifiedFiles tracks ALL changes across snapshots
		const modifiedFiles = mgr!.getModifiedFiles();
		const modifiedPaths = modifiedFiles.map((f) => f.path);

		expect(modifiedPaths).toContain("a.txt");
		expect(modifiedPaths).toContain("b.txt");
		expect(modifiedPaths).toContain("c.txt");
	});

	it("bash rm then re-prompt: deletion persists in snapshot history", async () => {
		const cwd = makeTempDir();
		const targetFile = join(cwd, "persistent.txt");
		writeFileSync(targetFile, "will be deleted\n");

		const harness = await createHarnessWithBash(cwd);
		harnesses.push(harness);

		// Turn 1: delete the file
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: `rm "${targetFile}"` })], { stopReason: "toolUse" }),
			fauxAssistantMessage("deleted"),
		]);

		await harness.session.prompt("delete the file");
		await harness.session.agent.waitForIdle();

		// Turn 2: just chat (no file changes)
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("what happened?");
		await harness.session.agent.waitForIdle();

		// The snapshot from turn 1 should still have the deletion recorded
		const mgr = harness.session.fileSnapshotManager;
		expect(mgr).not.toBeNull();

		// Check modified files includes the deletion
		const modifiedFiles = mgr!.getModifiedFiles();
		const deletedFile = modifiedFiles.find((f) => f.path === "persistent.txt");
		expect(deletedFile).toBeDefined();

		// Verify diff shows old content → null
		const diff = mgr!.getFileDiff({ filePath: "persistent.txt" });
		expect(diff).not.toBeNull();
		expect(diff!.oldContent).toBe("will be deleted\n");
		expect(diff!.newContent).toBeNull();
	});
});
