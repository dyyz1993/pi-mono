/**
 * Rollback + get_full_messages pagination tests.
 *
 * Validates that cursor-based pagination works correctly after rollback:
 *   - Page boundaries align with entry IDs
 *   - nextCursor points to the correct entry
 *   - hasMore and totalCount are accurate
 *   - Paginating through a rolled-back session only yields current-branch messages
 *   - Full traversal via pagination yields the same messages as non-paginated
 */

import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function getText(m: AgentMessage): string {
	const c = m.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c))
		return c
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
	return "";
}

/**
 * Simulates get_full_messages pagination from rpc-mode.ts.
 */
function getFullMessagesPaginated(h: Harness, options?: { afterEntryId?: string; limit?: number }) {
	const allEntries = h.sessionManager.getEntries();
	const branchEntries = h.sessionManager.getBranch();
	const branchIds = new Set(branchEntries.map((e) => e.id));
	const messageEntries = allEntries.filter((e) => e.type === "message" && branchIds.has(e.id));
	const persistedMessages: (AgentMessage & { entryId: string })[] = messageEntries.map((e) => ({
		...(e as { message: AgentMessage }).message,
		entryId: e.id,
	}));
	const persistedSet = new Set(messageEntries.map((e) => (e as { message: AgentMessage }).message));

	const memoryMessages = h.session.messages;
	const unPersisted: (AgentMessage & { entryId?: string })[] = [];
	for (let i = memoryMessages.length - 1; i >= 0; i--) {
		const msg = memoryMessages[i];
		if (persistedSet.has(msg)) break;
		if (msg.role === "compactionSummary") continue;
		unPersisted.unshift(msg);
	}

	const allMessages: (AgentMessage & { entryId?: string })[] = [...persistedMessages, ...unPersisted];
	const totalCount = allMessages.length;

	const leafId = h.sessionManager.getLeafId();

	const treeEntries = allEntries.map((e) => ({
		id: e.id,
		parentId: e.parentId,
		type: e.type,
		label: e.type === "message" ? (e as any).message?.role : e.type === "custom" ? (e as any).customType : undefined,
	}));

	if (options?.limit !== undefined) {
		const limit = options.limit;
		let startIndex = 0;
		if (options.afterEntryId) {
			const idx = messageEntries.findIndex((e) => e.id === options.afterEntryId);
			if (idx !== -1) {
				startIndex = idx + 1;
			}
		}
		const page = allMessages.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < totalCount;
		const lastPersisted = messageEntries[Math.min(startIndex + limit, messageEntries.length) - 1];
		return {
			messages: page,
			hasMore,
			totalCount,
			nextCursor: hasMore && lastPersisted ? lastPersisted.id : null,
			tree: { entries: treeEntries, leafId },
		};
	}

	return {
		messages: allMessages,
		hasMore: false,
		totalCount,
		nextCursor: null,
		tree: { entries: treeEntries, leafId },
	};
}

function noopExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_tree", async () => {});
	};
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: `Compacted up to ${event.preparation.firstKeptEntryId}`,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

