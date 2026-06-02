import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("custom_entry event", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("emits when an extension appends a custom entry", async () => {
		let api: ExtensionAPI | undefined;
		harness = await createHarness({
			extensionFactories: [
				(pi) => {
					api = pi;
				},
			],
		});
		await harness.session.bindExtensions({});

		api?.appendEntry("panel_state", { expanded: true });

		const [event] = harness.eventsOfType("custom_entry");
		expect(event).toEqual({
			type: "custom_entry",
			customType: "panel_state",
			data: { expanded: true },
			id: expect.any(String),
		});
		expect(harness.sessionManager.getEntry(event.id)?.type).toBe("custom");
	});
});
