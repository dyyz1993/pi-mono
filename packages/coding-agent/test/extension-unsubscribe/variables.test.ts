import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../suite/harness.js";

describe("ToolCallEvent.variables propagation", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("tool_call event receives variables from agent session", async () => {
		let receivedVariables: Record<string, string> | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						receivedVariables = event.variables;
					});
				},
			],
		});
		harnesses.push(harness);

		harness.session.toolCallVariables = { agentName: "test-agent", permissionMode: "plan" };

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run ls");

		expect(receivedVariables).toBeDefined();
		expect(receivedVariables!.agentName).toBe("test-agent");
		expect(receivedVariables!.permissionMode).toBe("plan");
	});

	it("tool_call event gets undefined variables when not set", async () => {
		let receivedVariables: Record<string, string> | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						receivedVariables = event.variables;
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "ls" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run ls");

		expect(receivedVariables).toBeUndefined();
	});

	it("variables can be changed between prompts", async () => {
		const allVariables: (Record<string, string> | undefined)[] = [];

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						allVariables.push(event.variables);
					});
				},
			],
		});
		harnesses.push(harness);

		harness.session.toolCallVariables = { role: "first" };
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo 1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run 1");

		harness.session.toolCallVariables = { role: "second" };
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo 2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run 2");

		expect(allVariables).toHaveLength(2);
		expect(allVariables[0]?.role).toBe("first");
		expect(allVariables[1]?.role).toBe("second");
	});
});
