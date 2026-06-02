import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../../utilities.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("rollback navigation safety", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("blocks file-inclusive navigation that would remove all user messages", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const firstUserId = harness.sessionManager.appendMessage(userMsg("first"));
		harness.sessionManager.appendMessage(assistantMsg("reply"));
		const currentLeafId = harness.sessionManager.appendMessage(userMsg("second"));

		const result = await harness.session.navigateTree(firstUserId, { summarize: false });

		expect(result.cancelled).toBe(true);
		expect(result.reason).toContain("remove all user messages");
		expect(harness.sessionManager.getLeafId()).toBe(currentLeafId);
		expect(harness.session.messages.map((message) => message.role)).toEqual([]);
	});

	it("allows message-only navigation to clear the conversation", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const firstUserId = harness.sessionManager.appendMessage(userMsg("first"));
		harness.sessionManager.appendMessage(assistantMsg("reply"));
		harness.sessionManager.appendMessage(userMsg("second"));

		const result = await harness.session.navigateTree(firstUserId, { summarize: false, skipFiles: true });

		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBe("first");
		expect(harness.sessionManager.getLeafId()).toBeNull();
		expect(harness.session.messages).toEqual([]);
	});
});
