import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";

function userMsg(text: string) {
	return { role: "user" as const, content: text };
}
function assistantMsg(text: string) {
	return { role: "assistant" as const, content: text };
}

describe("leaf_pointer persistence", () => {
	let tmpDir: string;
	let sessionFile: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `leaf-pointer-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		sessionFile = join(tmpDir, "session.jsonl");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("branch() persists leaf_pointer that survives reload", async () => {
		let sm = SessionManager.open(sessionFile);
		const idA = sm.appendMessage(userMsg("A"));
		const idB = sm.appendMessage(assistantMsg("B"));
		const idC = sm.appendMessage(userMsg("C"));
		const idD = sm.appendMessage(assistantMsg("D"));

		await sm.branch(idB);
		sm.appendMessage(userMsg("new branch msg"));

		let ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(3);
		expect(ctx.messages[2].content).toBe("new branch msg");

		await sm.waitForFlush();
		sm = SessionManager.open(sessionFile);
		ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(3);
		expect(ctx.messages[0].content).toBe("A");
		expect(ctx.messages[1].content).toBe("B");
		expect(ctx.messages[2].content).toBe("new branch msg");

		expect(sm.getLeafId()).not.toBe(idB);
		expect(sm.getLeafId()).toBeTruthy();
	});

	it("resetLeaf() persists null leaf that survives reload", async () => {
		let sm = SessionManager.open(sessionFile);
		const idA = sm.appendMessage(userMsg("A"));
		sm.appendMessage(assistantMsg("B"));

		await sm.resetLeaf();
		sm.appendMessage(userMsg("new root msg"));

		let ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages[0].content).toBe("new root msg");

		await sm.waitForFlush();
		sm = SessionManager.open(sessionFile);
		ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages[0].content).toBe("new root msg");
	});

	it("multiple branch() calls — last leaf_pointer wins", async () => {
		let sm = SessionManager.open(sessionFile);
		const idA = sm.appendMessage(userMsg("A"));
		const idB = sm.appendMessage(assistantMsg("B"));
		const idC = sm.appendMessage(userMsg("C"));

		await sm.branch(idB);
		sm.appendMessage(userMsg("branch from B"));

		await sm.branch(idA);
		sm.appendMessage(userMsg("branch from A"));

		await sm.waitForFlush();
		sm = SessionManager.open(sessionFile);
		const ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(2);
		expect(ctx.messages[0].content).toBe("A");
		expect(ctx.messages[1].content).toBe("branch from A");
	});

	it("leaf_pointer file entry is visible in JSONL", async () => {
		const sm = SessionManager.open(sessionFile);
		const idA = sm.appendMessage(userMsg("A"));
		const idB = sm.appendMessage(assistantMsg("B"));
		await sm.branch(idA);
		await sm.waitForFlush();

		const content = readFileSync(sessionFile, "utf-8");
		const lines = content.trim().split("\n");

		const leafPointerLine = lines.find((l) => l.includes('"type":"leaf_pointer"'));
		expect(leafPointerLine).toBeDefined();

		const entry = JSON.parse(leafPointerLine!);
		expect(entry.type).toBe("leaf_pointer");
		expect(entry.leafId).toBe(idA);
	});

	it("branch from middle of deep chain, reload, continue", async () => {
		let sm = SessionManager.open(sessionFile);
		sm.appendMessage(userMsg("A"));
		const idB = sm.appendMessage(assistantMsg("B"));
		sm.appendMessage(userMsg("C"));
		sm.appendMessage(assistantMsg("D"));
		sm.appendMessage(userMsg("E"));

		await sm.branch(idB);
		sm.appendMessage(userMsg("new F"));

		await sm.waitForFlush();
		sm = SessionManager.open(sessionFile);
		const ctx = sm.buildSessionContext();
		expect(ctx.messages).toHaveLength(3);
		expect(ctx.messages.map((m: any) => m.content)).toEqual(["A", "B", "new F"]);

		sm.appendMessage(assistantMsg("G"));
		const ctx2 = sm.buildSessionContext();
		expect(ctx2.messages).toHaveLength(4);
		expect(ctx2.messages[3].content).toBe("G");
	});
});
