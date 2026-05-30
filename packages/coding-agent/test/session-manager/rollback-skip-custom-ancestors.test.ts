/**
 * TDD tests for findBranchPointAbove: skip consecutive custom ancestors
 * when rolling back user/custom_message entries.
 *
 * Bug: auto-memory extension inserts custom entries (memory_prefetch, etc.)
 * before user messages. When navigateTree rolls back to a user message,
 * the leaf was set to the user message's direct parent (a custom entry),
 * leaving those custom entries visible in the conversation.
 *
 * Fix: findBranchPointAbove skips consecutive custom-type ancestors
 * to land the leaf on the first non-custom entry.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";

describe("SessionManager.findBranchPointAbove", () => {
	let tempDir: string;
	let sm: SessionManager;

	beforeEach(() => {
		tempDir = `/tmp/sm-branch-point-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		sm = SessionManager.inMemory(tempDir);
	});

	afterEach(() => {
		// no fs cleanup needed for inMemory
	});

	it("skips single custom ancestor and returns first non-custom entry", () => {
		// root → assistant_msg → memory_prefetch(custom) → user_msg
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const custom = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(asst);
	});

	it("skips multiple consecutive custom ancestors", () => {
		// root → assistant_msg → memory_prefetch(custom) → memory_result(custom) → user_msg
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const custom1 = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const custom2 = sm.appendCustomEntry("memory_prefetch_result", { results: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		// Verify chain: user → custom2 → custom1 → asst
		expect(sm.getEntry(user)?.parentId).toBe(custom2);
		expect(sm.getEntry(custom2)?.parentId).toBe(custom1);
		expect(sm.getEntry(custom1)?.parentId).toBe(asst);

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(asst);
	});

	it("stops at non-custom entry (agent_change) between customs", () => {
		// root → assistant_msg → agent_change → memory_prefetch(custom) → user_msg
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const agentChange = sm.appendAgentChange("build", "build");
		const custom = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		expect(sm.getEntry(agentChange)?.type).toBe("agent_change");

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(agentChange);
	});

	it("returns direct parent when no custom ancestors exist", () => {
		// root → assistant_msg → user_msg (no custom in between)
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const user = sm.appendMessage({ role: "user", content: "hi" });

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(asst);
	});

	it("returns null when all ancestors are custom up to root", () => {
		// root → custom1 → custom2 → user_msg
		const custom1 = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const custom2 = sm.appendCustomEntry("memory_result", { results: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		expect(sm.getEntry(custom1)?.parentId).toBeNull();

		const result = sm.findBranchPointAbove(user);
		expect(result).toBeNull();
	});

	it("returns null for entry whose parent is null (root-level)", () => {
		// root → user_msg (parentId = null)
		const user = sm.appendMessage({ role: "user", content: "hi" });

		const result = sm.findBranchPointAbove(user);
		expect(result).toBeNull();
	});

	it("works for custom_message entries the same as user messages", () => {
		// root → assistant_msg → custom_entry(custom) → custom_message
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const custom = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const cm = sm.appendCustomMessageEntry("user_proxy", "proxy message", true);

		const result = sm.findBranchPointAbove(cm);
		expect(result).toBe(asst);
	});

	it("handles model_change correctly (not skipped)", () => {
		// root → assistant_msg → model_change → custom → user_msg
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const modelChange = sm.appendModelChange("claude-3.5", "gpt-4");
		const custom = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		expect(sm.getEntry(modelChange)?.type).toBe("model_change");

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(modelChange);
	});

	it("skips custom ancestors but stops at compaction entry", () => {
		// root → assistant_msg → compaction → custom → user_msg
		const asst = sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
		const compaction = sm.appendCompaction("summary text", asst, 100);
		const custom = sm.appendCustomEntry("memory_prefetch", { ids: [] });
		const user = sm.appendMessage({ role: "user", content: "hi" });

		expect(sm.getEntry(compaction)?.type).toBe("compaction");

		const result = sm.findBranchPointAbove(user);
		expect(result).toBe(compaction);
	});
});
