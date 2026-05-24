import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("entry chain structure per turn", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("simple turn (no tool calls): user + assistant = 2 entries", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([fauxAssistantMessage("hello")]);
		await h.session.prompt("hi");

		const entries = h.sessionManager.getEntries();
		expect(entries.length).toBe(2);

		const e1 = entries[0];
		const e2 = entries[1];

		expect(e1.type).toBe("message");
		expect((e1 as any).message.role).toBe("user");
		expect(e1.parentId).toBeNull();

		expect(e2.type).toBe("message");
		expect((e2 as any).message.role).toBe("assistant");
		expect(e2.parentId).toBe(e1.id);

		expect(h.sessionManager.getLeafId()).toBe(e2.id);

		console.log("\n=== Simple turn (no tools) ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}
	});

	it("turn with 1 tool call: user → assistant(toolCall) → toolResult → assistant(text) = 4 entries", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt("write a file");

		const entries = h.sessionManager.getEntries();
		expect(entries.length).toBe(4);

		const [e1, e2, e3, e4] = entries;

		expect(e1.type).toBe("message");
		expect((e1 as any).message.role).toBe("user");
		expect(e1.parentId).toBeNull();

		expect(e2.type).toBe("message");
		expect((e2 as any).message.role).toBe("assistant");
		expect(e2.parentId).toBe(e1.id);

		expect(e3.type).toBe("message");
		expect((e3 as any).message.role).toBe("toolResult");
		expect(e3.parentId).toBe(e2.id);

		expect(e4.type).toBe("message");
		expect((e4 as any).message.role).toBe("assistant");
		expect(e4.parentId).toBe(e3.id);

		expect(h.sessionManager.getLeafId()).toBe(e4.id);

		console.log("\n=== Turn with 1 tool call ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}
	});

	it("turn with 2 tool calls: user → assistant(2 toolCalls) → toolResult1 → toolResult2 → assistant(text) = 5 entries", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "a.txt", content: "x" }),
					fauxToolCall("write", { path: "b.txt", content: "y" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt("write two files");

		const entries = h.sessionManager.getEntries();
		expect(entries.length).toBe(5);

		const [e1, e2, e3, e4, e5] = entries;

		expect(e1.type).toBe("message");
		expect((e1 as any).message.role).toBe("user");
		expect(e1.parentId).toBeNull();

		expect(e2.type).toBe("message");
		expect((e2 as any).message.role).toBe("assistant");
		expect(e2.parentId).toBe(e1.id);

		expect(e3.type).toBe("message");
		expect((e3 as any).message.role).toBe("toolResult");
		expect(e3.parentId).toBe(e2.id);

		expect(e4.type).toBe("message");
		expect((e4 as any).message.role).toBe("toolResult");
		expect(e4.parentId).toBe(e3.id);

		expect(e5.type).toBe("message");
		expect((e5 as any).message.role).toBe("assistant");
		expect(e5.parentId).toBe(e4.id);

		expect(h.sessionManager.getLeafId()).toBe(e5.id);

		console.log("\n=== Turn with 2 tool calls ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}
	});

	it("2 turns with tool calls: entries form a continuous parentId chain", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn1 done"),
			fauxAssistantMessage(fauxToolCall("write", { path: "b.txt", content: "2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn2 done"),
		]);
		await h.session.prompt("turn1");
		await h.session.prompt("turn2");

		const entries = h.sessionManager.getEntries();
		expect(entries.length).toBe(8);

		console.log("\n=== 2 turns with tool calls ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}

		expect(entries[0].parentId).toBeNull();
		for (let i = 1; i < entries.length; i++) {
			expect(entries[i].parentId).toBe(entries[i - 1].id);
		}

		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message.role === "user");
		expect(userEntries.length).toBe(2);

		const assistantEntries = entries.filter((e) => e.type === "message" && (e as any).message.role === "assistant");
		expect(assistantEntries.length).toBe(4);

		const toolResultEntries = entries.filter((e) => e.type === "message" && (e as any).message.role === "toolResult");
		expect(toolResultEntries.length).toBe(2);

		const leafId = h.sessionManager.getLeafId();
		expect(leafId).toBe(entries[entries.length - 1].id);
	});

	it("compaction entry: parentId points to last entry before compaction", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn1 done"),
		]);
		await h.session.prompt("turn1");

		const entriesBeforeCompaction = h.sessionManager.getEntries();
		const lastEntryBeforeCompaction = entriesBeforeCompaction[entriesBeforeCompaction.length - 1];
		expect(lastEntryBeforeCompaction.type).toBe("message");
		expect((lastEntryBeforeCompaction as any).message.role).toBe("assistant");

		h.sessionManager.appendCompaction("summary of turn 1", entriesBeforeCompaction[0].id, 1000);

		const entries = h.sessionManager.getEntries();
		const compactionEntry = entries.find((e) => e.type === "compaction");
		expect(compactionEntry).toBeDefined();
		expect(compactionEntry!.parentId).toBe(lastEntryBeforeCompaction.id);

		const leafId = h.sessionManager.getLeafId();
		expect(leafId).toBe(compactionEntry!.id);

		console.log("\n=== After compaction ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}

		expect(entries[0].parentId).toBeNull();
		for (let i = 1; i < entries.length; i++) {
			expect(entries[i].parentId).toBe(entries[i - 1].id);
		}
	});

	it("rollback to user entry: navigateTree uses parentId of user entry", async () => {
		const h = await createHarness();
		harnesses.push(h);

		h.setResponses([
			fauxAssistantMessage("turn1 done"),
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn2 done"),
		]);
		await h.session.prompt("turn1");
		await h.session.prompt("turn2");

		const entries = h.sessionManager.getEntries();
		console.log("\n=== Before rollback ===");
		for (const e of entries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}

		const userEntries = entries.filter((e) => e.type === "message" && (e as any).message.role === "user");
		expect(userEntries.length).toBe(2);

		const turn2UserEntry = userEntries[1];
		console.log(`\nRolling back to turn2 user entry: ${turn2UserEntry.id}`);
		console.log(`  turn2 user entry parentId = ${turn2UserEntry.parentId}`);

		await h.session.navigateTree(turn2UserEntry.id, { summarize: false });

		const leafAfterRollback = h.sessionManager.getLeafId();
		expect(leafAfterRollback).toBe(turn2UserEntry.parentId);

		const branchAfterRollback = h.sessionManager.getBranch();
		const messageEntries = branchAfterRollback.filter((e) => e.type === "message");
		console.log("\n=== After rollback to turn2 user entry ===");
		for (const e of messageEntries) {
			const role = e.type === "message" ? (e as any).message.role : e.type;
			console.log(`  ${e.id} | parentId=${e.parentId} | ${role}`);
		}

		expect(branchAfterRollback.some((e) => e.id === turn2UserEntry.id)).toBe(false);
	});
});
