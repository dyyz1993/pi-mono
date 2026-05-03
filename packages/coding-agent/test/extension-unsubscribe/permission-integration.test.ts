import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../suite/harness.js";

describe("Permission mode extension integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("tool_call handler can block dangerous bash commands", async () => {
		let blocked = false;
		let blockReason: string | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						if (event.toolName === "bash") {
							const command = (event.input as { command?: string }).command ?? "";
							const dangerousPatterns = [/\brm\s+-rf\b/, /\bgit\s+push\s+.*--force\b/, /\bsudo\b/];
							for (const pattern of dangerousPatterns) {
								if (pattern.test(command)) {
									blocked = true;
									blockReason = `Dangerous command blocked: ${command}`;
									return { block: true, reason: blockReason };
								}
							}
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "rm -rf /" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("delete everything");

		expect(blocked).toBe(true);
		expect(blockReason).toContain("Dangerous command blocked");
	});

	it("tool_call handler allows safe bash commands", async () => {
		let allowed = false;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						if (event.toolName === "bash") {
							allowed = true;
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "ls -la" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("list files");

		expect(allowed).toBe(true);
	});

	it("tool_call handler can block based on variables", async () => {
		let blocked = false;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						if (event.variables?.permissionMode === "plan") {
							blocked = true;
							return { block: true, reason: "Plan mode: execution not allowed" };
						}
					});
				},
			],
		});
		harnesses.push(harness);

		harness.session.toolCallVariables = { permissionMode: "plan" };

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo hello" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run echo");

		expect(blocked).toBe(true);
	});
});
