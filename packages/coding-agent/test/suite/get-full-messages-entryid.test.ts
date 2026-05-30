import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

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

describe("get_full_messages entryId", () => {
	it("persisted messages have entryId", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("A1")]);
		await harness.session.prompt("U1");

		harness.setResponses([fauxAssistantMessage("A2")]);
		await harness.session.prompt("U2");

		const allEntries = harness.sessionManager.getEntries();
		const messageEntries = allEntries.filter((e) => e.type === "message");
		expect(messageEntries.length).toBe(4);

		const persistedMessages = messageEntries.map((e) => ({
			...(e as { message: any }).message,
			entryId: e.id,
		}));

		for (let i = 0; i < messageEntries.length; i++) {
			expect(persistedMessages[i].entryId).toBe(messageEntries[i].id);
			expect(typeof persistedMessages[i].entryId).toBe("string");
			expect(persistedMessages[i].entryId.length).toBeGreaterThan(0);
		}

		const roles = persistedMessages.map((m: any) => m.role);
		expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
	});

	it("entryId survives across fork paths", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("A1")]);
		await harness.session.prompt("U1");
		const turn1Leaf = harness.sessionManager.getLeafId()!;

		harness.setResponses([fauxAssistantMessage("A2a")]);
		await harness.session.prompt("U2a");

		const allBeforeBranch = harness.sessionManager.getEntries();
		const msgEntriesBeforeBranch = allBeforeBranch.filter((e) => e.type === "message");
		expect(msgEntriesBeforeBranch.length).toBe(4);

		await harness.sessionManager.branch(turn1Leaf);
		harness.setResponses([fauxAssistantMessage("A2b")]);
		await harness.session.prompt("U2b");

		const allEntries = harness.sessionManager.getEntries();
		const messageEntries = allEntries.filter((e) => e.type === "message");
		expect(messageEntries.length).toBe(6);

		const leafId = harness.sessionManager.getLeafId();
		const pathIds = getEntryIdsOnPath(allEntries, leafId);

		const onPathMessageEntries = messageEntries.filter((e) => pathIds.has(e.id));
		const offPathMessageEntries = messageEntries.filter((e) => !pathIds.has(e.id));

		expect(onPathMessageEntries.length).toBe(4);

		const onPathMessages = onPathMessageEntries.map((e) => ({
			...(e as { message: any }).message,
			entryId: e.id,
		}));
		const onPathRoles = onPathMessages.map((m: any) => m.role);
		expect(onPathRoles).toEqual(["user", "assistant", "user", "assistant"]);

		const onPathTexts = onPathMessages.map((m: any) => {
			const c = m.content;
			if (typeof c === "string") return c;
			return Array.isArray(c)
				? c
						.filter((p: any) => p.type === "text")
						.map((p: any) => p.text)
						.join("")
				: "";
		});
		expect(onPathTexts).toEqual(["U1", "A1", "U2b", "A2b"]);

		for (const msg of onPathMessages) {
			expect(typeof msg.entryId).toBe("string");
			expect(msg.entryId.length).toBeGreaterThan(0);
		}

		expect(offPathMessageEntries.length).toBe(2);
		for (const entry of offPathMessageEntries) {
			expect(pathIds.has(entry.id)).toBe(false);
		}

		const onPathEntryIds = new Set(onPathMessageEntries.map((e) => e.id));
		const offPathEntryIds = new Set(offPathMessageEntries.map((e) => e.id));
		for (const id of onPathEntryIds) {
			expect(offPathEntryIds.has(id)).toBe(false);
		}
	});

	it("entryId matches tree entries", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("A1")]);
		await harness.session.prompt("U1");

		harness.setResponses([fauxAssistantMessage("A2")]);
		await harness.session.prompt("U2");

		const allEntries = harness.sessionManager.getEntries();
		const messageEntries = allEntries.filter((e) => e.type === "message");

		const treeEntries = allEntries.map((e) => ({
			id: e.id,
			parentId: e.parentId,
			type: e.type,
			label:
				e.type === "message" ? (e as any).message?.role : e.type === "custom" ? (e as any).customType : undefined,
		}));

		const messagesWithEntryId = messageEntries.map((e) => ({
			...(e as { message: any }).message,
			entryId: e.id,
		}));

		const treeEntryIds = new Set(treeEntries.map((te) => te.id));
		for (const msg of messagesWithEntryId) {
			expect(treeEntryIds.has(msg.entryId)).toBe(true);
		}

		for (const msg of messagesWithEntryId) {
			const treeEntry = treeEntries.find((te) => te.id === msg.entryId)!;
			expect(treeEntry.label).toBe(msg.role);
		}
	});
});
