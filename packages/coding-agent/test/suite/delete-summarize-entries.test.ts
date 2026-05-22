import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.js";
import { createHarness, type Harness } from "./harness.js";

function getUserTexts(
	messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
): string[] {
	return messages
		.filter((m) => m.role === "user")
		.map((m) => {
			if (typeof m.content === "string") return m.content;
			return m.content
				.filter((p): p is { type: string; text: string } => p.type === "text")
				.map((p) => p.text)
				.join("");
		});
}

describe("deleteEntries and summarizeEntries", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("SessionManager.appendDeletion", () => {
		it("creates a deletion entry with the correct type and targetIds", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "hello" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "world" }],
				timestamp: Date.now(),
			});

			const deletionId = harness.sessionManager.appendDeletion([entryId1, entryId2]);

			const entries = harness.sessionManager.getEntries();
			const deletionEntry = entries.find((e) => e.id === deletionId);
			expect(deletionEntry).toBeDefined();
			expect(deletionEntry!.type).toBe("deletion");
			expect((deletionEntry as any).targetIds).toEqual([entryId1, entryId2]);
		});

		it("excludes deleted entries from buildSessionContext", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "keep this" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "delete this" }],
				timestamp: Date.now(),
			});

			harness.sessionManager.appendDeletion([entryId2]);

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).toContain("keep this");
			expect(texts).not.toContain("delete this");
		});

		it("cascades deletion to tool results whose toolCall belongs to a deleted assistant message", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "prompt" }],
				timestamp: Date.now(),
			});
			const assistantEntryId = harness.sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "toolCall", id: "tc-1", name: "bash", input: { command: "ls" } }],
				stopReason: "toolUse",
				timestamp: Date.now(),
			} as any);
			harness.sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: "tc-1",
				content: [{ type: "text", text: "file1.ts\nfile2.ts" }],
				timestamp: Date.now(),
			} as any);

			harness.sessionManager.appendDeletion([assistantEntryId]);

			const ctx = harness.sessionManager.buildSessionContext();
			expect(ctx.messages.some((m) => m.role === "assistant")).toBe(false);
			expect(ctx.messages.some((m) => m.role === "toolResult")).toBe(false);
		});
	});

	describe("SessionManager.appendSegmentSummary", () => {
		it("creates a segment_summary entry with correct type, targetIds, and summary", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg one" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg two" }],
				timestamp: Date.now(),
			});

			const summaryId = harness.sessionManager.appendSegmentSummary([entryId1, entryId2], "summarized content");

			const entries = harness.sessionManager.getEntries();
			const summaryEntry = entries.find((e) => e.id === summaryId);
			expect(summaryEntry).toBeDefined();
			expect(summaryEntry!.type).toBe("segment_summary");
			expect((summaryEntry as any).targetIds).toEqual([entryId1, entryId2]);
			expect((summaryEntry as any).summary).toBe("summarized content");
		});

		it("replaces target entries with a single segmentSummary message in buildSessionContext", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg one" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg two" }],
				timestamp: Date.now(),
			});

			harness.sessionManager.appendSegmentSummary([entryId1, entryId2], "combined summary");

			const ctx = harness.sessionManager.buildSessionContext();
			const userTexts = getUserTexts(ctx.messages);
			expect(userTexts).not.toContain("msg one");
			expect(userTexts).not.toContain("msg two");

			const segmentMsgs = ctx.messages.filter((m) => m.role === "segmentSummary");
			expect(segmentMsgs).toHaveLength(1);
			expect((segmentMsgs[0] as any).summary).toBe("combined summary");
		});
	});

	describe("Extension API: deleteEntries", () => {
		it("extension calls pi.deleteEntries and message is excluded from context", async () => {
			let capturedInvalidation: {
				invalidatedEntryIds: string[];
				reason: string;
				operationEntryId: string;
			} | null = null;

			const harness = await createHarness({
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("agent_end", async (_event, ctx) => {
							const entries = ctx.sessionManager.getEntries();
							const messageEntries = entries.filter(
								(e) => e.type === "message" && (e as any).message?.role === "user",
							);
							if (messageEntries.length >= 2) {
								const targetId = messageEntries[messageEntries.length - 1]!.id;
								pi.deleteEntries([targetId]);
							}
						});
						pi.on("entries_invalidated", async (event) => {
							capturedInvalidation = {
								invalidatedEntryIds: [...event.invalidatedEntryIds],
								reason: event.reason,
								operationEntryId: event.operationEntryId,
							};
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				{ type: "text" as const, text: "first response" },
				{ type: "text" as const, text: "second response" },
			]);

			await harness.session.prompt("keep this");
			await harness.session.prompt("delete this");

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);

			expect(texts).toContain("keep this");
			expect(texts).not.toContain("delete this");

			expect(capturedInvalidation).not.toBeNull();
			expect(capturedInvalidation!.reason).toBe("deletion");
			expect(capturedInvalidation!.invalidatedEntryIds.length).toBeGreaterThan(0);
		});
	});

	describe("Extension API: summarizeEntries", () => {
		it("extension calls pi.summarizeEntries and messages are replaced with summary", async () => {
			const harness = await createHarness({
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("agent_end", async (_event, ctx) => {
							const entries = ctx.sessionManager.getEntries();
							const messageEntries = entries.filter(
								(e) => e.type === "message" && (e as any).message?.role === "user",
							);
							if (messageEntries.length >= 2) {
								const targetIds = messageEntries.slice(0, 2).map((e) => e.id);
								pi.summarizeEntries(targetIds, "summarized by extension");
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				{ type: "text" as const, text: "response one" },
				{ type: "text" as const, text: "response two" },
			]);

			await harness.session.prompt("first message");
			await harness.session.prompt("second message");

			const ctx = harness.sessionManager.buildSessionContext();
			const segmentMsgs = ctx.messages.filter((m) => m.role === "segmentSummary");
			expect(segmentMsgs).toHaveLength(1);
			expect((segmentMsgs[0] as any).summary).toBe("summarized by extension");

			const userTexts = getUserTexts(ctx.messages);
			expect(userTexts).not.toContain("first message");
			expect(userTexts).not.toContain("second message");
		});
	});

	describe("entries_invalidated event", () => {
		it("fires with reason 'deletion' when appendDeletion is called", async () => {
			const invalidatedEvents: Array<{
				invalidatedEntryIds: string[];
				reason: string;
				operationEntryId: string;
			}> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("entries_invalidated", async (event) => {
							invalidatedEvents.push({
								invalidatedEntryIds: [...event.invalidatedEntryIds],
								reason: event.reason,
								operationEntryId: event.operationEntryId,
							});
						});
					},
				],
			});
			harnesses.push(harness);

			const entryId = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "to be deleted" }],
				timestamp: Date.now(),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			harness.sessionManager.appendDeletion([entryId]);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(invalidatedEvents.length).toBeGreaterThanOrEqual(1);
			const deletionEvent = invalidatedEvents.find((e) => e.reason === "deletion");
			expect(deletionEvent).toBeDefined();
			expect(deletionEvent!.invalidatedEntryIds).toContain(entryId);
			expect(deletionEvent!.operationEntryId).toBeTruthy();
		});

		it("fires with reason 'segment_summary' when appendSegmentSummary is called", async () => {
			const invalidatedEvents: Array<{
				invalidatedEntryIds: string[];
				reason: string;
			}> = [];

			const harness = await createHarness({
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("entries_invalidated", async (event) => {
							invalidatedEvents.push({
								invalidatedEntryIds: [...event.invalidatedEntryIds],
								reason: event.reason,
							});
						});
					},
				],
			});
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "one" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "two" }],
				timestamp: Date.now(),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			harness.sessionManager.appendSegmentSummary([entryId1, entryId2], "summary text");

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(invalidatedEvents.length).toBeGreaterThanOrEqual(1);
			const summaryEvent = invalidatedEvents.find((e) => e.reason === "segment_summary");
			expect(summaryEvent).toBeDefined();
			expect(summaryEvent!.invalidatedEntryIds).toContain(entryId1);
			expect(summaryEvent!.invalidatedEntryIds).toContain(entryId2);
		});
	});

	describe("buildSessionContext: combined operations", () => {
		it("handles both deletions and segment summaries in the same session", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "keep" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "summarize-me" }],
				timestamp: Date.now(),
			});
			const entryId3 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "delete-me" }],
				timestamp: Date.now(),
			});
			const entryId4 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "also-keep" }],
				timestamp: Date.now(),
			});

			harness.sessionManager.appendDeletion([entryId3]);
			harness.sessionManager.appendSegmentSummary([entryId2], "summarized instead");

			const ctx = harness.sessionManager.buildSessionContext();
			const userTexts = getUserTexts(ctx.messages);

			expect(userTexts).toContain("keep");
			expect(userTexts).toContain("also-keep");
			expect(userTexts).not.toContain("summarize-me");
			expect(userTexts).not.toContain("delete-me");

			const segmentMsgs = ctx.messages.filter((m) => m.role === "segmentSummary");
			expect(segmentMsgs).toHaveLength(1);
			expect((segmentMsgs[0] as any).summary).toBe("summarized instead");
		});

		it("deletion of already-summarized entries suppresses the segment summary", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg" }],
				timestamp: Date.now(),
			});

			harness.sessionManager.appendSegmentSummary([entryId1], "summary-1");
			harness.sessionManager.appendDeletion([entryId1]);

			const ctx = harness.sessionManager.buildSessionContext();
			expect(ctx.messages.filter((m) => m.role === "user")).toHaveLength(0);
			expect(ctx.messages.filter((m) => m.role === "segmentSummary")).toHaveLength(0);
		});
	});

	describe("edge cases and boundary conditions", () => {
		it("should handle appendDeletion with empty targetIds gracefully", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "keep this" }],
				timestamp: Date.now(),
			});

			// Empty array should not throw
			const deletionId = harness.sessionManager.appendDeletion([]);
			expect(deletionId).toBeTruthy();

			// Context should still contain the message
			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).toContain("keep this");
		});

		it("should handle appendDeletion with non-existent targetIds", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "safe message" }],
				timestamp: Date.now(),
			});

			// Non-existent IDs should not throw, existing messages unaffected
			const deletionId = harness.sessionManager.appendDeletion(["nonexistent-id-1", "nonexistent-id-2"]);
			expect(deletionId).toBeTruthy();

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).toContain("safe message");
		});

		it("should handle appendSegmentSummary with empty targetIds gracefully", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const summaryId = harness.sessionManager.appendSegmentSummary([], "empty summary");
			expect(summaryId).toBeTruthy();

			const ctx = harness.sessionManager.buildSessionContext();
			expect(ctx.messages.filter((m) => m.role === "segmentSummary")).toHaveLength(0);
		});

		it("should handle duplicate deletion of the same targetId", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "target" }],
				timestamp: Date.now(),
			});

			// Delete twice
			harness.sessionManager.appendDeletion([entryId]);
			harness.sessionManager.appendDeletion([entryId]);

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).not.toContain("target");
		});

		it("should allow new messages to be appended after deletion", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "old message" }],
				timestamp: Date.now(),
			});

			harness.sessionManager.appendDeletion([entryId1]);

			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "new message" }],
				timestamp: Date.now(),
			});
			expect(entryId2).toBeTruthy();

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).not.toContain("old message");
			expect(texts).toContain("new message");
		});

		it("should handle segment summary with mixed valid and invalid IDs", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "valid message" }],
				timestamp: Date.now(),
			});

			// One valid ID + one non-existent ID
			harness.sessionManager.appendSegmentSummary([entryId1, "nonexistent-id"], "mixed summary");

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			// Valid ID should be replaced
			expect(texts).not.toContain("valid message");
			// Summary should still be emitted
			const segmentMsgs = ctx.messages.filter((m) => m.role === "segmentSummary");
			expect(segmentMsgs).toHaveLength(1);
			expect((segmentMsgs[0] as any).summary).toBe("mixed summary");
		});

		it("should preserve non-target messages when deleting multiple targets", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const entryId1 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg A" }],
				timestamp: Date.now(),
			});
			const entryId2 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg B" }],
				timestamp: Date.now(),
			});
			const entryId3 = harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: "msg C" }],
				timestamp: Date.now(),
			});

			// Delete A and C, keep B
			harness.sessionManager.appendDeletion([entryId1, entryId3]);

			const ctx = harness.sessionManager.buildSessionContext();
			const texts = getUserTexts(ctx.messages);
			expect(texts).not.toContain("msg A");
			expect(texts).toContain("msg B");
			expect(texts).not.toContain("msg C");
		});
	});
});
