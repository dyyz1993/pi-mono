import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";

describe("SessionManager removeEntry", () => {
	it("removes a deletion entry and restores visibility", () => {
		const session = SessionManager.inMemory();

		const msg1Id = session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});

		const deletionId = session.appendDeletion([msg1Id]);

		let ctx = session.buildSessionContext();
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages[0].role).toBe("assistant");

		const removed = session.removeEntry(deletionId);
		expect(removed).toBe(true);

		ctx = session.buildSessionContext();
		expect(ctx.messages).toHaveLength(2);
		expect(ctx.messages[0].role).toBe("user");
		expect(ctx.messages[1].role).toBe("assistant");
	});

	it("removes a segment summary entry", () => {
		const session = SessionManager.inMemory();

		const msg1Id = session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		const msg2Id = session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});

		const segmentId = session.appendSegmentSummary([msg1Id, msg2Id], "Compressed summary");

		let ctx = session.buildSessionContext();
		expect(ctx.messages).toHaveLength(1);
		expect((ctx.messages[0] as any).role).toBe("segmentSummary");

		const removed = session.removeEntry(segmentId);
		expect(removed).toBe(true);

		ctx = session.buildSessionContext();
		expect(ctx.messages).toHaveLength(2);
		expect(ctx.messages[0].role).toBe("user");
		expect(ctx.messages[1].role).toBe("assistant");
	});

	it("returns false when entry does not exist", () => {
		const session = SessionManager.inMemory();
		const removed = session.removeEntry("non-existent-id");
		expect(removed).toBe(false);
	});

	it("removes deletion entry from getEntries", () => {
		const session = SessionManager.inMemory();

		const msgId = session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		const deletionId = session.appendDeletion([msgId]);

		let entries = session.getEntries();
		expect(entries.some((e) => e.id === deletionId)).toBe(true);

		session.removeEntry(deletionId);

		entries = session.getEntries();
		expect(entries.some((e) => e.id === deletionId)).toBe(false);
	});

	it("removes segment summary entry from getEntries", () => {
		const session = SessionManager.inMemory();

		const msgId = session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		const segmentId = session.appendSegmentSummary([msgId], "Summary");

		let entries = session.getEntries();
		expect(entries.some((e) => e.id === segmentId)).toBe(true);

		session.removeEntry(segmentId);

		entries = session.getEntries();
		expect(entries.some((e) => e.id === segmentId)).toBe(false);
	});
});
