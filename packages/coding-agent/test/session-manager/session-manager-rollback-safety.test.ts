/**
 * TDD tests for rollback safety: leaf resolution + message preservation.
 *
 * Bug: _buildIndex() blindly uses the last JSONL entry as leaf.
 * Side-branch entries (e.g., LSP custom) appended after the main chain
 * steal the leaf on reload, making the entire conversation invisible.
 *
 * Fix: _buildIndex() now picks the deepest terminal node as leaf.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";

let counter = 0;
function createTempDir(): string {
	const dir = join(tmpdir(), `sm-rollback-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeEntriesToFile(sessionFile: string, entries: ReturnType<SessionManager["getEntries"]>): void {
	for (const e of entries) {
		writeFileSync(sessionFile, JSON.stringify(e) + "\n", { flag: "a" });
	}
}

function countUserMessagesOnBranch(sm: SessionManager): number {
	const branch = sm.getBranch();
	return branch.filter((e: any) => e.type === "message" && e.message?.role === "user").length;
}

describe("SessionManager rollback safety", () => {
	let tempDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
		sessionDir = createTempDir();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	});

	// ========================================================================
	// _buildIndex() leaf resolution
	// ========================================================================

	describe("_buildIndex() leaf resolution", () => {
		it("picks the deepest terminal as leaf when side branch is appended last", () => {
			// Create a persisted session so entries are written to file
			const sessionFile = join(sessionDir, "test.jsonl");
			const sm = SessionManager.open(sessionFile, sessionDir, tempDir);

			// Build main conversation: user0 → assistant0 → user1 → assistant1
			const user0 = sm.appendMessage({ role: "user", content: "hi" });
			const asst0 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
			});
			const user1 = sm.appendMessage({ role: "user", content: "how are you" });
			const asst1 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "fine" }],
			});

			const mainLeaf = asst1;
			expect(sm.getLeafId()).toBe(mainLeaf);

			// Simulate: navigateTree moved leaf to user0, then extension appended side entry
			sm["leafId"] = user0;
			const sideEntry = sm.appendCustomEntry("lsp", { action: "diagnostics" });
			expect(sm.getLeafId()).toBe(sideEntry);

			// Side entry is at depth 2 (root→user0→sideEntry)
			// Main leaf is at depth 5 (root→user0→asst0→user1→asst1)

			// Reload from file
			const sm2 = SessionManager.open(sessionFile, sessionDir, tempDir);

			// After reload: deepest terminal should win (asst1, depth 5)
			// NOT the side branch (depth 2) even though it was appended last
			expect(sm2.getLeafId()).toBe(mainLeaf);
			expect(countUserMessagesOnBranch(sm2)).toBe(2);
		});

		it("still picks last entry when only one chain exists", () => {
			const sessionFile = join(sessionDir, "single.jsonl");
			const sm = SessionManager.open(sessionFile, sessionDir, tempDir);

			const u0 = sm.appendMessage({ role: "user", content: "a" });
			const a0 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "b" }],
			});
			const u1 = sm.appendMessage({ role: "user", content: "c" });

			expect(sm.getLeafId()).toBe(u1);

			const sm2 = SessionManager.open(sessionFile, sessionDir, tempDir);
			expect(sm2.getLeafId()).toBe(u1);
		});

		it("picks the deeper branch when two branches diverge", () => {
			const sessionFile = join(sessionDir, "branch.jsonl");
			const sm = SessionManager.open(sessionFile, sessionDir, tempDir);

			// Build: user0 → assistant0 → user1
			const user0 = sm.appendMessage({ role: "user", content: "first" });
			const asst0 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "reply0" }],
			});
			const user1 = sm.appendMessage({ role: "user", content: "second" });

			// Branch from asst0: alternate deeper path
			sm["leafId"] = asst0;
			const altUser1 = sm.appendMessage({ role: "user", content: "alt-second" });
			const altAsst1 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "alt-reply" }],
			});
			const altUser2 = sm.appendMessage({ role: "user", content: "alt-third" });

			// altUser2 is at depth 5 (root→user0→asst0→altUser1→altAsst1→altUser2)
			// user1 is at depth 3 (root→user0→asst0→user1)
			// Both are terminals; altUser2 is deeper

			const sm2 = SessionManager.open(sessionFile, sessionDir, tempDir);
			expect(sm2.getLeafId()).toBe(altUser2);
			expect(countUserMessagesOnBranch(sm2)).toBe(3);
		});

		it("recovers main conversation after rollback + side-branch append + reload", () => {
			const sessionFile = join(sessionDir, "recovery.jsonl");
			const sm = SessionManager.open(sessionFile, sessionDir, tempDir);

			// Build 5-turn conversation
			const ids: string[] = [];
			for (let i = 0; i < 5; i++) {
				ids.push(sm.appendMessage({ role: "user", content: `turn ${i}` }));
				ids.push(
					sm.appendMessage({
						role: "assistant",
						content: [{ type: "text", text: `reply ${i}` }],
					}),
				);
			}
			const mainLeaf = ids[ids.length - 1];

			// Simulate rollback: leaf moved to first user message
			sm["leafId"] = ids[0];
			// Then extension appends side entry
			sm.appendCustomEntry("lsp", { action: "diagnostics" });

			// Reload
			const sm2 = SessionManager.open(sessionFile, sessionDir, tempDir);
			expect(sm2.getLeafId()).toBe(mainLeaf);
			expect(countUserMessagesOnBranch(sm2)).toBe(5);
		});
	});

	// ========================================================================
	// countUserMessagesOnPath() — pre-flight check for navigateTree
	// ========================================================================

	describe("countUserMessagesOnPath()", () => {
		it("counts all user messages on the active path", () => {
			const sm = SessionManager.inMemory(tempDir);
			const user0 = sm.appendMessage({ role: "user", content: "a" });
			sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "b" }] });
			const user1 = sm.appendMessage({ role: "user", content: "c" });
			const asst1 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "d" }],
			});

			// Full path: root → user0 → asst0 → user1 → asst1 → 2 user msgs
			expect(sm.countUserMessagesOnPath(asst1)).toBe(2);
			expect(sm.countUserMessagesOnPath(user1)).toBe(2);
			// From user0: only user0 itself
			expect(sm.countUserMessagesOnPath(user0)).toBe(1);
			// null (root): 0 user msgs
			expect(sm.countUserMessagesOnPath(null)).toBe(0);
		});

		it("returns 0 when navigating to root (null) — the dangerous case", () => {
			const sm = SessionManager.inMemory(tempDir);
			const user0 = sm.appendMessage({ role: "user", content: "first" });

			// user0.parentId is null. If navigateTree targets user0, newLeafId = parentId = null
			// countUserMessagesOnPath(null) = 0 → should be REJECTED
			expect(sm.countUserMessagesOnPath(null)).toBe(0);

			// The first user message's parentId should be null
			const entry = sm.getEntry(user0);
			expect(entry?.parentId).toBeNull();
		});

		it("returns >0 for normal rollback targets (safe navigation)", () => {
			const sm = SessionManager.inMemory(tempDir);
			sm.appendMessage({ role: "user", content: "a" });
			const asst0 = sm.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "b" }],
			});
			sm.appendMessage({ role: "user", content: "c" });

			// Rolling back to asst0 keeps user0 visible → 1 user msg → safe
			expect(sm.countUserMessagesOnPath(asst0)).toBe(1);
		});
	});
});
