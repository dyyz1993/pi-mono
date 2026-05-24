import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("navigateTree role-based behavior: double-hop verification", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doTurn(h: Harness, prompt: string) {
		h.setResponses([fauxAssistantMessage(`response to ${prompt}`)]);
		await h.session.prompt(prompt);
	}

	it("step 3: navigateTree(assistant leaf) is no-op — else branch keeps leaf at targetId", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doTurn(h, "turn1");
		await doTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const msg = leafEntry as unknown as { message?: { role: string } };
		expect(msg.message?.role).toBe("assistant");

		const totalBefore = h.session.messages.length;
		const result = await h.session.navigateTree(leafId, { summarize: false });

		expect(result.cancelled).toBe(false);
		expect(h.sessionManager.getLeafId()).toBe(leafId);
		expect(h.session.messages.length).toBe(totalBefore);
	});

	it("step 5: navigateTree(user entry) jumps to parentId — double-hop confirmed", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doTurn(h, "turn1");
		await doTurn(h, "turn2");

		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");

		console.log("\n=== Entry structure ===");
		for (const e of messageEntries) {
			const m = e as unknown as { message?: { role: string } };
			console.log(
				`  id=${e.id.slice(0, 8)}  role=${m.message?.role}  parentId=${e.parentId?.slice(0, 8) ?? "null"}`,
			);
		}

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const parentId = leafEntry.parentId!;
		const parentEntry = h.sessionManager.getEntry(parentId)!;
		const parentMsg = parentEntry as unknown as { message?: { role: string } };

		console.log(`\nleaf (e4): id=${leafId.slice(0, 8)}, parentId=${parentId?.slice(0, 8)}`);
		console.log(`parent (e3): id=${parentId.slice(0, 8)}, role=${parentMsg.message?.role}`);
		console.log(`parent.parentId (e2): ${parentEntry.parentId?.slice(0, 8) ?? "null"}`);

		expect(parentMsg.message?.role).toBe("user");

		const messagesBeforeRollback = h.session.messages.length;

		await h.session.navigateTree(parentId, { summarize: false });

		const messagesAfterRollback = h.session.messages.length;
		const newLeafId = h.sessionManager.getLeafId();

		console.log(
			`\nMessages: before=${messagesBeforeRollback} after=${messagesAfterRollback} lost=${messagesBeforeRollback - messagesAfterRollback}`,
		);
		console.log(`New leafId: ${newLeafId?.slice(0, 8) ?? "null"}`);
		console.log(`Expected leafId (e3): ${parentId.slice(0, 8)}`);
		console.log(`Actual leafId (e2): ${parentEntry.parentId?.slice(0, 8) ?? "null"}`);

		expect(newLeafId).toBe(parentEntry.parentId);
		expect(messagesAfterRollback).toBeLessThan(messagesBeforeRollback);

		const branch = h.sessionManager.getBranch();
		const userMsgsInBranch = branch.filter(
			(e) => e.type === "message" && (e as unknown as { message?: { role: string } }).message?.role === "user",
		);

		console.log(`\nUser messages in branch: ${userMsgsInBranch.length} (expected 2, got ${userMsgsInBranch.length})`);

		const lostUserMsgs =
			messageEntries.filter((e) => (e as unknown as { message?: { role: string } }).message?.role === "user")
				.length - userMsgsInBranch.length;

		console.log(`Lost user messages due to double-hop: ${lostUserMsgs}`);
	});

	it("full comparison: navigateTree(e3) loses 1 more user message than expected", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doTurn(h, "turn1");
		await doTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const e3Id = leafEntry.parentId!;
		const e3Entry = h.sessionManager.getEntry(e3Id)!;

		const e2Id = e3Entry.parentId!;

		const userMsgsTotal = h.session.messages.filter((m) => m.role === "user").length;

		await h.session.navigateTree(e3Id, { summarize: false });

		const userMsgsAfter = h.session.messages.filter((m) => m.role === "user").length;
		const newLeafId = h.sessionManager.getLeafId();

		console.log(`\n=== Double-hop analysis ===`);
		console.log(`User messages: total=${userMsgsTotal}, after=${userMsgsAfter}`);
		console.log(`Expected: ${userMsgsTotal} user msgs (only assistant removed)`);
		console.log(`Actual: ${userMsgsAfter} user msgs (user msg e3 also removed)`);
		console.log(
			`newLeafId = ${newLeafId?.slice(0, 8) ?? "null"} (expected e3=${e3Id.slice(0, 8)}, got e2=${e2Id?.slice(0, 8) ?? "null"})`,
		);

		expect(userMsgsAfter).toBe(userMsgsTotal - 1);
		expect(newLeafId).toBe(e2Id);

		console.log(`\nCONFIRMED: navigateTree(e3) where e3 is user → newLeafId = e3.parentId = e2`);
		console.log(`This is a double-hop: frontend already went from e4→e3, backend goes e3→e2`);
		console.log(`Fix options:`);
		console.log(`  A. Frontend passes assistant entryId directly, backend else branch does parentId`);
		console.log(`  B. Frontend passes parentId, backend removes the user-role parentId hop`);
		console.log(`  C. Frontend passes assistant entryId, backend treats assistant same as user (parentId)`);
	});

	it("proposal C verification: if backend else branch used parentId, navigateTree(e4) would give correct result", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doTurn(h, "turn1");
		await doTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const leafMsg = leafEntry as unknown as { message?: { role: string } };

		console.log(`\n=== Proposal C analysis ===`);
		console.log(
			`e4 (leaf): id=${leafId.slice(0, 8)}, role=${leafMsg.message?.role}, parentId=${leafEntry.parentId?.slice(0, 8) ?? "null"}`,
		);

		if (leafEntry.parentId) {
			const parentId = leafEntry.parentId;
			const parentEntry = h.sessionManager.getEntry(parentId)!;
			const parentMsg = parentEntry as unknown as { message?: { role: string } };
			console.log(`e3 (parent): id=${parentId.slice(0, 8)}, role=${parentMsg.message?.role}`);

			const currentBehavior = "newLeafId = targetId (no change)";
			const proposedBehavior = "newLeafId = targetEntry.parentId (e3)";
			console.log(`\nCurrent backend behavior (else branch): ${currentBehavior}`);
			console.log(`Proposed backend behavior: ${proposedBehavior}`);
			console.log(`\nWith proposed change:`);
			console.log(`  Frontend: findTurnBoundary(e4) → just pass e4 directly`);
			console.log(`  Backend: navigateTree(e4), assistant → newLeafId = e4.parentId = e3`);
			console.log(`  Result: e1, e2, e3 in path (e3 = last user message preserved)`);
			console.log(`  User can re-send from e3 or edit e3`);

			const userMsgsBefore = h.session.messages.filter((m) => m.role === "user").length;

			await h.session.navigateTree(parentId, { summarize: false });

			const userMsgsAfterCurrent = h.session.messages.filter((m) => m.role === "user").length;
			console.log(`\nCurrent approach (frontend passes e3): user msgs ${userMsgsBefore} → ${userMsgsAfterCurrent}`);
			console.log(
				`Proposed approach (frontend passes e4, backend does parentId): user msgs would stay ${userMsgsBefore}`,
			);
		}
	});
});
