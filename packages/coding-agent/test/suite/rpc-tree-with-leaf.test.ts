import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("getTreeWithLeaf RPC handler data mapping", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("returns empty entries and null leafId for fresh session", async () => {
		harness = await createHarness();
		const entries = harness.sessionManager.getEntries();
		const leafId = harness.sessionManager.getLeafId();

		expect(entries).toEqual([]);
		expect(leafId).toBeNull();
	});

	it("maps entry fields correctly (id, parentId, type, label)", async () => {
		harness = await createHarness();
		harness.setResponses([{ type: "text", text: "hello" }]);

		await harness.session.sendUserMessage("hi");

		const entries = harness.sessionManager.getEntries();
		expect(entries.length).toBeGreaterThan(0);

		const mapped = entries.map((e) => ({
			id: e.id,
			parentId: e.parentId,
			type: e.type,
			label:
				e.type === "message" ? (e as any).message?.role : e.type === "custom" ? (e as any).customType : undefined,
		}));

		for (const entry of mapped) {
			expect(entry.id).toBeDefined();
			expect(typeof entry.id).toBe("string");
			expect(entry.parentId === null || typeof entry.parentId === "string").toBe(true);
			expect(typeof entry.type).toBe("string");
		}

		const userEntry = mapped.find((e) => e.label === "user");
		expect(userEntry).toBeDefined();

		const leafId = harness.sessionManager.getLeafId();
		expect(leafId).not.toBeNull();
	});

	it("leafId matches the last entry id after a turn", async () => {
		harness = await createHarness();
		harness.setResponses([{ type: "text", text: "world" }]);

		await harness.session.sendUserMessage("hello");

		const entries = harness.sessionManager.getEntries();
		const leafId = harness.sessionManager.getLeafId();

		expect(leafId).toBe(entries[entries.length - 1].id);
	});
});
