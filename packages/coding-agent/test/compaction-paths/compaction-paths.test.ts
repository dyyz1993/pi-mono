import { fauxAssistantMessage, fauxText, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import agentPermissions from "../../extensions/agent-permissions/index.js";
import type { ExtensionFactory } from "../../src/index.js";
import { createHarness, type Harness } from "../suite/harness.js";

const agentPermissionsFactory: ExtensionFactory = (pi) => {
	agentPermissions(pi as Parameters<typeof agentPermissions>[0]);
};

describe("Gap 5: Compaction preserves paths", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("paths survive manual compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Docs only",
			systemPrompt: "You write docs",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		harness.setResponses([fauxText("response")]);
		await harness.session.prompt("hello");

		const vars = harness.session.currentAgentVariables;
		expect(vars["paths"]).toBeDefined();
		expect(JSON.parse(vars["paths"])).toEqual({ write: ["docs/**"] });
	});

	it("paths persist across multiple turns", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Docs only",
			systemPrompt: "You write docs",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		harness.setResponses([fauxText("turn 1 done")]);
		await harness.session.prompt("message 1");

		harness.setResponses([fauxText("turn 2 done")]);
		await harness.session.prompt("message 2");

		const vars = harness.session.currentAgentVariables;
		expect(JSON.parse(vars["paths"])).toEqual({ write: ["docs/**"] });
	});

	it("paths still enforced after multiple turns", async () => {
		const harness = await createHarness({
			extensionFactories: [agentPermissionsFactory],
		});
		harnesses.push(harness);

		await harness.session.applyAgentConfig({
			name: "docs-writer",
			description: "Docs only",
			systemPrompt: "You write docs",
			source: "project",
			filePath: ".pi/agents/docs-writer.md",
			paths: { write: ["docs/**"] },
		});

		harness.setResponses([fauxText("turn 1 done")]);
		await harness.session.prompt("message 1");

		harness.setResponses([fauxText("turn 2 done")]);
		await harness.session.prompt("message 2");

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: `${harness.tempDir}/src/index.ts`,
					edits: [{ oldText: "foo", newText: "bar" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit src");

		const allText = harness.session.messages
			.flatMap((m) => {
				if (typeof m.content === "string") return [m.content];
				return m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text);
			})
			.join(" ");

		expect(allText).toContain("not in the allowed write paths");
	});
});
