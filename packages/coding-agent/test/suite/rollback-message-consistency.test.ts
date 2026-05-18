import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	leafId: string | null,
	entryId: string,
): boolean {
	if (!leafId) return false;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = leafId;
	while (current !== null) {
		if (current === entryId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}

function getEntryIdsOnPath(
	entries: Array<{ id: string; parentId: string | null }>,
	leafId: string | null,
): Set<string> {
	const result = new Set<string>();
	if (!leafId) return result;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = leafId;
	while (current !== null) {
		result.add(current);
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return result;
}

describe("rollback message consistency", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("rollback removes later messages from session.messages", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Turn 1: U1 → A1
		harness.setResponses([fauxAssistantMessage("A1 response")]);
		await harness.session.prompt("U1 message");
		const afterA1 = harness.sessionManager.getLeafId()!;
		expect(afterA1).toBeDefined();

		// Turn 2: U2 → A2
		harness.setResponses([fauxAssistantMessage("A2 response")]);
		await harness.session.prompt("U2 message");

		// Verify 4 messages before rollback
		expect(harness.session.messages.length).toBe(4);

		// Roll back to after A1
		await harness.session.navigateTree(afterA1, { summarize: false });

		// session.messages should only contain U1 + A1 (the leaf path)
		const msgs = harness.session.messages;
		const userTexts = msgs
			.filter((m) => m.role === "user")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return Array.isArray(c)
					? c
							.filter((p): p is { type: "text"; text: string } => p.type === "text")
							.map((p) => p.text)
							.join("")
					: "";
			});
		const assistantTexts = msgs
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return Array.isArray(c)
					? c
							.filter((p): p is { type: "text"; text: string } => p.type === "text")
							.map((p) => p.text)
							.join("")
					: "";
			});

		expect(userTexts).toEqual(["U1 message"]);
		expect(assistantTexts).toEqual(["A1 response"]);
		expect(msgs.length).toBe(2);
	});

	it("getEntries still returns all persisted entries after rollback", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Turn 1: U1 → A1
		harness.setResponses([fauxAssistantMessage("A1 response")]);
		await harness.session.prompt("U1 message");
		const afterA1 = harness.sessionManager.getLeafId()!;

		// Turn 2: U2 → A2
		harness.setResponses([fauxAssistantMessage("A2 response")]);
		await harness.session.prompt("U2 message");

		// All 4 entries before rollback
		const allBefore = harness.sessionManager.getEntries();
		const msgEntriesBefore = allBefore.filter((e) => e.type === "message");
		expect(msgEntriesBefore.length).toBe(4);

		// Roll back to after A1
		await harness.session.navigateTree(afterA1, { summarize: false });

		// getEntries still returns ALL 4 persisted entries
		const allAfter = harness.sessionManager.getEntries();
		const msgEntriesAfter = allAfter.filter((e) => e.type === "message");
		expect(msgEntriesAfter.length).toBe(4);

		// Verify leafId is correct
		const leafId = harness.sessionManager.getLeafId();
		expect(leafId).toBe(afterA1);

		// Verify tree structure: only U1 and A1 are on the leaf path
		const pathIds = getEntryIdsOnPath(allAfter, leafId);
		const u1Entry = msgEntriesAfter.find((e) => e.type === "message" && (e as any).message?.role === "user")!;
		const a1Entry = msgEntriesAfter.filter(
			(e) => e.type === "message" && (e as any).message?.role === "assistant",
		)[0]!;
		const u2Entry = msgEntriesAfter.filter((e) => e.type === "message" && (e as any).message?.role === "user")[1]!;
		const a2Entry = msgEntriesAfter.filter(
			(e) => e.type === "message" && (e as any).message?.role === "assistant",
		)[1]!;

		expect(pathIds.has(u1Entry.id)).toBe(true);
		expect(pathIds.has(a1Entry.id)).toBe(true);
		expect(pathIds.has(u2Entry.id)).toBe(false);
		expect(pathIds.has(a2Entry.id)).toBe(false);
	});

	it("session.messages equals buildSessionContext after rollback", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Turn 1: U1 → A1
		harness.setResponses([fauxAssistantMessage("first reply")]);
		await harness.session.prompt("first prompt");
		const afterA1 = harness.sessionManager.getLeafId()!;

		// Turn 2: U2 → A2
		harness.setResponses([fauxAssistantMessage("second reply")]);
		await harness.session.prompt("second prompt");

		// Roll back to after A1
		await harness.session.navigateTree(afterA1, { summarize: false });

		// session.messages should equal buildSessionContext().messages
		const sessionMessages = harness.session.messages;
		const contextMessages = harness.sessionManager.buildSessionContext().messages;
		expect(sessionMessages.length).toBe(contextMessages.length);
		expect(sessionMessages).toEqual(contextMessages);
		expect(sessionMessages.length).toBe(2);
	});
});
