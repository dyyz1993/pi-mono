import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../suite/harness.js";

describe("ExtensionAPI.on() returns unsubscribe", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("on() returns a function", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					const unsub = pi.on("agent_start", () => {});
					expect(typeof unsub).toBe("function");
				},
			],
		});
		harnesses.push(harness);
	});

	it("unsubscribe removes the handler before it fires", async () => {
		let callCount = 0;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					const unsub = pi.on("agent_start", () => {
						callCount++;
					});
					unsub();
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("hello");

		expect(callCount).toBe(0);
	});

	it("permanent handler fires, unsubscribed handler does not", async () => {
		const events: string[] = [];
		let unsub: (() => void) | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("agent_start", () => {
						events.push("permanent");
					});
					unsub = pi.on("agent_start", () => {
						events.push("temporary");
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("hello");

		expect(events).toContain("permanent");
		expect(events).toContain("temporary");

		events.length = 0;
		unsub!();

		harness.setResponses([fauxAssistantMessage("done again")]);
		await harness.session.prompt("hello again");

		expect(events).toContain("permanent");
		expect(events).not.toContain("temporary");
	});
});
