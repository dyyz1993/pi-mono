import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	buildSessionContext,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
	SessionManager,
} from "../src/core/session-manager.js";

const SESSION_FILE = join(
	process.env.HOME || "/Users/xuyingzhou",
	".pi/agent/sessions/--Users-xuyingzhou-Project-temporary-bb-browser--/e8a09c9d-c5b3-4982-ad30-4a8caae74ec4.jsonl",
);

function loadSessionEntries(): SessionEntry[] {
	const content = readFileSync(SESSION_FILE, "utf-8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries);
	return entries.filter((e): e is SessionEntry => e.type !== "session");
}

function getFullMessages(entries: SessionEntry[]) {
	return entries.filter((e) => e.type === "message").map((e) => (e as { message: unknown }).message);
}

function getRole(msg: unknown): string {
	return (msg as { role: string }).role;
}

function getText(msg: unknown): string {
	const m = msg as { role: string; content: unknown };
	if (m.role === "user") {
		return typeof m.content === "string" ? m.content.slice(0, 100) : JSON.stringify(m.content).slice(0, 100);
	}
	if (m.role === "assistant") {
		const blocks = m.content as Array<{ type: string; text?: string }>;
		return blocks
			.filter((b) => b.type === "text" && b.text)
			.map((b) => b.text!)
			.join("")
			.slice(0, 100);
	}
	if ("summary" in (m as object)) {
		return (m as { summary: string }).summary.slice(0, 100);
	}
	return JSON.stringify(m).slice(0, 100);
}

describe("get_full_messages with real session e8a09c9d", () => {
	it("session file exists and has compaction", () => {
		const entries = loadSessionEntries();
		const compactions = entries.filter((e) => e.type === "compaction");

		expect(entries.length).toBeGreaterThan(0);
		expect(compactions.length).toBeGreaterThanOrEqual(2);
	});

	it("getFullMessages returns ALL messages including pre-compaction", () => {
		const entries = loadSessionEntries();

		const contextMessages = buildSessionContext(entries).messages;
		const fullMessages = getFullMessages(entries);

		console.log("=== Count comparison ===");
		console.log(`buildSessionContext (getMessages): ${contextMessages.length} messages`);
		console.log(`getFullMessages (all entries):     ${fullMessages.length} messages`);
		console.log(`Compaction entries:                ${entries.filter((e) => e.type === "compaction").length}`);

		expect(fullMessages.length).toBeGreaterThan(contextMessages.length);
	});

	it("every message in fullMessages has same role field as AgentMessage", () => {
		const entries = loadSessionEntries();
		const fullMessages = getFullMessages(entries);
		const contextMessages = buildSessionContext(entries).messages;

		const validRoles = new Set([
			"user",
			"assistant",
			"toolResult",
			"bashExecution",
			"custom",
			"branchSummary",
			"compactionSummary",
		]);
		const contextRoles = new Set(contextMessages.map((m) => m.role));
		const fullRoles = new Set(fullMessages.map((m) => getRole(m)));

		for (const role of fullRoles) {
			expect(validRoles.has(role)).toBe(true);
		}

		console.log("=== Role comparison ===");
		console.log(`getMessages roles:   ${[...contextRoles].join(", ")}`);
		console.log(`getFullMessages roles: ${[...fullRoles].join(", ")}`);

		for (const role of fullRoles) {
			expect(contextRoles.has(role)).toBe(true);
		}
	});

	it("each message has required AgentMessage fields", () => {
		const entries = loadSessionEntries();
		const fullMessages = getFullMessages(entries);

		for (let i = 0; i < fullMessages.length; i++) {
			const msg = fullMessages[i] as Record<string, unknown>;
			expect(msg).toHaveProperty("role");
			expect(msg).toHaveProperty("timestamp");

			if (msg.role === "user") {
				expect(msg).toHaveProperty("content");
			} else if (msg.role === "assistant") {
				expect(msg).toHaveProperty("content");
				expect(msg).toHaveProperty("usage");
				expect(msg).toHaveProperty("stopReason");
			}
		}
	});

	it("fullMessages contains data that getMessages lost to compaction", () => {
		const entries = loadSessionEntries();
		const contextMessages = buildSessionContext(entries).messages;
		const fullMessages = getFullMessages(entries);

		const contextTexts = new Set(contextMessages.map((m) => getText(m)));

		let missingCount = 0;
		const missingSamples: string[] = [];
		for (const msg of fullMessages) {
			const text = getText(msg);
			if (!contextTexts.has(text) && getRole(msg) !== "compactionSummary") {
				missingCount++;
				if (missingSamples.length < 5) {
					missingSamples.push(`[${getRole(msg)}] ${text.slice(0, 60)}...`);
				}
			}
		}

		console.log(`=== Messages only in getFullMessages ===`);
		console.log(`Count: ${missingCount} messages lost to compaction`);
		console.log(`Samples:`);
		for (const s of missingSamples) {
			console.log(`  - ${s}`);
		}

		expect(missingCount).toBeGreaterThan(0);
	});

	it("fullMessages and getMessages share identical message objects for recent messages", () => {
		const entries = loadSessionEntries();
		const contextMessages = buildSessionContext(entries).messages;
		const fullMessages = getFullMessages(entries);

		const fullByTimestamp = new Map(fullMessages.map((m) => [String((m as { timestamp: unknown }).timestamp), m]));

		let matchedCount = 0;
		for (const ctxMsg of contextMessages) {
			if (ctxMsg.role === "compactionSummary") continue;
			const ts = String(ctxMsg.timestamp);
			const fullMsg = fullByTimestamp.get(ts);
			if (fullMsg && getRole(fullMsg) === ctxMsg.role) {
				matchedCount++;
			}
		}

		console.log(`=== Recent message overlap ===`);
		console.log(
			`Context messages (excluding compactionSummary): ${contextMessages.filter((m) => m.role !== "compactionSummary").length}`,
		);
		console.log(`Matched in fullMessages: ${matchedCount}`);

		expect(matchedCount).toBeGreaterThan(0);
	});

	it("with SessionManager.open, getEntries returns same data", () => {
		const rawEntries = loadSessionEntries();
		const session = SessionManager.open(SESSION_FILE, "/tmp");
		const smEntries = session.getEntries();

		const rawMessages = getFullMessages(rawEntries);
		const smMessages = getFullMessages(smEntries);

		console.log(`=== SessionManager vs raw parse ===`);
		console.log(`Raw entries: ${rawEntries.length}, messages: ${rawMessages.length}`);
		console.log(`SM entries:  ${smEntries.length}, messages: ${smMessages.length}`);

		expect(smMessages.length).toBe(rawMessages.length);
		expect(smEntries.filter((e) => e.type === "compaction").length).toBeGreaterThanOrEqual(2);
	});
});
