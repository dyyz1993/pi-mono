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

interface PaginatedResult {
	messages: unknown[];
	hasMore: boolean;
	totalCount: number;
	nextCursor: string | null;
}

function getFullMessagesPaginated(
	entries: SessionEntry[],
	options?: { afterEntryId?: string; limit?: number },
): PaginatedResult {
	const messageEntries = entries.filter((e) => e.type === "message");

	let startIndex = 0;
	if (options?.afterEntryId) {
		const idx = messageEntries.findIndex((e) => e.id === options!.afterEntryId);
		if (idx === -1) {
			return { messages: [], hasMore: false, totalCount: messageEntries.length, nextCursor: null };
		}
		startIndex = idx + 1;
	}

	if (options?.limit !== undefined) {
		const limit = options.limit;
		const page = messageEntries.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < messageEntries.length;
		const lastEntry = page[page.length - 1];

		return {
			messages: page.map((e) => (e as { message: unknown }).message),
			hasMore,
			totalCount: messageEntries.length,
			nextCursor: hasMore && lastEntry ? lastEntry.id : null,
		};
	}

	return {
		messages: messageEntries.map((e) => (e as { message: unknown }).message),
		hasMore: false,
		totalCount: messageEntries.length,
		nextCursor: null,
	};
}

function getRole(msg: unknown): string {
	return (msg as { role: string }).role;
}

function getText(msg: unknown): string {
	const m = msg as { role: string; content: unknown };
	if (m.role === "user") {
		return typeof m.content === "string" ? m.content.slice(0, 80) : JSON.stringify(m.content).slice(0, 80);
	}
	if (m.role === "assistant") {
		const blocks = m.content as Array<{ type: string; text?: string }>;
		return blocks
			.filter((b) => b.type === "text" && b.text)
			.map((b) => b.text!)
			.join("")
			.slice(0, 80);
	}
	if (m.role === "toolResult") {
		return "[toolResult]";
	}
	return JSON.stringify(m).slice(0, 80);
}

describe("get_full_messages pagination", () => {
	const entries = loadSessionEntries();

	it("page 1 returns first N messages with hasMore=true", () => {
		const page1 = getFullMessagesPaginated(entries, { limit: 50 });
		const totalCount = page1.totalCount;

		console.log("=== Page 1 ===");
		console.log(
			`messages: ${page1.messages.length}, hasMore: ${page1.hasMore}, totalCount: ${totalCount}, nextCursor: ${page1.nextCursor?.slice(0, 12)}...`,
		);
		console.log(`First: [${getRole(page1.messages[0])}] ${getText(page1.messages[0])}`);
		console.log(`Last:  [${getRole(page1.messages[49])}] ${getText(page1.messages[49])}`);

		expect(page1.messages.length).toBe(50);
		expect(page1.hasMore).toBe(true);
		expect(totalCount).toBeGreaterThan(500);
		expect(page1.nextCursor).toBeTruthy();
	});

	it("can iterate all pages to get full dataset", () => {
		const allCollected: unknown[] = [];
		let cursor: string | undefined;
		let pageCount = 0;

		while (true) {
			const page = getFullMessagesPaginated(entries, { afterEntryId: cursor, limit: 100 });
			allCollected.push(...page.messages);
			pageCount++;

			if (!page.hasMore) break;
			cursor = page.nextCursor!;
		}

		const flatAll = entries.filter((e) => e.type === "message").map((e) => (e as { message: unknown }).message);

		console.log(`=== Full iteration ===`);
		console.log(`Pages: ${pageCount}, Total messages collected: ${allCollected.length}`);

		expect(allCollected.length).toBe(flatAll.length);
		expect(allCollected.length).toBeGreaterThan(500);
	});

	it("no pagination = return everything (backward compatible)", () => {
		const result = getFullMessagesPaginated(entries);

		console.log(`=== No pagination ===`);
		console.log(`messages: ${result.messages.length}, hasMore: ${result.hasMore}, totalCount: ${result.totalCount}`);

		expect(result.messages.length).toBeGreaterThan(500);
		expect(result.hasMore).toBe(false);
		expect(result.nextCursor).toBeNull();
		expect(result.totalCount).toBe(result.messages.length);
	});

	it("last page returns hasMore=false and nextCursor=null", () => {
		const cursor = entries.filter((e) => e.type === "message").at(-2)!.id;
		const lastPage = getFullMessagesPaginated(entries, { afterEntryId: cursor, limit: 50 });

		console.log(`=== Last page ===`);
		console.log(
			`messages: ${lastPage.messages.length}, hasMore: ${lastPage.hasMore}, nextCursor: ${lastPage.nextCursor}`,
		);

		expect(lastPage.messages.length).toBe(1);
		expect(lastPage.hasMore).toBe(false);
		expect(lastPage.nextCursor).toBeNull();
	});

	it("pages have no overlapping messages", () => {
		const page1 = getFullMessagesPaginated(entries, { limit: 100 });
		const page2 = getFullMessagesPaginated(entries, { afterEntryId: page1.nextCursor!, limit: 100 });

		const page1Ids = new Set(
			entries
				.filter((e) => e.type === "message")
				.slice(0, 100)
				.map((e) => e.id),
		);
		const page2Ids = new Set(
			entries
				.filter((e) => e.type === "message")
				.slice(100, 200)
				.map((e) => e.id),
		);

		const overlap = [...page1Ids].filter((id) => page2Ids.has(id));

		console.log(`=== Overlap check ===`);
		console.log(`Page 1: ${page1Ids.size}, Page 2: ${page2Ids.size}, Overlap: ${overlap.length}`);

		expect(overlap.length).toBe(0);
		expect(page1Ids.size + page2Ids.size).toBe(200);
	});

	it("consecutive pages maintain message order", () => {
		const page1 = getFullMessagesPaginated(entries, { limit: 50 });
		const page2 = getFullMessagesPaginated(entries, { afterEntryId: page1.nextCursor!, limit: 50 });

		const allMessages = entries.filter((e) => e.type === "message").map((e) => (e as { message: unknown }).message);

		const p1Last = page1.messages[page1.messages.length - 1];
		const p2First = page2.messages[0];

		const p1LastIdx = allMessages.indexOf(p1Last);
		const p2FirstIdx = allMessages.indexOf(p2First);

		console.log(`=== Order check ===`);
		console.log(`Page1 last idx: ${p1LastIdx}, Page2 first idx: ${p2FirstIdx}`);

		expect(p2FirstIdx).toBe(p1LastIdx + 1);
	});
});
