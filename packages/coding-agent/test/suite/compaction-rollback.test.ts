/**
 * Tests for compaction + rollback (tree navigation) interaction.
 *
 * These tests verify:
 * - Compaction entry appears in the tree correctly
 * - Rolling back past a compaction excludes the compaction summary from context
 * - Rolling back to a point before compaction, then appending, creates a new branch
 * - Data extraction (buildSessionContext, getBranch, getEntries) is correct after compaction + rollback
 * - Compaction followed by rollback preserves original messages in the old branch
 */

import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("compaction + rollback interaction", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("compaction entry appears in getBranch and getEntries", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first question and answer", user2Id, 1000);

		const entries = harness.sessionManager.getEntries();
		const compactionEntry = entries.find((e) => e.type === "compaction");
		expect(compactionEntry).toBeDefined();
		expect((compactionEntry as any).summary).toBe("Summary of first question and answer");
		expect((compactionEntry as any).firstKeptEntryId).toBe(user2Id);

		// getBranch should include compaction + kept messages
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(true);
	});

	it("rolling back to user message clears agent state and excludes compaction from context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		// Compact
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Before rollback: compaction summary is in context
		const contextBefore = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(contextBefore.messages)).toContain("Summary of first Q&A");

		// Rollback to user1 (navigateTree to user message sets leafId = null)
		const result = await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });
		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBe("first question");

		// After rollback: leafId is null, agent messages are empty
		expect(harness.sessionManager.getLeafId()).toBeNull();
		expect(harness.session.messages).toEqual([]);
	});

	it("appending after rollback creates new branch independent of compaction", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to user1
		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		// Append new messages on the new branch
		const newUserMsgId = harness.sessionManager.appendMessage(userMsg("different question"));
		const newAssistantId = harness.sessionManager.appendMessage(assistantMsg("different answer"));

		// New branch should not contain compaction
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(false);
		expect(branch[0].id).toBe(newUserMsgId);
		expect(branch[1].id).toBe(newAssistantId);

		// Old entries still exist in the tree
		const allEntries = harness.sessionManager.getEntries();
		expect(allEntries.some((e) => e.type === "compaction")).toBe(true);
	});

	it("buildSessionContext after rollback to assistant message preserves path", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		const assistant1Id = harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		// Compact
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to assistant1 (non-user message keeps the path)
		await harness.session.navigateTree(assistant1Id, { summarize: false });

		// Branch should be: user1 -> assistant1 (no compaction)
		const branch = harness.sessionManager.getBranch();
		expect(branch.length).toBe(2);
		expect(branch[0].id).toBe(user1Id);
		expect(branch[1].id).toBe(assistant1Id);
		expect(branch.some((e) => e.type === "compaction")).toBe(false);

		// Context should not contain compaction summary
		const context = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(context.messages)).not.toContain("Summary of first Q&A");
	});

	it("compaction then rollback then re-prompt works correctly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to user1
		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		// Set up response for re-prompt
		harness.setResponses([fauxAssistantMessage("new answer")]);

		// Re-prompt from the rollback point
		await harness.session.prompt("modified question");
		await harness.session.agent.waitForIdle();

		// Verify the new conversation has no compaction
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(false);
	});

	it("multiple compactions on same branch, last one appears in context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));
		const user3Id = harness.sessionManager.appendMessage(userMsg("third question"));
		harness.sessionManager.appendMessage(assistantMsg("third answer"));

		// First compaction
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 3000);
		// Second compaction
		harness.sessionManager.appendCompaction("Summary of second Q&A", user3Id, 2000);

		const entries = harness.sessionManager.getEntries();
		expect(entries.filter((e) => e.type === "compaction").length).toBe(2);

		// Context includes the latest compaction summary
		const context = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(context.messages)).toContain("Summary of second Q&A");
	});

	it("rollback to compaction entry preserves compaction summary in context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		const compactId = harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Append more after compaction
		harness.sessionManager.appendMessage(userMsg("third question"));
		harness.sessionManager.appendMessage(assistantMsg("third answer"));

		// Rollback to compaction entry itself
		await harness.session.navigateTree(compactId, { summarize: false });

		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(true);

		const context = harness.sessionManager.buildSessionContext();
		const contextText = JSON.stringify(context.messages);
		expect(contextText).toContain("Summary of first Q&A");
		// Should NOT include third Q&A (that's after compaction in a different branch)
		expect(contextText).not.toContain("third question");
	});
});
