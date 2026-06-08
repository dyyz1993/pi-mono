import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("path boundary approval", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("allows reading files inside cwd", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		const insidePath = join(harness.tempDir, "foo.txt");
		writeFileSync(insidePath, "hello");

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: insidePath }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read file");
		expect(executed).toBe(true);
	});

	it("blocks reading files outside cwd in normal mode (no UI)", async () => {
		let executed = false;
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read file",
			parameters: Type.Object({ file_path: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [readTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { file_path: "/etc/passwd" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read password file");
		expect(executed).toBe(false);
	});

	it("blocks writing files outside cwd in normal mode (no UI)", async () => {
		let executed = false;
		const writeTool: AgentTool = {
			name: "write",
			label: "Write",
			description: "Write file",
			parameters: Type.Object({ file_path: Type.String(), content: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [writeTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { file_path: "/tmp/outside.txt", content: "data" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write file outside");
		expect(executed).toBe(false);
	});

	it("allows tools without file paths (e.g. bash)", async () => {
		let executed = false;
		const bashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Run command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async () => {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [bashTool] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "ls /tmp" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("list tmp");
		expect(executed).toBe(true);
	});
});
