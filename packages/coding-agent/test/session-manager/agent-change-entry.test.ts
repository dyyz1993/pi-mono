import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";
import { assistantMsg, userMsg } from "../utilities.js";

describe("AgentChangeEntry persistence", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `agent-change-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("appends agent_change entry with correct structure", () => {
		const session = SessionManager.inMemory();
		const _id1 = session.appendMessage(userMsg("hello"));
		const id2 = session.appendMessage(assistantMsg("hi"));
		// @ts-expect-error - Testing internal API
		const agentChangeId = session.appendAgentChange("pi-expert", {
			description: "Pi framework expert",
			permissionMode: "always-allow",
		});

		const entries = session.getEntries();
		expect(entries).toHaveLength(3);

		const agentEntry = entries[2];
		expect(agentEntry.type).toBe("agent_change");
		expect(agentEntry.id).toBe(agentChangeId);
		expect(agentEntry.parentId).toBe(id2);
		expect(agentEntry.agentName).toBe("pi-expert");
		expect(agentEntry.agentConfig).toEqual({
			description: "Pi framework expert",
			permissionMode: "always-allow",
		});
	});

	it("agent_change entry persists to jsonl and reloads correctly", async () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		const _id1 = session1.appendMessage(userMsg("hello"));
		const _id2 = session1.appendMessage(assistantMsg("hi"));
		// @ts-expect-error - Testing internal API
		session1.appendAgentChange("pi-expert", {
			description: "Pi framework expert",
			permissionMode: "always-allow",
			tier: "pro",
		});

		await session1.waitForFlush();
		const sessionFile = session1.getSessionFile()!;
		const rawContent = readFileSync(sessionFile, "utf-8");
		const lines = rawContent.trim().split("\n");
		expect(lines).toHaveLength(4);

		const agentLine = JSON.parse(lines[3]);
		expect(agentLine.type).toBe("agent_change");
		expect(agentLine.agentName).toBe("pi-expert");
		expect(agentLine.agentConfig).toEqual({
			description: "Pi framework expert",
			permissionMode: "always-allow",
			tier: "pro",
		});

		const session2 = SessionManager.open(sessionFile, tempDir);
		const entries = session2.getEntries();
		const agentEntry = entries.find((e) => e.type === "agent_change");
		expect(agentEntry).toBeDefined();
		expect(agentEntry?.agentName).toBe("pi-expert");
	});

	it("multiple agent_change entries preserve history", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("start"));
		// @ts-expect-error - Testing internal API
		session.appendAgentChange("build");
		session.appendMessage(assistantMsg("building..."));

		session.appendMessage(userMsg("debug"));
		// @ts-expect-error - Testing internal API
		session.appendAgentChange("pi-expert", { description: "Expert mode" });
		session.appendMessage(assistantMsg("debugging..."));

		const entries = session.getEntries();
		const agentChanges = entries.filter((e) => e.type === "agent_change");
		expect(agentChanges).toHaveLength(2);
		expect(agentChanges[0].agentName).toBe("build");
		expect(agentChanges[1].agentName).toBe("pi-expert");
	});

	it("agent_change entry with minimal config", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("test"));
		// @ts-expect-error - Testing internal API
		const agentChangeId = session.appendAgentChange("explore");

		const entries = session.getEntries();
		const agentEntry = entries.find((e) => e.type === "agent_change");
		expect(agentEntry).toBeDefined();
		expect(agentEntry?.agentName).toBe("explore");
		expect(agentEntry?.agentConfig).toBeUndefined();
	});
});