describe("rollback + get_full_messages pagination", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doTurn(h: Harness, prompt: string) {
		h.setResponses([fauxAssistantMessage(`reply-${prompt}`)]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	async function doToolTurn(h: Harness, prompt: string) {
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "dummy.txt", content: prompt }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(`done-${prompt}`),
		]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	it("1. pagination after rollback: only current branch messages, totalCount correct", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");
		await doTurn(h, "D");

		// Rollback to turn 2
		await h.session.navigateTree(t1, { summarize: false });

		// Non-paginated: should have 2 messages (1 user + 1 assistant)
		const full = getFullMessagesPaginated(h);
		expect(full.totalCount).toBe(2);
		expect(full.messages.length).toBe(2);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A"]);

		// Paginated with limit=1
		const page1 = getFullMessagesPaginated(h, { limit: 1 });
		expect(page1.messages.length).toBe(1);
		expect(page1.hasMore).toBe(true);
		expect(page1.totalCount).toBe(2);
		expect(page1.nextCursor).toBeDefined();

		// Second page
		const page2 = getFullMessagesPaginated(h, { limit: 1, afterEntryId: page1.nextCursor! });
		expect(page2.messages.length).toBe(1);
		expect(page2.hasMore).toBe(false);
		expect(page2.nextCursor).toBeNull();
	});

	it("2. full traversal via pagination equals non-paginated result", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		await doTurn(h, "B");
		const t3 = await doTurn(h, "C");

		// No rollback - full 6 messages
		const full = getFullMessagesPaginated(h);
		expect(full.totalCount).toBe(6);

		// Paginate through all
		const collected: (AgentMessage & { entryId?: string })[] = [];
		let cursor: string | null = null;
		let pageCount = 0;
		do {
			const page = getFullMessagesPaginated(h, { limit: 2, afterEntryId: cursor ?? undefined });
			collected.push(...page.messages);
			cursor = page.nextCursor;
			pageCount++;
		} while (cursor !== null && pageCount < 20);

		expect(collected.length).toBe(full.messages.length);
		expect(collected.map((m) => m.entryId)).toEqual(full.messages.map((m) => m.entryId));
	});

	it("3. rollback then paginate: no stale messages from rolled-back branch", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.navigateTree(t1, { summarize: false });

		// Continue with new branch
		await doTurn(h, "D-new");

		// Full traversal via pagination
		const collected: (AgentMessage & { entryId?: string })[] = [];
		let cursor: string | null = null;
		let pageCount = 0;
		do {
			const page = getFullMessagesPaginated(h, { limit: 2, afterEntryId: cursor ?? undefined });
			collected.push(...page.messages);
			cursor = page.nextCursor;
			pageCount++;
		} while (cursor !== null && pageCount < 20);

		// Only A + D-new user messages
		const userTexts = collected.filter((m) => m.role === "user").map(getText);
		expect(userTexts).toEqual(["A", "D-new"]);

		// No B or C anywhere
		expect(collected.some((m) => getText(m).includes("reply-B"))).toBe(false);
		expect(collected.some((m) => getText(m).includes("reply-C"))).toBe(false);
	});

	it("4. pagination with tool calls after rollback: all roles included", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doToolTurn(h, "A");
		await doToolTurn(h, "B");

		await h.session.navigateTree(t1, { summarize: false });

		// t1 = user + assistant(toolCall) + toolResult + assistant(text) = 4 messages
		const full = getFullMessagesPaginated(h);
		expect(full.totalCount).toBe(4);

		const roles = full.messages.map((m) => m.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
		expect(roles).toContain("toolResult");

		// Paginate
		const page1 = getFullMessagesPaginated(h, { limit: 2 });
		expect(page1.messages.length).toBe(2);
		expect(page1.hasMore).toBe(true);
	});

	it("5. compaction then rollback: pagination shows correct restored messages", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		const t2 = await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.compact();

		await h.session.navigateTree(t2, { summarize: false });

		const full = getFullMessagesPaginated(h);
		expect(full.messages.some((m) => m.role === "compactionSummary")).toBe(false);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B"]);

		// Paginated
		const page1 = getFullMessagesPaginated(h, { limit: 2 });
		expect(page1.totalCount).toBe(4);
		expect(page1.hasMore).toBe(true);
		const page2 = getFullMessagesPaginated(h, { limit: 2, afterEntryId: page1.nextCursor! });
		expect(page2.messages.length).toBe(2);
		expect(page2.hasMore).toBe(false);
	});

	it("6. pagination after rollback with continue: new messages appear at end", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "D-new");
		await doTurn(h, "E-new");

		// Non-paginated: A, D-new, E-new = 6 messages (3 user + 3 assistant)
		const full = getFullMessagesPaginated(h);
		expect(full.totalCount).toBe(6);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "D-new", "E-new"]);

		// Page 1 (limit 3): should have first 3 messages
		const page1 = getFullMessagesPaginated(h, { limit: 3 });
		expect(page1.messages.length).toBe(3);
		expect(page1.hasMore).toBe(true);

		// Page 2: should have remaining 3
		const page2 = getFullMessagesPaginated(h, { limit: 3, afterEntryId: page1.nextCursor! });
		expect(page2.messages.length).toBe(3);
		expect(page2.hasMore).toBe(false);
	});

	it("7. totalCount consistent across pages after rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");
		await doTurn(h, "D");
		await doTurn(h, "E");

		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "F");

		// A + F = 4 messages
		const full = getFullMessagesPaginated(h);
		const expectedTotal = full.totalCount;

		// Every page should report the same totalCount
		const page1 = getFullMessagesPaginated(h, { limit: 1 });
		expect(page1.totalCount).toBe(expectedTotal);
		const page2 = getFullMessagesPaginated(h, { limit: 1, afterEntryId: page1.nextCursor! });
		expect(page2.totalCount).toBe(expectedTotal);
	});

	it("8. invalid afterEntryId starts from beginning", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		await doTurn(h, "B");

		// Non-existent cursor: should start from beginning
		const page = getFullMessagesPaginated(h, { limit: 10, afterEntryId: "nonexistent-id" });
		expect(page.messages.length).toBe(4); // 2 user + 2 assistant
		expect(page.totalCount).toBe(4);
	});

	it("9. tree and leafId consistent across paginated and non-paginated calls", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		await h.session.navigateTree(t1, { summarize: false });

		const full = getFullMessagesPaginated(h);
		const page = getFullMessagesPaginated(h, { limit: 1 });

		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());
		expect(page.tree.leafId).toBe(h.sessionManager.getLeafId());
		expect(full.tree.entries.length).toBe(page.tree.entries.length);

		// Same tree entries
		expect(full.tree.entries.map((e) => e.id)).toEqual(page.tree.entries.map((e) => e.id));
	});
});
